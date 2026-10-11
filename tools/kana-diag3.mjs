#!/usr/bin/env node
// 第 3 轮补充探测：pau 触发字符 / 片假名音素化 / timing 可用性。
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

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
log('== 音素表符号（id 0-10）')
log(Array.from({ length: 11 }, (_, i) => `${i}:${JSON.stringify(idToSym.get(i))}`).join(' '))

const piper = await PiperPlus.initialize({
  model: onnxPath,
  ort: await import('onnxruntime-web'),
  wasmG2pUrl: pathToFileURL(path.join(ROOT, 'node_modules/piper-plus/dist/rust-wasm/piper_plus_wasm.js')).href,
})
const dump = (text) => {
  const { phonemeIds } = piper._phonemizer.encode(text, 'ja')
  return phonemeIds.map((i) => idToSym.get(i) ?? `?${i}`).join('|')
}

log('== 分隔符探测（找能产生 pau/停顿的字符）')
for (const sep of ['、', '。', '　', '…', '・', 'ー', '　あ　', '\n']) {
  log(`か${sep}か → ${dump(`か${sep}か`)}`)
}

log('== 片假名/长音形态音素化（找 は/へ/ん 的正确读法）')
for (const t of ['は', 'はー', 'ハー', 'ハ、ハ、ハ', 'は、は、は', 'へ', 'へー', 'ヘー', 'ん', 'んー', 'ンー', 'ン、ン、ン', 'あー', 'アー']) {
  log(`${t} → ${dump(t)}`)
}

log('== timing 可用性')
for (const t of ['か', 'かー', 'か、か、か。']) {
  const r = await piper.synthesize(t, { ...voice.params, lengthScale: 1.0 })
  log(`${t}: hasTimingInfo=${r.hasTimingInfo}`)
  if (r.hasTimingInfo && r.timing?.phonemes) {
    log('  ' + r.timing.phonemes.map((p) => `${p.phoneme}:${p.start_ms}-${p.end_ms}`).join(' '))
  }
}
log('done')
