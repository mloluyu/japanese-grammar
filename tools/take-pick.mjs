#!/usr/bin/env node
// 坏句重铸：電気が消える。现役参数 4 个新 take（A–D），供人耳挑选
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
const lameMod = await import('@breezystack/lamejs')
const lame = lameMod.Mp3Encoder ? lameMod : lameMod.default
function floatToInt16(samples) {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff }
  return out
}
function encodeMp3(samples, sampleRate, kbps) {
  const enc = new lame.Mp3Encoder(1, sampleRate, kbps)
  const pcm = floatToInt16(samples)
  const chunks = []
  for (let i = 0; i < pcm.length; i += 1152) { const buf = enc.encodeBuffer(pcm.subarray(i, i + 1152)); if (buf.length) chunks.push(Buffer.from(buf)) }
  const tail = enc.flush(); if (tail.length) chunks.push(Buffer.from(tail))
  return Buffer.concat(chunks)
}
const cfg = JSON.parse(await fs.readFile(path.join(ROOT, 'scripts/audio.config.json'), 'utf8'))
const voice = cfg.voices['tsukuyomi-v1']
const modelDir = path.join(ROOT, 'tools/models/tsukuyomi-v1')
currentConfigPath = path.join(modelDir, voice.model.config)
const piper = await PiperPlus.initialize({
  model: path.join(modelDir, voice.model.onnx),
  ort: await import('onnxruntime-web'),
  wasmG2pUrl: pathToFileURL(path.join(ROOT, 'node_modules/piper-plus/dist/rust-wasm/piper_plus_wasm.js')).href,
})
const outDir = path.join(ROOT, 'tools/take-probe')
await fs.mkdir(outDir, { recursive: true })
const text = '電気が消える。'
for (const label of ['a', 'b', 'c', 'd']) {
  const audio = await piper.synthesize(text, voice.params)
  const samples = new Float32Array(audio.samples.length + Math.round(audio.sampleRate * 0.35))
  samples.set(audio.samples, 0)
  await fs.writeFile(path.join(outDir, `pick-${label}.mp3`), encodeMp3(samples, audio.sampleRate, 64))
  console.log(`✓ ${label}`)
}
console.log('done')
