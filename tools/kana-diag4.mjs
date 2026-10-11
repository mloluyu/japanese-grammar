#!/usr/bin/env node
// 第 4 轮诊断：延长音「Xー」首个元音末精切（C2） vs 三连「X、X、X。」中段精切（C1）。
// 都基于 AudioResult.timing 的音素级时间戳；timing 时间轴与音频时间轴的比例按每次合成实测校准。
// 顺带解决：は→片假名 ハー；へ→先验证 屁/変 的音素化；づ/ぢ 合并读音属预期（记录）。
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { voicedStats, peakOf } from './kana-seg.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
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
const onnxPath = path.join(ROOT, cfg.modelCacheDir, voiceId, voice.model.onnx)
currentConfigPath = path.join(ROOT, cfg.modelCacheDir, voiceId, voice.model.config)
const modelConfig = JSON.parse(await fs.readFile(currentConfigPath, 'utf8'))
const idToSym = new Map()
for (const [sym, ids] of Object.entries(modelConfig.phoneme_id_map ?? {})) {
  for (const id of ids) if (!idToSym.has(id)) idToSym.set(id, sym)
}
const piper = await PiperPlus.initialize({
  model: onnxPath,
  ort: await import('onnxruntime-web'),
  wasmG2pUrl: pathToFileURL(path.join(ROOT, 'node_modules/piper-plus/dist/rust-wasm/piper_plus_wasm.js')).href,
})
const dump = (t) => {
  const { phonemeIds } = piper._phonemizer.encode(t, 'ja')
  return phonemeIds.map((i) => idToSym.get(i) ?? `?${i}`).join('|')
}

log('== へ 替身音素化探测')
for (const t of ['屁', '屁ー', '変', '変ー', '蛇', '部屋']) log(`${t} → ${dump(t)}`)

// timing（ms）→ 音频样本索引：scale = 音频时长 / timing 末尾（每次合成实测）
function sliceByTiming(r, startMs, endMs, sr) {
  const lastEnd = r.timing.phonemes[r.timing.phonemes.length - 1].end_ms
  const scale = r.samples.length / sr / (lastEnd / 1000)
  const a = Math.max(0, Math.round((startMs / 1000) * sr * scale))
  const b = Math.min(r.samples.length, Math.round((endMs / 1000) * sr * scale))
  return r.samples.slice(a, b)
}
function sliceStats(s, sr) {
  const { per, zcr } = voicedStats(s, sr)
  return {
    ms: Math.round(s.length / sr * 1000),
    peakDb: Math.round(20 * Math.log10(Math.max(peakOf(s), 1e-9)) * 10) / 10,
    per, zcr,
  }
}

// C2：延长音首元音精切。timing 实项数 >=5 → 首莫拉元音是 E[2]；=4 → E[0]；=3 → E[0]（拨音）。
function cutLong(r) {
  const E = r.timing.phonemes
  const vi = E.length >= 5 ? 2 : 0
  return sliceByTiming(r, E[0].start_ms, E[vi].end_ms, r.sampleRate)
}
// C1：三连中段精切。9 实项（C,#,a ×3）→ 中段 = E[3].start … E[5].end。
function cutTriple(r) {
  const E = r.timing.phonemes
  if (E.length !== 9) return null
  return sliceByTiming(r, E[3].start_ms, E[5].end_ms, r.sampleRate)
}

const PARAMS_LONG = { ...voice.params, noiseScale: 0.667, lengthScale: 1.8, noiseW: 0.8 }
const PARAMS_TRI = { ...voice.params, noiseScale: 0.667, lengthScale: 1.0, noiseW: 0.8 }

const TEST = [
  ['い', 'いー'], ['な', 'なー'], ['ぬ', 'ぬー'], ['り', 'りー'], ['る', 'るー'],
  ['は', 'ハー'], ['ん', 'んー'], ['ぱ', 'ぱー'], ['つ', 'つー'], ['きゃ', 'きゃー'],
]
log('== C2 延长音首切 vs C1 三连中切（各 ≤4 掷，取首条合格切片）')
for (const [h, longText] of TEST) {
  for (const [tag, text, params, cutter] of [
    ['C2', longText, PARAMS_LONG, cutLong],
    ['C1', `${h}、${h}、${h}。`, PARAMS_TRI, cutTriple],
  ]) {
    let got = null
    for (let attempt = 1; attempt <= 4 && !got; attempt++) {
      const r = await piper.synthesize(text, params)
      const s = cutter(r)
      if (!s) { continue }
      const st = sliceStats(s, r.sampleRate)
      if (st.ms >= 100 && st.ms <= 500 && st.per >= 0.65 && st.zcr <= 0.35) got = { ...st, attempt }
    }
    log(got
      ? `  ✓ ${tag} ${h}: ${got.ms}ms peak ${got.peakDb}dB per ${got.per} zcr ${got.zcr}（第${got.attempt}掷）`
      : `  ✗ ${tag} ${h}: 4 掷无合格切片`)
  }
}
log('done')
