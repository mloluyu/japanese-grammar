#!/usr/bin/env node
// 五十音一次性参数试听探针·第 2 轮（延长音形态）。
// 诊断（tools/kana-diag.mjs）证实裸假名合成=纯噪声（分布外），延长音「かー」恢复有声。
// 本轮以「Xー」为文本形态，产出两组候选到 tools/kana-variants/{d,e}/，
// data.js 供 tools/kana-variants.html 试听；定型后固化进 scripts/generate-kana-audio.mjs。
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_BASE = path.join(ROOT, 'tools/kana-variants')
const DATA_FILE = path.join(ROOT, 'docs/.vitepress/theme/data/kana-data.json')

const log = (...m) => console.log(...m)
const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1) }

// ---- 垫片（与 generate-audio.mjs 相同）----------------------------------------------
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
const kanaData = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'))

const voiceId = Object.keys(cfg.voices).find((k) => cfg.voices[k].active)
if (!voiceId) die('没有 active 声音')
const voice = cfg.voices[voiceId]

// ---- 两组候选（文本形态统一为延长音「Xー」，参数不同）----------------------------------
const VARIANTS = [
  {
    id: 'd', label: 'D 稳',
    desc: '「かー」延长音 · lengthScale 1.8 · noiseScale 0.667 / noiseW 0.8',
    text: (h) => h + 'ー',
    params: { noiseScale: 0.667, lengthScale: 1.8, noiseW: 0.8 },
  },
  {
    id: 'e', label: 'E 缓',
    desc: '「かー。」延长音＋句号（带收尾语调）· lengthScale 2.4 · noiseScale 0.5 / noiseW 0.5',
    text: (h) => h + 'ー。',
    params: { noiseScale: 0.5, lengthScale: 2.4, noiseW: 0.5 },
  },
]
const NORM_PEAK = 0.6 // 与例句音频电平（原始峰值约 0.35）接近，同时抹平格间差异
const PAD_SEC = cfg.encode.tailSilenceSeconds ?? 0.35

// ---- 清单 ---------------------------------------------------------------------------
const cells = []
for (const part of ['seion', 'dakuten', 'yoon']) {
  const group = kanaData[part]
  const list = part === 'yoon' ? group.cells : group.rows.flatMap((r) => r.cells)
  for (const cell of list) if (cell) cells.push({ ...cell, slug: cell.s ?? cell.r })
}

// 清掉第 1 轮产物，避免陈旧文件混入试听页
await fs.rm(OUT_BASE, { recursive: true, force: true })

// ---- 编码 ---------------------------------------------------------------------------
const lameMod = await import('@breezystack/lamejs')
const lame = lameMod.Mp3Encoder ? lameMod : lameMod.default
if (!lame?.Mp3Encoder) die('lamejs 加载失败——先运行 npm run audio:setup')
function floatToInt16(samples) {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}
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

// ---- 主流程 -------------------------------------------------------------------------
const onnxPath = path.join(ROOT, cfg.modelCacheDir, voiceId, voice.model.onnx)
if (!existsSync(onnxPath)) die('模型缓存缺失——先运行 npm run audio:generate')
currentConfigPath = path.join(ROOT, cfg.modelCacheDir, voiceId, voice.model.config)
const piper = await PiperPlus.initialize({
  model: onnxPath,
  ort: await import('onnxruntime-web'),
  wasmG2pUrl: pathToFileURL(path.join(ROOT, 'node_modules/piper-plus/dist/rust-wasm/piper_plus_wasm.js')).href,
})

const stats = { d: {}, e: {} }
let failures = 0

for (const variant of VARIANTS) {
  const dir = path.join(OUT_BASE, variant.id)
  await fs.mkdir(dir, { recursive: true })
  log(`== 变体 ${variant.label}（${variant.desc}）`)
  for (const cell of cells) {
    try {
      const raw = await piper.synthesize(variant.text(cell.h), { ...voice.params, ...variant.params })
      let samples = raw.samples
      // 客观质检：过零率 + 周期性，检出退化为噪声的个别格子
      const m = (() => {
        let peak = 0
        for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]); if (a > peak) peak = a }
        return { peak }
      })()
      // 峰值归一化
      if (m.peak > 0) {
        const gain = NORM_PEAK / m.peak
        samples = samples.map((s) => s * gain)
      }
      const voicedSec = samples.length / raw.sampleRate
      if (PAD_SEC > 0) {
        const padded = new Float32Array(samples.length + Math.round(raw.sampleRate * PAD_SEC))
        padded.set(samples, 0)
        samples = padded
      }
      const mp3 = encodeMp3(samples, raw.sampleRate, cfg.encode.bitrateKbps)
      await fs.writeFile(path.join(dir, `${cell.slug}.mp3`), mp3)
      stats[variant.id][cell.slug] = {
        dur: Math.round(voicedSec * 1000),
        peak: m.peak > 0 ? Math.round(20 * Math.log10(m.peak) * 10) / 10 : -99,
      }
      log(`  ✓ ${variant.id}/${cell.slug}（${stats[variant.id][cell.slug].dur}ms, peak ${stats[variant.id][cell.slug].peak}dB）`)
    } catch (err) {
      failures++
      console.error(`  ✗ ${variant.id}/${cell.slug}: ${err.message}`)
    }
  }
}

// ---- data.js（试听页用）--------------------------------------------------------------
await fs.writeFile(
  path.join(OUT_BASE, 'data.js'),
  'window.KANA_VARIANTS = ' + JSON.stringify({ cells, variants: VARIANTS.map((v) => ({ id: v.id, label: v.label, desc: v.desc })), stats }, null, 1) + '\n',
)
log(`完成：${cells.length * VARIANTS.length - failures} 成功，${failures} 失败`)
if (failures) process.exit(1)
