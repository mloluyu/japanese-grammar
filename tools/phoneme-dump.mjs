#!/usr/bin/env node
// 音素化取证：比较汉字原文与全假名输入的音素 ID 序列
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
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
  return { modelUrl: modelPath, configUrl: currentConfigPath ?? modelPath.replace(/\.onnx$/i, '.json'), configFallbackUrl: null, cacheKey: path.basename(modelPath) }
}

const modelDir = path.join(ROOT, 'tools/models/tsukuyomi-v1')
currentConfigPath = path.join(modelDir, 'config.json')
const modelConfig = JSON.parse(await fs.readFile(currentConfigPath, 'utf8'))
// config: phoneme_id_map { symbol: [ids] } → 反转 id→symbol
const idToSym = new Map()
for (const [sym, ids] of Object.entries(modelConfig.phoneme_id_map ?? {})) {
  for (const id of ids) if (!idToSym.has(id)) idToSym.set(id, sym)
}

const piper = await PiperPlus.initialize({
  model: path.join(modelDir, 'tsukuyomi-chan-6lang-fp16.onnx'),
  ort: await import('onnxruntime-web'),
  wasmG2pUrl: pathToFileURL(path.join(ROOT, 'node_modules/piper-plus/dist/rust-wasm/piper_plus_wasm.js')).href,
})

for (const text of ['電気が消える。', 'でんきがきえる。', '消える。', 'が。', 'が']) {
  const { phonemeIds } = piper._phonemizer.encode(text, 'ja')
  const syms = phonemeIds.map((i) => idToSym.get(i) ?? `?${i}`).join(' ')
  console.log(`${text}\n  → ${syms}`)
}
