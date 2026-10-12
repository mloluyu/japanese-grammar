#!/usr/bin/env node
// 例句音频离线生成管线。设计说明：project-docs/DEVELOPMENT.md「音频生成」；许可台账见 scripts/audio.config.json。
//
// 用法：
//   node scripts/generate-audio.mjs --check            仅核对缺失/过期，不生成
//   node scripts/generate-audio.mjs                    为 active 声音生成缺失/过期音频
//   node scripts/generate-audio.mjs --voice css10-ja-v1 [--voice tsukuyomi-v1]
//   node scripts/generate-audio.mjs --all              全部声音（试点/盲听用）
//
// 依赖不入 package.json（npm install 会剪掉 no-save 包），用 audio:setup 一次装齐：
//   npm run audio:setup
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL, fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CFG_PATH = path.join(ROOT, 'scripts/audio.config.json')
const args = process.argv.slice(2)
const VERBOSE = args.includes('--verbose')

const log = (...m) => console.log(...m)
const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1) }
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

// ---- 参数 ------------------------------------------------------------------
const voiceArgs = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--voice') {
    const v = args[++i]
    if (!v) die('--voice 需要声音 ID')
    voiceArgs.push(v)
  }
}
const MODE_CHECK = args.includes('--check')
const MODE_ALL = args.includes('--all')
const STRICT = args.includes('--strict')

// ---- Node 兼容垫片（必须在 import piper-plus 前装好）------------------------
// ort wasm 后端在 Node 里把模型路径字符串直接交给 fs，不会发 http 请求；
// 库内部又用 fetch 读 config —— 这里把「非 http 的 fetch」适配为本地文件读取。
const realFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input)
  if (!/^https?:\/\//i.test(url)) {
    const p = url.startsWith('file://') ? fileURLToPath(url) : path.resolve(url)
    return new Response(await fs.readFile(p), { status: 200 })
  }
  return realFetch(input, init)
}

// 库的 _resolveUrls 不认本地路径（会去打 HF API），在这里拦截：
// 脚本传入的 model 一律是本地 onnx 绝对路径；config 文件名不必与 onnx 同名
// （本仓库模型用 config.json），由 currentConfigPath 提供。
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

const cfg = JSON.parse(await fs.readFile(CFG_PATH, 'utf8'))
const { outputDir, manifestFile, audioUrlPrefix, modelCacheDir, encode, engine } = cfg

// ---- 选声音 ------------------------------------------------------------------
let voiceIds
if (voiceArgs.length) {
  voiceIds = voiceArgs
} else if (MODE_ALL) {
  voiceIds = Object.keys(cfg.voices)
} else {
  voiceIds = Object.keys(cfg.voices).filter((id) => cfg.voices[id].active)
}
for (const id of voiceIds) if (!cfg.voices[id]) die(`audio.config.json 里没有声音「${id}」`)
const activeIds = Object.keys(cfg.voices).filter((k) => cfg.voices[k].active)
if (activeIds.length > 1) die(`active 声音多于一个（${activeIds.join(', ')}）——例句 JSON 的 audio 字段只能指向一个声音`)
if (!voiceIds.length) {
  log('没有要处理的声音（config 里 active 均为 false；用 --voice / --all 指定）。')
  process.exit(0)
}

// ---- 例句清单 ------------------------------------------------------------------
const grammarDir = path.join(ROOT, 'content/grammar')
const exampleFiles = (await fs.readdir(grammarDir)).filter((f) => f.endsWith('.json')).sort()
const examples = [] // {exampleId, grammarId, text, reading, filePath}
for (const f of exampleFiles) {
  const filePath = path.join(grammarDir, f)
  const data = JSON.parse(await fs.readFile(filePath, 'utf8'))
  for (const ex of data.examples ?? []) {
    examples.push({
      exampleId: ex.id,
      grammarId: data.grammarId,
      text: ex.text,
      reading: ex.reading ?? null,
      filePath,
    })
  }
}
const dup = examples.map((e) => e.exampleId).filter((id, i, a) => a.indexOf(id) !== i)
if (dup.length) die(`例句 ID 重复：${[...new Set(dup)].join(', ')}（ID 必须全站唯一）`)
const byId = new Map(examples.map((e) => [e.exampleId, e]))

// ---- manifest ------------------------------------------------------------------
const manifestPath = path.join(ROOT, manifestFile)
let manifest = { schema_version: 1, items: {} }
try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) } catch { /* 首次生成 */ }
manifest.schema_version = 1
manifest.items ??= {}

// ---- 模型缓存 ------------------------------------------------------------------
function fingerprint(voice) {
  return sha256(JSON.stringify({ engine, model: voice.model, params: voice.params, encode }))
}
async function ensureModel(voiceId, voice) {
  const dir = path.join(ROOT, modelCacheDir, voiceId)
  await fs.mkdir(dir, { recursive: true })
  const onnxPath = path.join(dir, voice.model.onnx)
  const cfgPath = path.join(dir, voice.model.config)
  if (!existsSync(onnxPath) || !existsSync(cfgPath)) {
    log(`下载模型 ${voiceId}（${voice.model.repo}）→ ${path.relative(ROOT, dir)}`)
    for (const [file, dest] of [
      [voice.model.onnx, onnxPath],
      [voice.model.config, cfgPath],
    ]) {
      const url = `https://huggingface.co/${voice.model.repo}/resolve/main/${file}`
      let buf = null
      for (let attempt = 1; ; attempt++) {
        try {
          const res = await realFetch(url)
          if (!res.ok) die(`下载失败 ${url} → ${res.status} ${res.statusText}`)
          buf = Buffer.from(await res.arrayBuffer())
          const expect = res.headers.get('content-length')
          if (expect && buf.length !== Number(expect)) throw new Error(`大小不符 ${buf.length}/${expect}`)
          break
        } catch (e) {
          if (attempt >= 3) die(`下载失败 ${url}（重试 ${attempt} 次后放弃）：${e.cause?.code ?? e.message}`)
          log(`  下载中断（${e.cause?.code ?? e.message}），3 秒后重试 ${attempt}/3`)
          await new Promise((r) => setTimeout(r, 3000))
        }
      }
      await fs.writeFile(dest + '.part', buf)
      await fs.rename(dest + '.part', dest)
      log(`  ${file}（${(buf.length / 1024 / 1024).toFixed(1)}MB, sha256 ${sha256(buf).slice(0, 12)}…）`)
    }
  } else if (VERBOSE) {
    log(`模型缓存命中 ${voiceId}`)
  }
  return onnxPath
}

// ---- 状态核对 ------------------------------------------------------------------
function itemKey(voiceId, exampleId) { return `${voiceId}/${exampleId}` }

function staleness(voiceId, voice, onnxSha) {
  // 返回 {missing:[ids], stale:[{id, reason}]}
  const missing = []
  const stale = []
  const fp = fingerprint(voice)
  for (const ex of examples) {
    const item = manifest.items[itemKey(voiceId, ex.exampleId)]
    const file = path.join(ROOT, outputDir, voiceId, ex.grammarId, `${ex.exampleId}.mp3`)
    if (!item || !existsSync(file)) { missing.push(ex.exampleId); continue }
    const tts = (ex.reading?.trim() || ex.text)
    const reasons = []
    if (item.textSha256 !== sha256(Buffer.from(tts, 'utf8'))) reasons.push('文本已改')
    if (item.fingerprint !== fp) reasons.push('引擎/模型/参数已改')
    if (onnxSha && item.modelOnnxSha256 && item.modelOnnxSha256 !== onnxSha) reasons.push('模型文件已变')
    if (reasons.length) stale.push({ id: ex.exampleId, reason: reasons.join('、') })
  }
  return { missing, stale }
}

// ---- mp3 编码 ------------------------------------------------------------------
const lameMod = await import('@breezystack/lamejs')
const lame = lameMod.Mp3Encoder ? lameMod : lameMod.default
if (!lame?.Mp3Encoder) die('lamejs 加载失败（未找到 Mp3Encoder）——先运行 npm run audio:setup')
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
  const BLOCK = 1152
  for (let i = 0; i < pcm.length; i += BLOCK) {
    const buf = enc.encodeBuffer(pcm.subarray(i, i + BLOCK))
    if (buf.length) chunks.push(Buffer.from(buf))
  }
  const tail = enc.flush()
  if (tail.length) chunks.push(Buffer.from(tail))
  return Buffer.concat(chunks)
}

// ---- 主流程 ------------------------------------------------------------------
let failures = 0
let generated = 0
let skipped = 0
const touchedJson = new Map() // filePath -> Set(exampleId)（active 声音回写用）

for (const voiceId of voiceIds) {
  const voice = cfg.voices[voiceId]
  const { missing, stale } = staleness(voiceId, voice)
  const pending = missing.length + stale.length

  if (MODE_CHECK) {
    log(`${voiceId}: 共 ${examples.length} 句，缺失 ${missing.length}，过期 ${stale.length}`)
    for (const id of missing) log(`  缺失 ${id}`)
    for (const { id, reason } of stale) log(`  过期 ${id}（${reason}）`)
    continue
  }
  if (!pending) { log(`${voiceId}: 全部 ${examples.length} 句均为最新，跳过`); continue }

  const onnxPath = await ensureModel(voiceId, voice)
  const onnxSha = sha256(await fs.readFile(onnxPath))
  currentConfigPath = path.join(ROOT, modelCacheDir, voiceId, voice.model.config)
  log(`${voiceId}: 需生成 ${missing.length} 句、重生成 ${stale.length} 句（${voice.label}）`)
  const piper = await PiperPlus.initialize({
    model: onnxPath,
    ort: await import('onnxruntime-web'),
    wasmG2pUrl: pathToFileURL(path.join(ROOT, 'node_modules/piper-plus/dist/rust-wasm/piper_plus_wasm.js')).href,
  })
  const voiceDir = path.join(ROOT, outputDir, voiceId)
  await fs.mkdir(voiceDir, { recursive: true }) // voiceDir 下按条目再分目录
  const regenerate = new Set([...missing, ...stale.map((s) => s.id)])

  for (const ex of examples) {
    if (!regenerate.has(ex.exampleId)) { skipped++; continue }
    const tts = (ex.reading?.trim() || ex.text).trim()
    try {
      const raw = await piper.synthesize(tts, voice.params)
      // 句尾静音垫：合成出的音频末端截断生硬，按配置补一小段
      const padSec = encode.tailSilenceSeconds ?? 0
      let samples = raw.samples
      if (padSec > 0) {
        const padded = new Float32Array(samples.length + Math.round(raw.sampleRate * padSec))
        padded.set(samples, 0)
        samples = padded
      }
      const mp3 = encodeMp3(samples, raw.sampleRate, encode.bitrateKbps)
      const rel = `${audioUrlPrefix}/${voiceId}/${ex.grammarId}/${ex.exampleId}.mp3`
      await fs.mkdir(path.join(voiceDir, ex.grammarId), { recursive: true })
      await fs.writeFile(path.join(voiceDir, ex.grammarId, `${ex.exampleId}.mp3`), mp3)
      manifest.items[itemKey(voiceId, ex.exampleId)] = {
        path: rel,
        exampleId: ex.exampleId,
        grammarId: ex.grammarId,
        voice: voiceId,
        textSource: ex.reading?.trim() ? 'reading' : 'text',
        textSha256: sha256(Buffer.from(tts, 'utf8')),
        audioSha256: sha256(mp3),
        bytes: mp3.length,
        sampleRate: raw.sampleRate,
        fingerprint: fingerprint(voice),
        modelOnnxSha256: onnxSha,
        engine: { package: engine.npmPackage, version: engine.npmVersion },
        model: { repo: voice.model.repo, onnx: voice.model.onnx },
        params: voice.params,
        license: voice.license,
        generatedAt: new Date().toISOString(),
      }
      generated++
      log(`  ✓ ${voiceId}/${ex.exampleId}（${(mp3.length / 1024).toFixed(0)}KB）`)
      if (voice.active) {
        if (!touchedJson.has(ex.filePath)) touchedJson.set(ex.filePath, new Set())
        touchedJson.get(ex.filePath).add(ex.exampleId)
      }
    } catch (err) {
      failures++
      console.error(`  ✗ ${voiceId}/${ex.exampleId}: ${err.message}`)
    }
  }

  // 该声音下已不在内容清单里的旧音频 → 清理（文件 + manifest）
  for (const key of Object.keys(manifest.items)) {
    if (!key.startsWith(`${voiceId}/`)) continue
    const exampleId = key.slice(voiceId.length + 1)
    if (!byId.has(exampleId)) {
      delete manifest.items[key]
      await fs.rm(path.join(voiceDir, manifest.items[`${voiceId}/${exampleId}`]?.grammarId ?? '', `${exampleId}.mp3`), { force: true })
      log(`  清理孤儿音频 ${key}`)
    }
  }
}

// ---- active 声音回写例句 JSON 的 audio 字段 --------------------------------------
for (const [filePath, ids] of touchedJson) {
  const voiceId = voiceIds.find((v) => cfg.voices[v].active)
  const data = JSON.parse(await fs.readFile(filePath, 'utf8'))
  for (const ex of data.examples) {
    if (ids.has(ex.id)) ex.audio = `${audioUrlPrefix}/${voiceId}/${ex.grammarId}/${ex.id}.mp3`
  }
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n')
  log(`回写 ${path.relative(ROOT, filePath)}（${[...ids].join(', ')}）`)
}

if (!MODE_CHECK) {
  manifest.generatedBy = {
    script: 'scripts/generate-audio.mjs',
    engine,
    note: '溯源台账；站点前端不读取本文件，前端只读例句 JSON 的 audio 字段',
  }
  await fs.mkdir(path.dirname(manifestPath), { recursive: true })
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
}

// ---- 汇总 ------------------------------------------------------------------
if (MODE_CHECK) {
  const totalPending = voiceIds.reduce((acc, id) => {
    const v = staleness(id, cfg.voices[id])
    return acc + v.missing.length + v.stale.length
  }, 0)
  log(`核对完成：待处理 ${totalPending} 句`)
  if (STRICT && totalPending > 0) process.exit(1)
} else {
  log(`完成：生成 ${generated}，最新跳过 ${skipped}，失败 ${failures}`)
  if (failures) process.exit(1)
}
