#!/usr/bin/env node
// 诊断：裸假名 vs 延长音（Xー）的合成质量。直接分析 PCM（不经 MP3），输出
// 时长 / 原始峰值 / 过零率(ZCR) / 周期性(自相关峰值) —— 周期性高=有声元音，低=噪声。
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const log = (...m) => console.log(...m)
const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1) }

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
if (!existsSync(onnxPath)) die('模型缓存缺失')
currentConfigPath = path.join(ROOT, cfg.modelCacheDir, voiceId, voice.model.config)
const piper = await PiperPlus.initialize({
  model: onnxPath,
  ort: await import('onnxruntime-web'),
  wasmG2pUrl: pathToFileURL(path.join(ROOT, 'node_modules/piper-plus/dist/rust-wasm/piper_plus_wasm.js')).href,
})

// ---- 指标 ---------------------------------------------------------------------------
function midFrame(s) {
  // 取能量最大的 2048 样本窗（窗口滑动步长 256）
  let best = 0, bestRms = -1
  for (let off = 0; off + 2048 <= s.length; off += 256) {
    let sum = 0
    for (let i = 0; i < 2048; i++) { const v = s[off + i]; sum += v * v }
    if (sum > bestRms) { bestRms = sum; best = off }
  }
  if (s.length < 2048) return s
  return s.subarray(best, best + 2048)
}
function metrics(s, sr) {
  let peak = 0
  for (let i = 0; i < s.length; i++) { const a = Math.abs(s[i]); if (a > peak) peak = a }
  const f = midFrame(s)
  const n = f.length
  let mean = 0
  for (let i = 0; i < n; i++) mean += f[i]
  mean /= n
  const x = new Float32Array(n)
  for (let i = 0; i < n; i++) x[i] = f[i] - mean
  // ZCR
  let zc = 0
  for (let i = 1; i < n; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) zc++
  const zcr = zc / n
  // 周期性：归一化自相关峰值（lag 55..275 ≈ F0 80–400Hz @22.05k）
  let e0 = 0
  for (let i = 0; i < n; i++) e0 += x[i] * x[i]
  let per = 0
  for (let lag = 55; lag <= 275; lag++) {
    let r = 0, e1 = 0, e2 = 0
    for (let i = 0; i + lag < n; i++) { r += x[i] * x[i + lag]; e1 += x[i] * x[i]; e2 += x[i + lag] * x[i + lag] }
    const norm = r / Math.sqrt(Math.max(e1 * e2, 1e-12))
    if (norm > per) per = norm
  }
  return {
    ms: Math.round(s.length / sr * 1000),
    peakDb: Math.round(20 * Math.log10(Math.max(peak, 1e-9)) * 10) / 10,
    zcr: Math.round(zcr * 1000) / 1000,
    per: Math.round(per * 100) / 100,
  }
}

// ---- 待测文本 ------------------------------------------------------------------------
const bare = ['か', 'い', 'な', 'ぬ', 'り', 'る', 'へ', 'ら', 'きゃ']
const cases = [{ tag: '参照·句子', text: 'こんにちは、今日は良い天気ですね。', params: voice.params }]
const LS = { bare: 2.2, long: 1.8 }
for (const h of bare) {
  cases.push({ tag: `裸 ${h}`, text: h, params: { ...voice.params, noiseScale: 0.5, lengthScale: LS.bare, noiseW: 0.3 } })
  cases.push({ tag: `延 ${h}ー`, text: h + 'ー', params: { ...voice.params, noiseScale: 0.667, lengthScale: LS.long, noiseW: 0.8 } })
  cases.push({ tag: `延 ${h}ー。`, text: h + 'ー。', params: { ...voice.params, noiseScale: 0.667, lengthScale: LS.long, noiseW: 0.8 } })
}

log('tag | ms | peak dB | ZCR(低=有声) | 周期性(高=有声)')
for (const c of cases) {
  try {
    const r = await piper.synthesize(c.text, c.params)
    const m = metrics(r.samples, r.sampleRate)
    log(`${c.tag} | ${m.ms} | ${m.peakDb} | ${m.zcr} | ${m.per}`)
  } catch (err) {
    log(`${c.tag} | ERR ${err.message}`)
  }
}
log('done')
