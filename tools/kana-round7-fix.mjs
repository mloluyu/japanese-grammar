#!/usr/bin/env node
// shi 单格重摇（450ms 窗口）：多语速 × 多掷挑 per 最优。
import fs from 'node:fs/promises'
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
const voice = cfg.voices['tsukuyomi-v1']
const dir = path.join(ROOT, cfg.modelCacheDir, 'tsukuyomi-v1')
currentConfigPath = path.join(dir, voice.model.config)
const piper = await PiperPlus.initialize({
  model: path.join(dir, voice.model.onnx),
  ort: await import('onnxruntime-web'),
  wasmG2pUrl: pathToFileURL(path.join(ROOT, 'node_modules/piper-plus/dist/rust-wasm/piper_plus_wasm.js')).href,
})
function floatToInt16(s) { const o = new Int16Array(s.length); for (let i = 0; i < s.length; i++) { const v = Math.max(-1, Math.min(1, s[i])); o[i] = v < 0 ? v * 0x8000 : v * 0x7fff } return o }
const lameMod = await import('@breezystack/lamejs')
const lame = lameMod.Mp3Encoder ? lameMod : lameMod.default
function encodeMp3(s, sr, kb) { const e = new lame.Mp3Encoder(1, sr, kb); const p = floatToInt16(s); const c = []; for (let i = 0; i < p.length; i += 1152) { const b = e.encodeBuffer(p.subarray(i, i + 1152)); if (b.length) c.push(Buffer.from(b)) } const t = e.flush(); if (t.length) c.push(Buffer.from(t)); return Buffer.concat(c) }
function cutWindow(r, sr, startMs, lenMs) {
  const E = r.timing.phonemes
  if (!E.length) return null
  const scale = r.samples.length / sr / (E[E.length - 1].end_ms / 1000)
  const a = Math.max(0, Math.round((startMs / 1000) * sr * scale))
  const b = Math.min(r.samples.length, a + Math.round((lenMs / 1000) * sr))
  if (b - a < Math.round(sr * 0.25)) return null
  const w = r.samples.slice(a, b)
  const tail = Math.min(w.length, Math.round(sr * 0.12))
  const fade = Math.min(w.length, Math.round(sr * 0.012))
  for (let i = 0; i < tail; i++) w[w.length - 1 - i] *= Math.exp(-3.5 * (i / tail))
  for (let i = 0; i < fade; i++) w[w.length - 1 - i] *= i / fade
  const fi = Math.min(w.length, Math.round(sr * 0.006))
  for (let i = 0; i < fi; i++) w[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fi)
  return w
}
const sliceStats = (w, sr) => {
  const body = w.length > Math.round(sr * 0.12) ? w.slice(0, w.length - Math.round(sr * 0.12)) : w
  const { per, zcr } = voicedStats(body, sr)
  return { ms: Math.round((w.length / sr) * 1000), per, zcr }
}
function polish(w, sr) {
  const pk = peakOf(w)
  if (pk > 0) { const g = 0.6 / pk; for (let i = 0; i < w.length; i++) w[i] *= g }
  const o = new Float32Array(w.length + Math.round(sr * 0.32))
  o.set(w, Math.round(sr * 0.08))
  return o
}

const dataRaw = await fs.readFile(path.join(OUT_BASE, 'data.js'), 'utf8')
const D = JSON.parse(dataRaw.replace(/^window\.KANA_VARIANTS = /, '').trim())
let best = null
for (const ls of [2.6, 2.2, 3.0, 1.8]) {
  for (let a = 1; a <= 2; a++) {
    const r = await piper.synthesize('しーーー。', { ...voice.params, lengthScale: ls })
    const E = r.timing.phonemes
    if (!E.length) continue
    const w = cutWindow(r, r.sampleRate, Math.max(0, E[0].start_ms - 15), 450)
    if (!w) continue
    const st = sliceStats(w, r.sampleRate)
    log('ls' + ls, 'a' + a, st.ms + 'ms', 'per', st.per)
    if (!best || st.per > best.st.per) best = { w, sr: r.sampleRate, st, ls, attempts: a }
    if (st.per >= 0.72) break
  }
  if (best?.st.per >= 0.72) break
}
const mp3 = encodeMp3(polish(best.w, best.sr), best.sr, cfg.encode.bitrateKbps)
await fs.writeFile(path.join(OUT_BASE, 'j', 'shi.mp3'), mp3)
D.stats.j.shi = { ...D.stats.j.shi, dur: best.st.ms, per: Math.round(best.st.per * 100) / 100, zcr: Math.round(best.st.zcr * 100) / 100, attempts: best.attempts, ls: best.ls, flag: !(best.st.per >= 0.75 && best.st.ms >= 430) }
await fs.writeFile(path.join(OUT_BASE, 'data.js'), 'window.KANA_VARIANTS = ' + JSON.stringify(D, null, 1) + '\n')
log('shi 终选:', best.st.ms + 'ms per', best.st.per, 'ls' + best.ls)
