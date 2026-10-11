#!/usr/bin/env node
// 五十音发音离线生成。数据源（唯一）：docs/.vitepress/theme/data/kana-data.json，
// 与 docs/kana/index.md 的 KanaChart 组件共用；本脚本不做台账（数据文件即来源，可幂等重跑）。
//
// 用法：
//   node scripts/generate-kana-audio.mjs           为缺失的假名生成音频
//   node scripts/generate-kana-audio.mjs --force   全部重新生成
//
// 依赖与例句管线相同（audio:setup 一次装齐）；模型/许可说明见 project-docs/DEVELOPMENT.md §4 与 ADR-0005。
// 注意：单假名不做拖长，lengthScale 用 1.2（例句用 1.7 是为了整句语速，单拍音会显得过分拖沓）。
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FORCE = process.argv.includes('--force')
const OUT_DIR = path.join(ROOT, 'docs/public/audio/kana')
const DATA_FILE = path.join(ROOT, 'docs/.vitepress/theme/data/kana-data.json')

const log = (...m) => console.log(...m)
const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1) }

// ---- Node 兼容垫片（与 generate-audio.mjs 相同，必须在 import piper-plus 前装好）----
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
const data = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'))

const activeIds = Object.keys(cfg.voices).filter((k) => cfg.voices[k].active)
if (activeIds.length !== 1) die(`active 声音必须恰好一个（当前：${activeIds.join(', ') || '无'}）`)
const voiceId = activeIds[0]
const voice = cfg.voices[voiceId]
const params = { ...voice.params, lengthScale: 1.2 }

// ---- 清单（三个部分摊平；音频文本固定用平假名 h）------------------------------------
const cells = []
for (const part of ['seion', 'dakuten', 'yoon']) {
  const group = data[part]
  const list = part === 'yoon' ? group.cells : group.rows.flatMap((r) => r.cells)
  for (const cell of list) if (cell) cells.push({ part, ...cell, slug: cell.s ?? cell.r })
}
const dup = cells.map((c) => c.slug).filter((s, i, a) => a.indexOf(s) !== i)
if (dup.length) die(`音频文件名重复：${[...new Set(dup)].join(', ')}`)
log(`五十音清单：${cells.length} 个假名（voice: ${voiceId}）`)

// ---- 模型缓存（复用例句管线目录，已下载则直接命中）------------------------------------
async function ensureModel() {
  const dir = path.join(ROOT, cfg.modelCacheDir, voiceId)
  await fs.mkdir(dir, { recursive: true })
  const onnxPath = path.join(dir, voice.model.onnx)
  const cfgPath = path.join(dir, voice.model.config)
  if (!existsSync(onnxPath) || !existsSync(cfgPath)) {
    die(`模型缓存缺失（${dir}）——先运行 npm run audio:generate 下载模型`)
  }
  return onnxPath
}

// ---- mp3 编码（与 generate-audio.mjs 相同）------------------------------------------
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

// ---- 主流程 --------------------------------------------------------------------------
const pending = cells.filter((c) => FORCE || !existsSync(path.join(OUT_DIR, `${c.slug}.mp3`)))
log(`待生成 ${pending.length} 个${FORCE ? '（--force 全量）' : ''}`)
if (!pending.length) process.exit(0)

await fs.mkdir(OUT_DIR, { recursive: true })
const onnxPath = await ensureModel()
currentConfigPath = path.join(ROOT, cfg.modelCacheDir, voiceId, voice.model.config)
const piper = await PiperPlus.initialize({
  model: onnxPath,
  ort: await import('onnxruntime-web'),
  wasmG2pUrl: pathToFileURL(path.join(ROOT, 'node_modules/piper-plus/dist/rust-wasm/piper_plus_wasm.js')).href,
})

let failures = 0
for (const cell of pending) {
  try {
    const raw = await piper.synthesize(cell.h, params)
    const padSec = cfg.encode.tailSilenceSeconds ?? 0
    let samples = raw.samples
    if (padSec > 0) {
      const padded = new Float32Array(samples.length + Math.round(raw.sampleRate * padSec))
      padded.set(samples, 0)
      samples = padded
    }
    const mp3 = encodeMp3(samples, raw.sampleRate, cfg.encode.bitrateKbps)
    await fs.writeFile(path.join(OUT_DIR, `${cell.slug}.mp3`), mp3)
    log(`  ✓ ${cell.h}（${cell.r} → ${cell.slug}.mp3, ${(mp3.length / 1024).toFixed(0)}KB）`)
  } catch (err) {
    failures++
    console.error(`  ✗ ${cell.h}（${cell.r}）: ${err.message}`)
  }
}
log(`完成：${pending.length - failures} 成功，${failures} 失败`)
if (failures) process.exit(1)
