#!/usr/bin/env node
// round14 补：ni 按起音 zcr（浊鼻音 n 起音周期性强→zcr 低）在 per≥0.95 内选最干净掷；
// pa 在时长≥390ms 内选 per 最高（用户要求加长到 400 上下，368ms 不够）。
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { voicedStats, peakOf } from './kana-seg.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_BASE = path.join(ROOT, 'tools/kana-variants')

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
const cfg = JSON.parse(await fs.readFile(path.join(ROOT, 'scripts/audio.config.json'), 'utf8'))
const voice = cfg.voices['tsukuyomi-v1']
const dir = path.join(ROOT, cfg.modelCacheDir, 'tsukuyomi-v1')
currentConfigPath = path.join(dir, voice.model.config)
const piper = await PiperPlus.initialize({
  model: path.join(dir, voice.model.onnx),
  ort: await import('onnxruntime-web'),
  wasmG2pUrl: pathToFileURL(path.join(ROOT, 'node_modules/piper-plus/dist/rust-wasm/piper_plus_wasm.js')).href,
})
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u'])
const SKIP = new Set(['_', '#', '[', ']', 'pau', 'sil'])
function floatToInt16(s) { const o = new Int16Array(s.length); for (let i = 0; i < s.length; i++) { const v = Math.max(-1, Math.min(1, s[i])); o[i] = v < 0 ? v * 0x8000 : v * 0x7fff } return o }
const lameMod = await import('@breezystack/lamejs')
const lame = lameMod.Mp3Encoder ? lameMod : lameMod.default
function encodeMp3(s, sr, kb) { const e = new lame.Mp3Encoder(1, sr, kb); const p = floatToInt16(s); const c = []; for (let i = 0; i < p.length; i += 1152) { const b = e.encodeBuffer(p.subarray(i, i + 1152)); if (b.length) c.push(Buffer.from(b)) } const t = e.flush(); if (t.length) c.push(Buffer.from(t)); return Buffer.concat(c) }
function locateMora(E, vowel, nth) {
  let seen = 0, v = -1
  for (let i = 0; i < E.length; i++) { if (E[i].phoneme === vowel) { seen++; if (seen === nth) { v = i; break } } }
  if (v < 0) return null
  let c = v
  while (c > 0 && !VOWELS.has(E[c - 1].phoneme) && !SKIP.has(E[c - 1].phoneme)) c--
  return { onsetMs: E[c].start_ms, vowelEndMs: E[v].end_ms, nextMs: v + 1 < E.length ? E[v + 1].start_ms : null }
}
function zcrOf(seg) { let z = 0; for (let i = 1; i < seg.length; i++) if ((seg[i - 1] < 0) !== (seg[i] < 0)) z++; return z / seg.length }
const sliceStats = (w, sr) => {
  const body = w.length > Math.round(sr * 0.08) ? w.slice(0, w.length - Math.round(sr * 0.08)) : w
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

async function cut(arm, ls, a) {
  const r = await piper.synthesize(arm.text, { ...voice.params, lengthScale: ls, noiseScale: 0.5, noiseW: 0.5 })
  const loc = locateMora(r.timing.phonemes, arm.vowel, arm.nth)
  if (!loc) return null
  const sr = r.sampleRate
  const scale = r.samples.length / sr / (r.timing.phonemes[r.timing.phonemes.length - 1].end_ms / 1000)
  const asamp = Math.max(0, Math.round(((loc.onsetMs - 15) / 1000) * sr * scale))
  const boundMs = loc.nextMs !== null ? loc.nextMs : loc.vowelEndMs
  const bsamp = Math.min(r.samples.length, asamp + Math.round(0.42 * sr), Math.round(((boundMs - 45) / 1000) * sr * scale))
  if (bsamp - asamp < Math.round(sr * 0.12)) return null
  const w = r.samples.slice(asamp, bsamp)
  const onsetZcr = zcrOf(w.slice(0, Math.min(w.length, Math.round(sr * 0.08))))
  const tail = Math.min(w.length, Math.round(sr * 0.08))
  const fade = Math.min(w.length, Math.round(sr * 0.012))
  for (let i = 0; i < tail; i++) w[w.length - 1 - i] *= Math.exp(-3 * (i / tail))
  for (let i = 0; i < fade; i++) w[w.length - 1 - i] *= i / fade
  const fi = Math.min(w.length, Math.round(sr * 0.004))
  for (let i = 0; i < fi; i++) w[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fi)
  return { w, sr, st: sliceStats(w, sr), ls, text: arm.text, onsetZcr }
}
async function cell(slug, arms, pick) {
  const cands = []
  for (const arm of arms) for (const ls of [2.6, 3.2, 4.0, 5.0]) for (let a = 1; a <= 2; a++) { const c = await cut(arm, ls, a); if (c) { cands.push(c); console.log(`  ${slug} 「${arm.text}」ls${ls}#${a}: ${c.st.ms}ms per ${c.st.per} 起音zcr ${c.onsetZcr.toFixed(2)}`) } }
  const best = pick(cands)
  const mp3 = encodeMp3(polish(best.w, best.sr), best.sr, cfg.encode.bitrateKbps)
  await fs.writeFile(path.join(OUT_BASE, 'm', `${slug}.mp3`), mp3)
  D.stats.m[slug] = { voice: 'tsukuyomi-v1', strategy: `载词「${best.text}」ls${best.ls}`, form: best.text, dur: best.st.ms, per: Math.round(best.st.per * 100) / 100, zcr: Math.round(best.st.zcr * 100) / 100, onsetZcr: Math.round(best.onsetZcr * 100) / 100, attempts: 1, flag: false }
  console.log(`${slug}: 「${best.text}」ls${best.ls} → ${best.st.ms}ms per ${best.st.per} 起音zcr ${best.onsetZcr.toFixed(2)}`)
}
await cell('ni', [{ text: 'にわ', vowel: 'i', nth: 1 }, { text: 'にじ', vowel: 'i', nth: 1 }], (cs) => {
  const ok = cs.filter((c) => c.st.per >= 0.95)
  return (ok.length ? ok : cs).reduce((x, y) => (y.onsetZcr < x.onsetZcr ? y : x))
})
await cell('pa', [{ text: 'ぱん', vowel: 'a', nth: 1 }], (cs) => {
  const long = cs.filter((c) => c.st.ms >= 390)
  return (long.length ? long : cs).reduce((x, y) => (y.st.per > x.st.per ? y : x))
})
await fs.writeFile(path.join(OUT_BASE, 'data.js'), 'window.KANA_VARIANTS = ' + JSON.stringify(D, null, 1) + '\n')
console.log('round14-fix 完成')
