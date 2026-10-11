#!/usr/bin/env node
// 第 6 轮补切：ta/pa/nya 音频本体不足 580ms（加长音重合成）；ja/byo/pyo per 低（多掷多语速挑最优）。
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { voicedStats, peakOf } from './kana-seg.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_BASE = path.join(ROOT, 'tools/kana-variants')
const log = (...m) => console.log(...m)

const realFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input)
  if (!/^https?:\/\//i.test(url)) {
    const p = url.startsWith('file://') ? fileURLToPath(url) : path.resolve(url)
    return new Response(await fs.readFile(p), { status: 200 })
  }
  return realFetch(input, init)
}
let currentConfigPath = null
const { PiperPlus, ModelManager } = await import('piper-plus')
ModelManager.prototype._resolveUrls = async function (modelPath) {
  return {
    modelUrl: modelPath,
    configUrl: currentConfigPath ?? modelPath.replace(/\.onnx$/i, '.json'),
    configFallbackUrl: null,
    cacheKey: path.basename(modelPath),
  }
}
const cfg = JSON.parse(await fs.readFile(path.join(ROOT, 'scripts/audio.config.json'), 'utf8'))
const voice = cfg.voices['tsukuyomi-v1']
const dir = path.join(ROOT, cfg.modelCacheDir, 'tsukuyomi-v1')
currentConfigPath = path.join(dir, voice.model.config)
const onnx = path.join(dir, voice.model.onnx)
if (!existsSync(onnx)) process.exit(1)
const piper = await PiperPlus.initialize({
  model: onnx,
  ort: await import('onnxruntime-web'),
  wasmG2pUrl: pathToFileURL(path.join(ROOT, 'node_modules/piper-plus/dist/rust-wasm/piper_plus_wasm.js')).href,
})
log('tsukuyomi 就绪')

function floatToInt16(samples) {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}
const lameMod = await import('@breezystack/lamejs')
const lame = lameMod.Mp3Encoder ? lameMod : lameMod.default
function encodeMp3(samples, sampleRate, kbps) {
  const enc = new lame.Mp3Encoder(1, sampleRate, kbps)
  const pcm = floatToInt16(samples)
  const chunks = []
  for (let i = 0; i < pcm.length; i += 1152) {
    const buf = enc.encodeBuffer(pcm.subarray(i, i + 1152))
    if (buf.length) chunks.push(Buffer.from(buf))
  }
  const tail = enc.flush()
  if (tail.length) chunks.push(Buffer.from(tail))
  return Buffer.concat(chunks)
}

const baseOf = (h) => (h === 'は' ? 'ハ' : h === 'へ' ? '屁' : h)

function cutWindow(r, sr, startMs, lenMs) {
  const E = r.timing.phonemes
  if (!E.length) return null
  const lastEnd = E[E.length - 1].end_ms
  const scale = r.samples.length / sr / (lastEnd / 1000)
  const a = Math.max(0, Math.round((startMs / 1000) * sr * scale))
  const b = Math.min(r.samples.length, a + Math.round((lenMs / 1000) * sr))
  if (b - a < Math.round(sr * 0.3)) return null
  const win = r.samples.slice(a, b)
  const tail = Math.min(win.length, Math.round(sr * 0.15))
  const fade = Math.min(win.length, Math.round(sr * 0.012))
  for (let i = 0; i < tail; i++) win[win.length - 1 - i] *= Math.exp(-3.5 * (i / tail))
  for (let i = 0; i < fade; i++) win[win.length - 1 - i] *= i / fade
  const fi = Math.min(win.length, Math.round(sr * 0.006))
  for (let i = 0; i < fi; i++) win[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fi)
  return win
}
const sliceStats = (win, sr) => {
  const body = win.length > Math.round(sr * 0.15) ? win.slice(0, win.length - Math.round(sr * 0.15)) : win
  const { per, zcr } = voicedStats(body, sr)
  return { ms: Math.round((win.length / sr) * 1000), per, zcr }
}
function polish(win, sr) {
  const peak = peakOf(win)
  if (peak > 0) { const g = 0.6 / peak; for (let i = 0; i < win.length; i++) win[i] *= g }
  const out = new Float32Array(win.length + Math.round(sr * (0.08 + 0.24)))
  out.set(win, Math.round(sr * 0.08))
  return out
}

const dataRaw = await fs.readFile(path.join(OUT_BASE, 'data.js'), 'utf8')
const D = JSON.parse(dataRaw.replace(/^window\.KANA_VARIANTS = /, '').trim())

// 截短格：6 个长音重合成，保证稳态段足够
const SHORT = { ta: 6, pa: 6, nya: 6 }
for (const [slug, k] of Object.entries(SHORT)) {
  const cell = D.cells.find((c) => c.slug === slug)
  const text = `${baseOf(cell.h)}${'ー'.repeat(k)}。`
  let best = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await piper.synthesize(text, { ...voice.params, lengthScale: 2.6 })
    const Ee = r.timing.phonemes
    if (!Ee.length) continue
    const win = cutWindow(r, r.sampleRate, Math.max(0, Ee[0].start_ms - 15), 580)
    if (!win) continue
    const st = sliceStats(win, r.sampleRate)
    if (st.ms >= 575 && st.per >= 0.75 && st.zcr <= 0.4) { best = { win, sr: r.sampleRate, st, attempt, ls: 2.6, text }; break }
    if (!best || st.per > best.st.per) best = { win, sr: r.sampleRate, st, attempt, ls: 2.6, text }
  }
  if (!best) { log(`✗ ${slug}`); continue }
  const mp3 = encodeMp3(polish(best.win, best.sr), best.sr, cfg.encode.bitrateKbps)
  await fs.writeFile(path.join(OUT_BASE, 'i', `${slug}.mp3`), mp3)
  D.stats.i[slug] = { ...D.stats.i[slug], dur: best.st.ms, per: Math.round(best.st.per * 100) / 100, zcr: Math.round(best.st.zcr * 100) / 100, attempts: best.attempt, ls: best.ls, flag: !(best.st.per >= 0.75 && best.st.ms >= 575) }
  log(`${slug}: ${best.st.ms}ms per ${best.st.per} attempt${best.attempt}`)
}

// 低 per 格：多语速 × 多掷挑最优
const LOWPER = ['ja', 'byo', 'pyo']
for (const slug of LOWPER) {
  const cell = D.cells.find((c) => c.slug === slug)
  const text = `${baseOf(cell.h)}ーーー。`
  let best = null
  for (const ls of [2.2, 2.6, 3.0]) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const r = await piper.synthesize(text, { ...voice.params, lengthScale: ls })
      const Ee = r.timing.phonemes
      if (!Ee.length) continue
      const win = cutWindow(r, r.sampleRate, Math.max(0, Ee[0].start_ms - 15), 580)
      if (!win) continue
      const st = sliceStats(win, r.sampleRate)
      if (!best || st.per > best.st.per) best = { win, sr: r.sampleRate, st, attempt, ls }
      if (st.per >= 0.8) break
    }
    if (best?.st.per >= 0.8) break
  }
  if (!best) { log(`✗ ${slug}`); continue }
  const mp3 = encodeMp3(polish(best.win, best.sr), best.sr, cfg.encode.bitrateKbps)
  await fs.writeFile(path.join(OUT_BASE, 'i', `${slug}.mp3`), mp3)
  D.stats.i[slug] = { ...D.stats.i[slug], dur: best.st.ms, per: Math.round(best.st.per * 100) / 100, zcr: Math.round(best.st.zcr * 100) / 100, attempts: best.attempt, ls: best.ls, flag: !(best.st.per >= 0.75 && best.st.ms >= 575) }
  log(`${slug}: ${best.st.ms}ms per ${best.st.per} ls${best.ls} attempt${best.attempt}`)
}

await fs.writeFile(path.join(OUT_BASE, 'data.js'), 'window.KANA_VARIANTS = ' + JSON.stringify(D, null, 1) + '\n')
const es = Object.entries(D.stats.i).filter(([, s]) => s.dur)
const durs = es.map(([, s]) => s.dur).sort((a, b) => a - b)
log(`终态：${es.length} 格；时长 ${durs[0]}–${durs[durs.length - 1]}ms；=580 ${es.filter(([, s]) => s.dur === 580).length}；per<0.75 ${es.filter(([, s]) => (s.per ?? 1) < 0.75).length}；flag ${es.filter(([, s]) => s.flag).length}`)
