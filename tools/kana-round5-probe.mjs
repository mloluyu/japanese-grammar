#!/usr/bin/env node
// 第 5 轮：逐格语速校准，统一发音时长到目标 580ms（用户实测 580ms 左右效果最好）。
// 单臂 = tsukuyomi（css10 已被用户否决并删除）。模型无绝对时长参数，
// 用 lengthScale 反馈迭代：合成→量切片+延尾后的实际时长→ls *= 目标/实际→重掷，直到 |d-580|<=30ms。
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

const TARGET = 580
const TOL = 30
const LS_MIN = 0.8
const LS_MAX = 6.0
const BASE_LS = { 延长切: 2.6, 延长句号切: 2.6, 三连切: 1.3, 时长中段切: 2.0 }

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

const sliceByTiming = (r, startMs, endMs, sr) => {
  const E = r.timing.phonemes
  const lastEnd = E[E.length - 1].end_ms
  const scale = r.samples.length / sr / (lastEnd / 1000)
  const a = Math.max(0, Math.round((startMs / 1000) * sr * scale))
  const b = Math.min(r.samples.length, Math.round((endMs / 1000) * sr * scale))
  return { s: r.samples.slice(a, b), a, b }
}
function extendDecay(r, a, b, sr) {
  const win = Math.round(sr * 0.02)
  const hop = Math.round(sr * 0.005)
  const cap = b + Math.round(sr * 0.22)
  const peak = peakOf(r.samples.slice(a, b))
  const gate = Math.max(0.018, 0.07 * peak)
  let end = b
  for (let t = b; t + win < Math.min(r.samples.length, cap); t += hop) {
    let sum = 0
    for (let i = t; i < t + win; i++) sum += r.samples[i] * r.samples[i]
    const rms = Math.sqrt(sum / win)
    if (rms < gate) break
    end = t + win
  }
  return r.samples.slice(a, Math.max(b, Math.min(end, cap)))
}
const cutLong = (r) => {
  const E = r.timing.phonemes
  if (E.length < 3) return null
  const vi = E.length >= 5 ? 2 : 0
  const { s, a, b } = sliceByTiming(r, E[0].start_ms - 15, E[vi].end_ms, r.sampleRate)
  return extendDecay(r, a, b, r.sampleRate)
}
const cutTriple = (r) => {
  const E = r.timing.phonemes
  if (E.length < 3 || E.length % 3 !== 0) return null
  const m = E.length / 3
  const { s, a, b } = sliceByTiming(r, E[m].start_ms - 15, E[2 * m - 1].end_ms, r.sampleRate)
  return extendDecay(r, a, b, r.sampleRate)
}
const cutDurMid = (r) => {
  const a = Math.round(r.samples.length * 0.35)
  const b = Math.round(r.samples.length * 0.65)
  return extendDecay(r, a, b, r.sampleRate)
}
const cutFor = (strategy) => strategy === '延长切' || strategy === '延长句号切' ? cutLong : strategy === '三连切' ? cutTriple : cutDurMid
const textFor = (base, strategy) =>
  strategy === '延长切' ? `${base}ー` : strategy === '延长句号切' ? `${base}ー。` : `${base}、${base}、${base}。`
const baseOf = (h) => (h === 'は' ? 'ハ' : h === 'へ' ? '屁' : h)

const sliceStats = (s, sr) => {
  const { per, zcr } = voicedStats(s, sr)
  return { ms: Math.round((s.length / sr) * 1000), per, zcr }
}
function polish(slice, sr) {
  const fi = Math.round(sr * 0.006), fo = Math.round(sr * 0.012)
  for (let i = 0; i < fi && i < slice.length; i++) slice[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fi)
  for (let i = 0; i < fo && i < slice.length; i++) slice[slice.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fo)
  const peak = peakOf(slice)
  if (peak > 0) { const g = 0.6 / peak; for (let i = 0; i < slice.length; i++) slice[i] *= g }
  const out = new Float32Array(slice.length + Math.round(sr * (0.08 + 0.24)))
  out.set(slice, Math.round(sr * 0.08))
  return out
}

const dataRaw = await fs.readFile(path.join(OUT_BASE, 'data.js'), 'utf8')
const D = JSON.parse(dataRaw.replace(/^window\.KANA_VARIANTS = /, '').trim())
await fs.mkdir(path.join(OUT_BASE, 'i'), { recursive: true })
D.stats.i = {}

let done = 0
for (const cell of D.cells) {
  const slug = cell.slug
  const strategy = D.stats.f[slug].strategy
  const text = textFor(baseOf(cell.h), strategy)
  const cut = cutFor(strategy)
  const dPrev = D.stats.h[slug]?.dur ?? D.stats.f[slug].dur ?? 260
  let ls = Math.min(LS_MAX, Math.max(LS_MIN, (BASE_LS[strategy] ?? 2.0) * (TARGET / dPrev)))
  let best = null
  let iters = 0
  for (let attempt = 1; attempt <= 5; attempt++) {
    iters = attempt
    const r = await piper.synthesize(text, { ...voice.params, lengthScale: ls })
    const raw = cut(r)
    if (!raw || raw.length < 8) { ls = Math.min(LS_MAX, ls * 1.3); continue }
    const st = sliceStats(raw, r.sampleRate)
    const score = Math.abs(st.ms - TARGET) / TARGET + (st.per < 0.75 ? 1 : 0)
    if (!best || score < best._score) best = { raw, sr: r.sampleRate, st, ls, _score: score }
    if (Math.abs(st.ms - TARGET) <= TOL && st.per >= 0.75) break
    ls = Math.min(LS_MAX, Math.max(LS_MIN, ls * Math.min(2.5, Math.max(0.5, TARGET / st.ms))))
  }
  const chosen = best
  if (!chosen) { log(`✗ ${slug}: 全掷失败`); D.stats.i[slug] = { flag: true, attempts: iters }; continue }
  const mp3 = encodeMp3(polish(chosen.raw, chosen.sr), chosen.sr, cfg.encode.bitrateKbps)
  await fs.writeFile(path.join(OUT_BASE, 'i', `${slug}.mp3`), mp3)
  D.stats.i[slug] = {
    voice: 'tsukuyomi-v1',
    strategy,
    dur: chosen.st.ms,
    per: Math.round(chosen.st.per * 100) / 100,
    zcr: Math.round(chosen.st.zcr * 100) / 100,
    attempts: iters,
    ls: Math.round(chosen.ls * 100) / 100,
    flag: chosen.st.per < 0.75 || Math.abs(chosen.st.ms - TARGET) > 60,
  }
  done++
  if (done % 10 === 0) log(`进度 ${done}/104`)
}
D.variants = [
  ...D.variants.filter((v) => v.id !== 'i'),
  { id: 'i', label: 'I 统一580', desc: 'tsukuyomi 逐格语速校准至 580ms · 衰减延尾 · 峰值 0.6' },
]
await fs.writeFile(path.join(OUT_BASE, 'data.js'), 'window.KANA_VARIANTS = ' + JSON.stringify(D, null, 1) + '\n')
const es = Object.entries(D.stats.i).filter(([, s]) => s.dur)
const durs = es.map(([, s]) => s.dur).sort((a, b) => a - b)
log(`I 列：${es.length} 格；时长 ${durs[0]}–${durs[durs.length - 1]}ms（中位 ${durs[Math.floor(durs.length / 2)]}）；580±30 达标 ${es.filter(([, s]) => Math.abs(s.dur - TARGET) <= TOL).length}；flag ${es.filter(([, s]) => s.flag).length}`)
log('完成')
