#!/usr/bin/env node
// 第 11 轮补切（b）：ra 用対 nth 修正；ru 改「クルー」；ja 换「じゃんけん/じゃがいも」竞速；
// pa 加 420ms 上限；gyu 定长改音频域计算 + 4 掷。已成功的 ni/re/ro/pu/wo 不动。
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
const piper = await PiperPlus.initialize({
  model: path.join(dir, voice.model.onnx),
  ort: await import('onnxruntime-web'),
  wasmG2pUrl: pathToFileURL(path.join(ROOT, 'node_modules/piper-plus/dist/rust-wasm/piper_plus_wasm.js')).href,
})
log('tsukuyomi 就绪')

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u'])
const SKIP = new Set(['_', '#', '[', ']', 'pau', 'sil'])

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
function locateMora(E, vowel, nth) {
  let seen = 0, vIdx = -1
  for (let i = 0; i < E.length; i++) {
    if (E[i].phoneme === vowel) { seen++; if (seen === nth) { vIdx = i; break } }
  }
  if (vIdx < 0) return null
  let cIdx = vIdx
  while (cIdx > 0 && !VOWELS.has(E[cIdx - 1].phoneme) && !SKIP.has(E[cIdx - 1].phoneme)) cIdx--
  return { onsetMs: E[cIdx].start_ms, vowelEndMs: E[vIdx].end_ms }
}
// a/b 用音频域样本数（避免 timing scale 误差）；fixedMs 直接在音频域取
function makeCut(r, sr) {
  const E = r.timing.phonemes
  const lastEnd = E[E.length - 1].end_ms
  const scale = r.samples.length / sr / (lastEnd / 1000)
  return (aMs, bMs, fixedMs) => {
    const a = Math.max(0, Math.round((aMs / 1000) * sr * scale))
    let b
    if (fixedMs) b = Math.min(r.samples.length, a + Math.round((fixedMs / 1000) * sr))
    else b = Math.min(r.samples.length, Math.round((bMs / 1000) * sr * scale))
    if (b - a < Math.round(sr * 0.12)) return null
    const win = r.samples.slice(a, b)
    const tail = Math.min(win.length, Math.round(sr * 0.08))
    const fade = Math.min(win.length, Math.round(sr * 0.012))
    for (let i = 0; i < tail; i++) win[win.length - 1 - i] *= Math.exp(-3 * (i / tail))
    for (let i = 0; i < fade; i++) win[win.length - 1 - i] *= i / fade
    const fi = Math.min(win.length, Math.round(sr * 0.004))
    for (let i = 0; i < fi; i++) win[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fi)
    return win
  }
}
const sliceStats = (win, sr) => {
  const body = win.length > Math.round(sr * 0.08) ? win.slice(0, win.length - Math.round(sr * 0.08)) : win
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

// 每 cell：多个载词臂，每臂 ls ×2 掷，选 per 最优。capMs = 非定长切的上限。
const JOBS = [
  { slug: 'ra', arms: [{ text: 'とら', vowel: 'a', nth: 1 }], lss: [2.6, 3.2], capMs: 420 },
  { slug: 'ru', arms: [{ text: 'クルー', vowel: 'u', nth: 2, fixedMs: 390 }], lss: [2.6, 3.0], capMs: null },
  { slug: 'pa', arms: [{ text: 'ぱん', vowel: 'a', nth: 1 }], lss: [2.6, 3.2], capMs: 420 },
  { slug: 'ja', arms: [{ text: 'じゃんけん', vowel: 'a', nth: 1 }, { text: 'じゃがいも', vowel: 'a', nth: 1 }], lss: [2.6, 3.2], capMs: 420 },
  { slug: 'gyu', arms: [{ text: 'ぎゅう', vowel: 'u', nth: 1, fixedMs: 390 }], lss: [2.2, 2.6], capMs: null },
]

for (const job of JOBS) {
  let best = null
  for (const arm of job.arms) {
    for (const ls of job.lss) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        const r = await piper.synthesize(arm.text, { ...voice.params, lengthScale: ls, noiseScale: 0.5, noiseW: 0.5 })
        const loc = locateMora(r.timing.phonemes, arm.vowel, arm.nth)
        if (!loc) continue
        const cut = makeCut(r, r.sampleRate)
        const win = cut(Math.max(0, loc.onsetMs - 15), loc.vowelEndMs, arm.fixedMs)
        if (!win) continue
        const st = sliceStats(win, r.sampleRate)
        if (!best || st.per > best.st.per) best = { win, sr: r.sampleRate, st, ls, text: arm.text, attempt }
        if (best.st.per >= 0.93) break
      }
      if (best?.st.per >= 0.93) break
    }
    if (best?.st.per >= 0.93) break
  }
  if (!best) { log(`✗ ${job.slug}: 全掷失败`); continue }
  const mp3 = encodeMp3(polish(best.win, best.sr), best.sr, cfg.encode.bitrateKbps)
  await fs.writeFile(path.join(OUT_BASE, 'm', `${job.slug}.mp3`), mp3)
  D.stats.m[job.slug] = {
    voice: 'tsukuyomi-v1',
    strategy: `载词「${best.text}」ls${best.ls}`,
    form: best.text,
    dur: best.st.ms,
    per: Math.round(best.st.per * 100) / 100,
    zcr: Math.round(best.st.zcr * 100) / 100,
    attempts: best.attempt,
    flag: false,
  }
  log(`${job.slug}: 「${best.text}」ls${best.ls} → ${best.st.ms}ms per ${best.st.per}`)
}
await fs.writeFile(path.join(OUT_BASE, 'data.js'), 'window.KANA_VARIANTS = ' + JSON.stringify(D, null, 1) + '\n')
log('补切完成')
