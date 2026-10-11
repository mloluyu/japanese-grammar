#!/usr/bin/env node
// 第 22 轮：钉死变量——先掷 4 次「あれ」选弹音闭塞最深的一次合成（固定音频），
// 再在同一段音频上以 EARLY ∈ [60,68,73,78,85,95,105] 切出 7 个版本，一次交用户听全。
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
function locateMora(E, vowel, nth) {
  let seen = 0, v = -1
  for (let i = 0; i < E.length; i++) { if (E[i].phoneme === vowel) { seen++; if (seen === nth) { v = i; break } } }
  if (v < 0) return null
  let c = v
  const VOWELS = new Set(['a', 'e', 'i', 'o', 'u'])
  const SKIP = new Set(['_', '#', '[', ']', 'pau', 'sil'])
  while (c > 0 && !VOWELS.has(E[c - 1].phoneme) && !SKIP.has(E[c - 1].phoneme)) c--
  return { onsetMs: E[c].start_ms, vowelEndMs: E[v].end_ms, nextMs: v + 1 < E.length ? E[v + 1].start_ms : null }
}
// 弹音闭塞深度：在 [ɾ.start−100, ɾ.start+60] 内找 20ms 窗最小 RMS（闭塞谷），与后续 40ms 峰 RMS 之比越小弹音越完整
function tapScore(w, sr, tapStartSamp) {
  const w0 = Math.max(0, tapStartSamp - Math.round(sr * 0.1))
  const w1 = Math.min(w.length, tapStartSamp + Math.round(sr * 0.06))
  const win = Math.round(sr * 0.02)
  let minRms = Infinity
  for (let s = w0; s + win <= w1; s += Math.round(sr * 0.005)) {
    let e2 = 0
    for (let i = s; i < s + win; i++) e2 += w[i] * w[i]
    minRms = Math.min(minRms, Math.sqrt(e2 / win))
  }
  let peakRms = 0
  const r1 = Math.min(w.length, w1 + Math.round(sr * 0.04))
  for (let s = w1; s + win <= r1; s += Math.round(sr * 0.005)) {
    let e2 = 0
    for (let i = s; i < s + win; i++) e2 += w[i] * w[i]
    peakRms = Math.max(peakRms, Math.sqrt(e2 / win))
  }
  return peakRms > 0 ? minRms / peakRms : 1
}
function wsola(seg, sr, targetLen) {
  if (targetLen <= seg.length) return seg.slice(0, targetLen)
  const fl = Math.round(sr * 0.03)
  const hop = Math.round(sr * 0.0075)
  const tol = Math.round(sr * 0.004)
  const out = new Float32Array(targetLen)
  const win = new Float32Array(fl)
  for (let i = 0; i < fl; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fl - 1))
  const n0 = Math.min(fl, targetLen)
  for (let i = 0; i < n0; i++) out[i] = (seg[i] || 0) * win[i]
  let si = hop, oi = hop
  while (oi < targetLen) {
    let best = si, bestC = -Infinity
    for (let off = -tol; off <= tol; off++) {
      const sp = si + off
      if (sp < 0 || sp + fl > seg.length) continue
      let c = 0
      for (let i = 0; i < fl - hop; i += 2) c += (out[oi + i] || 0) * seg[sp + i]
      if (c > bestC) { bestC = c; best = sp }
    }
    for (let i = 0; i < fl && oi + i < targetLen; i++) out[oi + i] += (seg[best + i] || 0) * win[i]
    si += hop
    oi += hop
    if (si + fl >= seg.length) si = Math.max(0, si - Math.round(fl * 2))
  }
  return out
}
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
function floatToInt16(s) { const o = new Int16Array(s.length); for (let i = 0; i < s.length; i++) { const v = Math.max(-1, Math.min(1, s[i])); o[i] = v < 0 ? v * 0x8000 : v * 0x7fff } return o }
const lameMod = await import('@breezystack/lamejs')
const lame = lameMod.Mp3Encoder ? lameMod : lameMod.default
function encodeMp3(s, sr, kb) { const e = new lame.Mp3Encoder(1, sr, kb); const p = floatToInt16(s); const c = []; for (let i = 0; i < p.length; i += 1152) { const b = e.encodeBuffer(p.subarray(i, i + 1152)); if (b.length) c.push(Buffer.from(b)) } const t = e.flush(); if (t.length) c.push(Buffer.from(t)); return Buffer.concat(c) }

const EARLIES = [60, 68, 73, 78, 85, 95, 105]
const TARGET = 400

// 1) 掷 4 次，选弹音闭塞最深的合成
let bestThrow = null
for (let a = 1; a <= 4; a++) {
  const r = await piper.synthesize('あれ', { ...voice.params, lengthScale: 2.2, noiseScale: 0.5, noiseW: 0.5 })
  const loc = locateMora(r.timing.phonemes, 'e', 1)
  if (!loc) continue
  const sr = r.sampleRate
  const scale = r.samples.length / sr / (r.timing.phonemes[r.timing.phonemes.length - 1].end_ms / 1000)
  const tapSamp = Math.round((loc.onsetMs / 1000) * sr * scale)
  const score = tapScore(r.samples, sr, tapSamp)
  console.log(`  掷${a}: 弹音闭塞深度 ${score.toFixed(3)}（越小越深）`)
  if (!bestThrow || score < bestThrow.score) bestThrow = { r, loc, scale, score }
}
if (!bestThrow) { console.log('✗ 全部未定位'); process.exit(1) }
console.log(`选定掷${bestThrow.score ? '' : ''}（深度 ${bestThrow.score.toFixed(3)}）`)
const { r, loc, scale } = bestThrow
const sr = r.sampleRate
const boundMs = loc.nextMs !== null ? loc.nextMs : loc.vowelEndMs
const bsamp = Math.min(r.samples.length, Math.round(((boundMs - 25) / 1000) * sr * scale))
const onsetSamp = Math.round((loc.onsetMs / 1000) * sr * scale)

// 2) 同一音频上切 7 版
for (const EARLY of EARLIES) {
  const asamp = Math.max(0, onsetSamp - Math.round((EARLY / 1000) * sr))
  if (bsamp - asamp < Math.round(sr * 0.15)) { console.log(`  EARLY=${EARLY}: 过短跳过`); continue }
  let w = r.samples.slice(asamp, bsamp)
  const natural = Math.round((w.length / sr) * 1000)
  // 元音段＝弹音起点之后的全部（粗略：从 onset 起算元音）；拉伸补到 400
  const consLen = onsetSamp - asamp
  const vowelSeg = w.slice(consLen)
  const targetVowel = Math.round((TARGET / 1000) * sr) - consLen
  if (targetVowel > vowelSeg.length) w = new Float32Array([...w.slice(0, consLen), ...wsola(vowelSeg, sr, targetVowel)])
  else w = w.slice(0, consLen + targetVowel)
  const tail = Math.min(w.length, Math.round(sr * 0.08))
  const fade = Math.min(w.length, Math.round(sr * 0.012))
  for (let i = 0; i < tail; i++) w[w.length - 1 - i] *= Math.exp(-3 * (i / tail))
  for (let i = 0; i < fade; i++) w[w.length - 1 - i] *= i / fade
  const fi = Math.min(w.length, Math.round(sr * 0.004))
  for (let i = 0; i < fi; i++) w[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fi)
  const mp3 = encodeMp3(polish(w, sr), sr, cfg.encode.bitrateKbps)
  await fs.writeFile(path.join(OUT_BASE, `re-e${EARLY}.mp3`), mp3)
  console.log(`EARLY=${EARLY}: 自然${natural}ms → ${path.basename('x') && `re-e${EARLY}.mp3`}`)
}
await fs.writeFile(path.join(OUT_BASE, '..', 'kana-re-scale.html'), `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>れ 前切量 7 档对比（同一次合成）</title>
<style>body{font-family:system-ui;background:#14171c;color:#d8dee6;max-width:560px;margin:60px auto;padding:0 20px}
.row{display:flex;gap:16px;align-items:center;padding:12px 0;border-bottom:1px solid #2a2f38}
b{width:110px}audio{width:300px}p{color:#9aa5b1}</style></head><body>
<h2>れ・前切量 7 档（同一次合成，只有切口不同）</h2>
${EARLIES.map((e) => `<div class="row"><b>前切 ${e}ms</b><audio controls src="kana-variants/re-e${e}.mp3"></audio></div>`).join('\n')}
<p>规律：数字越大，弹音闭塞越完整、但「あ」的尾巴越多。选一个刚好出现弹音而 a 还不碍耳的数字告诉我。</p>
</body></html>
`)
console.log('round22 完成：7 档落盘 + kana-re-scale.html')
