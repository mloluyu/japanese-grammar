#!/usr/bin/env node
// 第 3 轮补切：只重做 FLAG 的 4 格（e / n / shu / ha），并把结果就地合并进 data.js。
// 新战术：三连「首莫拉切片」（首莫拉不被重复加速，全长可靠）＋ 延长音加掷。
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
const voiceId = Object.keys(cfg.voices).find((k) => cfg.voices[k].active)
const voice = cfg.voices[voiceId]

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

const onnxPath = path.join(ROOT, cfg.modelCacheDir, voiceId, voice.model.onnx)
if (!existsSync(onnxPath)) process.exit(1)
currentConfigPath = path.join(ROOT, cfg.modelCacheDir, voiceId, voice.model.config)
const piper = await PiperPlus.initialize({
  model: onnxPath,
  ort: await import('onnxruntime-web'),
  wasmG2pUrl: pathToFileURL(path.join(ROOT, 'node_modules/piper-plus/dist/rust-wasm/piper_plus_wasm.js')).href,
})

function sliceByTiming(r, startMs, endMs, sr) {
  const E = r.timing.phonemes
  const lastEnd = E[E.length - 1].end_ms
  const scale = r.samples.length / sr / (lastEnd / 1000)
  const a = Math.max(0, Math.round((startMs / 1000) * sr * scale))
  const b = Math.min(r.samples.length, Math.round((endMs / 1000) * sr * scale))
  return r.samples.slice(a, b)
}
// 延长音首元音末切（E≥5→E[2]，否则 E[0]）
const cutLong = (r) => {
  const E = r.timing.phonemes
  if (E.length < 3) return null
  const vi = E.length >= 5 ? 2 : 0
  return sliceByTiming(r, E[0].start_ms, E[vi].end_ms, r.sampleRate)
}
// 三连首莫拉切片：E[0].start … E[mid-1].end（mid = E.length/3）
const cutFirst = (r) => {
  const E = r.timing.phonemes
  if (E.length < 3 || E.length % 3 !== 0) return null
  const mid = E.length / 3
  return sliceByTiming(r, E[0].start_ms, E[mid - 1].end_ms, r.sampleRate)
}
const sliceStats = (s, sr) => {
  const { per, zcr } = voicedStats(s, sr)
  return { ms: Math.round((s.length / sr) * 1000), per, zcr }
}
const okSlice = (st) => st.ms >= 80 && st.ms <= 550 && st.per >= 0.65 && st.zcr <= 0.35
function polish(slice, sr) {
  const f = Math.round(sr * 0.006)
  for (let i = 0; i < f && i < slice.length; i++) {
    const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / f)
    slice[i] *= g
    slice[slice.length - 1 - i] *= g
  }
  const peak = peakOf(slice)
  if (peak > 0) { const gain = 0.6 / peak; for (let i = 0; i < slice.length; i++) slice[i] *= gain }
  const out = new Float32Array(slice.length + Math.round(sr * (0.08 + 0.28)))
  out.set(slice, Math.round(sr * 0.08))
  return out
}

const baseOf = (h) => (h === 'は' ? 'ハ' : h === 'へ' ? '屁' : h)
const triple = (b) => `${b}、${b}、${b}。`
// 每格的战术序列（按顺序，先过先用）
const CELL_PLANS = {
  e: [
    { tag: '三连首切', text: () => triple('え'), params: { noiseScale: 0.667, lengthScale: 1.0, noiseW: 0.8 }, cut: cutFirst, rolls: 4 },
    { tag: '延长切', text: () => 'えー', params: { noiseScale: 0.667, lengthScale: 1.8, noiseW: 0.8 }, cut: cutLong, rolls: 4 },
  ],
  n: [
    { tag: '延长切', text: () => 'んー', params: { noiseScale: 0.667, lengthScale: 1.8, noiseW: 0.8 }, cut: cutLong, rolls: 8 },
    { tag: '三连首切', text: () => triple('ん'), params: { noiseScale: 0.667, lengthScale: 1.0, noiseW: 0.8 }, cut: cutFirst, rolls: 3 },
  ],
  shu: [
    { tag: '延长切', text: () => 'しゅー', params: { noiseScale: 0.667, lengthScale: 1.8, noiseW: 0.8 }, cut: cutLong, rolls: 4 },
    { tag: '三连首切', text: () => triple('しゅ'), params: { noiseScale: 0.667, lengthScale: 1.0, noiseW: 0.8 }, cut: cutFirst, rolls: 3 },
  ],
  ha: [
    { tag: '延长切', text: () => 'ハー', params: { noiseScale: 0.667, lengthScale: 1.8, noiseW: 0.8 }, cut: cutLong, rolls: 4 },
  ],
}

const dataRaw = await fs.readFile(path.join(OUT_BASE, 'data.js'), 'utf8')
const D = JSON.parse(dataRaw.replace(/^window\.KANA_VARIANTS = /, '').trim())
const slugToCell = new Map(D.cells.map((c) => [c.slug, c]))

for (const [slug, plans] of Object.entries(CELL_PLANS)) {
  const cell = slugToCell.get(slug)
  if (!cell) { log(`✗ ${slug}: kana-data 无此 slug`); continue }
  let picked = null
  let best = null
  let usedTotal = 0
  outer: for (const strat of plans) {
    const params = { ...voice.params, ...strat.params }
    for (let attempt = 1; attempt <= strat.rolls; attempt++) {
      usedTotal++
      const r = await piper.synthesize(strat.text(), params)
      const slice = strat.cut(r)
      if (!slice || slice.length < 8) continue
      const st = sliceStats(slice, r.sampleRate)
      const cand = { slice, sr: r.sampleRate, st, strategy: strat.tag, attempt: usedTotal }
      if (okSlice(st)) { picked = cand; break outer }
      const score = st.per - Math.abs(st.ms - 250) / 1000
      if (!best || score > best._score) best = { ...cand, _score: score }
    }
  }
  const chosen = picked ?? best
  if (!chosen) { log(`✗ ${slug}: 全掷失败`); continue }
  const flagged = !picked
  const mp3 = encodeMp3(polish(chosen.slice, chosen.sr), chosen.sr, cfg.encode.bitrateKbps)
  await fs.writeFile(path.join(OUT_BASE, 'f', `${slug}.mp3`), mp3)
  D.stats.f[slug] = {
    strategy: chosen.strategy,
    dur: chosen.st.ms,
    per: Math.round(chosen.st.per * 100) / 100,
    zcr: Math.round(chosen.st.zcr * 100) / 100,
    attempts: flagged ? 99 : chosen.attempt,
    flag: flagged,
  }
  log(`${flagged ? '⚠' : '✓'} ${slug}: ${chosen.strategy} ${chosen.st.ms}ms per ${chosen.st.per.toFixed(2)}（共 ${chosen.attempt} 掷）${flagged ? ' FLAG' : ''}`)
}

await fs.writeFile(path.join(OUT_BASE, 'data.js'), 'window.KANA_VARIANTS = ' + JSON.stringify(D, null, 1) + '\n')
const still = Object.values(D.stats.f).filter((s) => s.flag).map((_, i) => i)
log(`data.js 已更新；剩余 FLAG ${Object.values(D.stats.f).filter((s) => s.flag).length} 格`)
