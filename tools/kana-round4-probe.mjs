#!/usr/bin/env node
// 第 4 轮：问题格双臂对比。
// 用户第 3 轮反馈：很多假名发音太短、电流音重。对策：
//  G = css10 模型慢速重切（换声音模型；许可更干净：CSS10 public domain）
//  H = tsukuyomi 模型慢速重切（同模型，lengthScale 放慢约 1.5 倍）
// 共同改进：切片起点前移 15ms（保留辅音起振）、结尾按能量衰减自然延尾（最多 +220ms，不再硬掐）、淡出 12ms、per 验收提高。
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

async function ensureModel(voiceId, voice) {
  const dir = path.join(ROOT, cfg.modelCacheDir, voiceId)
  await fs.mkdir(dir, { recursive: true })
  const onnx = path.join(dir, voice.model.onnx)
  const conf = path.join(dir, voice.model.config)
  const base = `https://huggingface.co/${voice.model.repo}/resolve/main/`
  for (const [file, dest] of [[voice.model.onnx, onnx], [voice.model.config, conf]]) {
    if (existsSync(dest)) continue
    log(`下载 ${voiceId}/${file} …`)
    const res = await realFetch(base + file)
    if (!res.ok) throw new Error(`下载失败 ${base + file}: ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    await fs.writeFile(dest + '.part', buf)
    await fs.rename(dest + '.part', dest)
  }
  return { onnx, conf }
}

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

async function initVoice(voiceId, voiceOverride) {
  const voice = voiceOverride ?? cfg.voices[voiceId]
  const { onnx, conf } = await ensureModel(voiceId, voice)
  currentConfigPath = conf
  const piper = await PiperPlus.initialize({
    model: onnx,
    ort: await import('onnxruntime-web'),
    wasmG2pUrl: pathToFileURL(path.join(ROOT, 'node_modules/piper-plus/dist/rust-wasm/piper_plus_wasm.js')).href,
  })
  return { piper, voice }
}
// css10 条目已从 audio.config.json 移除，此处内联定义（参数沿用此前文档记录值）；数据许可 CSS10 public domain
const CSS10 = {
  label: 'CSS10 ja（public domain）',
  model: { repo: 'ayousanz/piper-plus-css10-ja-6lang', onnx: 'css10-ja-6lang-fp16.onnx', config: 'config.json' },
  params: { language: 'ja', noiseScale: 0.667, lengthScale: 1.2, noiseW: 0.5 },
}
log('初始化 css10-ja-v1 …')
const css = await initVoice('css10-ja-v1', CSS10)
log('初始化 tsukuyomi-v1 …')
const tsu = await initVoice('tsukuyomi-v1')
log('两个模型就绪')

const sliceByTiming = (r, startMs, endMs, sr) => {
  const E = r.timing.phonemes
  const lastEnd = E[E.length - 1].end_ms
  const scale = r.samples.length / sr / (lastEnd / 1000)
  const a = Math.max(0, Math.round((startMs / 1000) * sr * scale))
  const b = Math.min(r.samples.length, Math.round((endMs / 1000) * sr * scale))
  return { s: r.samples.slice(a, b), a, b }
}
// 能量衰减延尾：从切片终点向后找 RMS 降到噪声门以下的位置（最多 +220ms）
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
const okSlice = (st) => st.ms >= 90 && st.ms <= 600 && st.per >= 0.75 && st.zcr <= 0.35
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

const LS_G = { 延长切: 2.8, 延长句号切: 2.8, 三连切: 1.4, 时长中段切: 2.2 }
const LS_H = { 延长切: 2.6, 延长句号切: 2.6, 三连切: 1.3, 时长中段切: 2.0 }

const dataRaw = await fs.readFile(path.join(OUT_BASE, 'data.js'), 'utf8')
const D = JSON.parse(dataRaw.replace(/^window\.KANA_VARIANTS = /, '').trim())
const problemCells = Object.keys(D.stats.f).filter((k) => {
  const s = D.stats.f[k]
  return s.dur < 160 || (s.per ?? 1) < 0.8
})
problemCells.sort((a, b) => (D.stats.f[a].dur ?? 999) - (D.stats.f[b].dur ?? 999))
log(`问题格 ${problemCells.length} 个: ${problemCells.join(' ')}`)
await fs.mkdir(path.join(OUT_BASE, 'g'), { recursive: true })
await fs.mkdir(path.join(OUT_BASE, 'h'), { recursive: true })
D.stats.g = D.stats.g ?? {}
D.stats.h = D.stats.h ?? {}

const ARMS = [
  { id: 'g', engine: css.piper, voice: css.voice, lsMap: LS_G },
  { id: 'h', engine: tsu.piper, voice: tsu.voice, lsMap: LS_H },
]
let done = 0
for (const slug of problemCells) {
  const cell = D.cells.find((c) => c.slug === slug)
  if (!cell) { log(`✗ ${slug}: cells 中找不到`); continue }
  const strategy = D.stats.f[slug].strategy
  for (const arm of ARMS) {
    const base = baseOf(cell.h)
    const text = textFor(base, strategy)
    const cut = cutFor(strategy)
    const params = { ...arm.voice.params, lengthScale: arm.lsMap[strategy] ?? arm.voice.params.lengthScale }
    let picked = null, best = null
    for (let attempt = 1; attempt <= 4; attempt++) {
      const r = await arm.engine.synthesize(text, params)
      const raw = cut(r)
      if (!raw || raw.length < 8) continue
      const st = sliceStats(raw, r.sampleRate)
      const score = st.per * 2 - Math.abs(st.ms - 270) / 500
      const cand = { raw, sr: r.sampleRate, st, attempt }
      if (okSlice(st)) { picked = cand; break }
      if (!best || score > best._score) best = { ...cand, _score: score }
    }
    const chosen = picked ?? best
    if (!chosen) { log(`✗ ${slug} ${arm.id}: 全掷失败`); D.stats[arm.id][slug] = { flag: true, attempts: 4 }; continue }
    const mp3 = encodeMp3(polish(chosen.raw, chosen.sr), chosen.sr, cfg.encode.bitrateKbps)
    await fs.writeFile(path.join(OUT_BASE, arm.id, `${slug}.mp3`), mp3)
    D.stats[arm.id][slug] = {
      voice: arm.voice === css.voice ? 'css10-ja-v1' : 'tsukuyomi-v1',
      strategy, dur: chosen.st.ms,
      per: Math.round(chosen.st.per * 100) / 100,
      zcr: Math.round(chosen.st.zcr * 100) / 100,
      attempts: chosen.attempt,
      flag: !picked,
    }
  }
  done++
  if (done % 5 === 0) log(`进度 ${done}/${problemCells.length}`)
}

D.variants = [
  ...D.variants.filter((v) => v.id !== 'g' && v.id !== 'h'),
  { id: 'g', label: 'G 换模型', desc: 'css10 慢速重切 · 衰减延尾 · 峰值 0.6 · 64kbps' },
  { id: 'h', label: 'H 慢速', desc: 'tsukuyomi 慢速重切 · 衰减延尾 · 峰值 0.6 · 64kbps' },
]
await fs.writeFile(path.join(OUT_BASE, 'data.js'), 'window.KANA_VARIANTS = ' + JSON.stringify(D, null, 1) + '\n')
for (const id of ['g', 'h']) {
  const es = Object.values(D.stats[id])
  log(`${id}: ${es.length} 格，flag ${es.filter((s) => s.flag).length}，per<0.8 ${es.filter((s) => (s.per ?? 1) < 0.8).length}，dur<160 ${es.filter((s) => (s.dur ?? 0) < 160).length}`)
}
log('完成')
