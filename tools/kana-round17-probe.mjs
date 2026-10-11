#!/usr/bin/env node
// 第 17 轮：
// re/ro → 回归第 6/7 轮被普遍认可的定长窗口法（「れーーー。」「ろーーー。」ls 竞速×2 掷，音频域 400ms 窗直切稳态延长元音）；
// pa → ぱん ls3.2（第 13 轮被点名 349ms 很好的配方）完整切出，仅 WSOLA 拉伸 a 段到 400，绝不截断（哔音=截断滑音）。
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
  return { onsetMs: E[c].start_ms, vowelStartMs: E[v].start_ms }
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
// 第 9 轮配方竞速（A=慢速 B=低噪中速 C=低噪快速 D=快速）
const RECIPES = [
  { id: 'A', ls: 2.6, ns: 0.667, nw: 0.5 },
  { id: 'B', ls: 2.2, ns: 0.5, nw: 0.35 },
  { id: 'C', ls: 1.8, ns: 0.4, nw: 0.25 },
  { id: 'D', ls: 1.6, ns: 0.667, nw: 0.8 },
]
const dataRaw = await fs.readFile(path.join(OUT_BASE, 'data.js'), 'utf8')
const D = JSON.parse(dataRaw.replace(/^window\.KANA_VARIANTS = /, '').trim())
const TARGET = 400

// --- re / ro：定长窗口法 ---
for (const [slug, text, vowel] of [['re', 'れーーー。', 'e'], ['ro', 'ろーーー。', 'o']]) {
  const cands = []
  for (const rc of RECIPES) {
    for (let a = 1; a <= 2; a++) {
      const r = await piper.synthesize(text, { ...voice.params, lengthScale: rc.ls, noiseScale: rc.ns, noiseW: rc.nw })
      const loc = locateMora(r.timing.phonemes, vowel, 1)
      if (!loc) continue
      const sr = r.sampleRate
      const scale = r.samples.length / sr / (r.timing.phonemes[r.timing.phonemes.length - 1].end_ms / 1000)
      const asamp = Math.max(0, Math.round(((loc.onsetMs - 15) / 1000) * sr * scale))
      const bsamp = Math.min(r.samples.length, asamp + Math.round((TARGET / 1000) * sr))
      if (bsamp - asamp < Math.round(sr * 0.25)) continue
      const w = r.samples.slice(asamp, bsamp)
      const tail = Math.min(w.length, Math.round(sr * 0.08))
      const fade = Math.min(w.length, Math.round(sr * 0.012))
      for (let i = 0; i < tail; i++) w[w.length - 1 - i] *= Math.exp(-3 * (i / tail))
      for (let i = 0; i < fade; i++) w[w.length - 1 - i] *= i / fade
      const fi = Math.min(w.length, Math.round(sr * 0.004))
      for (let i = 0; i < fi; i++) w[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fi)
      const st = sliceStats(w, sr)
      console.log(`  ${slug} 配方${rc.id}#${a}: ${st.ms}ms per ${st.per}`)
      cands.push({ w, sr, st, ls: rc.ls, text, recipe: rc.id })
    }
  }
  if (!cands.length) { console.log(`✗ ${slug}`); continue }
  const best = cands.reduce((x, y) => (y.st.per > x.st.per ? y : x))
  const mp3 = encodeMp3(polish(best.w, best.sr), best.sr, cfg.encode.bitrateKbps)
  await fs.writeFile(path.join(OUT_BASE, 'm', `${slug}.mp3`), mp3)
  D.stats.m[slug] = { voice: 'tsukuyomi-v1', strategy: `定长窗口「${best.text}」配方${best.recipe} ls${best.ls}`, form: best.text, dur: best.st.ms, per: Math.round(best.st.per * 100) / 100, zcr: Math.round(best.st.zcr * 100) / 100, attempts: 1, flag: false }
  console.log(`${slug}: 「${best.text}」配方${best.recipe} → ${best.st.ms}ms per ${best.st.per}`)
}

// --- pa：ぱん ls3.2 完整切出 + a 段 WSOLA 拉伸到 400（不截断） ---
{
  const cands = []
  for (let a = 1; a <= 4; a++) {
    const r = await piper.synthesize('ぱん', { ...voice.params, lengthScale: 3.2, noiseScale: 0.5, noiseW: 0.5 })
    const loc = locateMora(r.timing.phonemes, 'a', 1)
    if (!loc) continue
    const sr = r.sampleRate
    const scale = r.samples.length / sr / (r.timing.phonemes[r.timing.phonemes.length - 1].end_ms / 1000)
    const asamp = Math.max(0, Math.round(((loc.onsetMs - 15) / 1000) * sr * scale))
    const vsamp = Math.round((loc.vowelStartMs / 1000) * sr * scale)
    // 终点：a 的 timing 结束前 45ms（ん起振前）
    const E = r.timing.phonemes
    let vIdx = 0
    for (let i = 0; i < E.length; i++) if (E[i].phoneme === 'a') { vIdx = i; break }
    const nextMs = vIdx + 1 < E.length ? E[vIdx + 1].start_ms : E[vIdx].end_ms
    const bsamp = Math.min(r.samples.length, Math.round(((nextMs - 45) / 1000) * sr * scale))
    if (bsamp - asamp < Math.round(sr * 0.15)) { console.log(`  pa #${a}: 切片过短`); continue }
    let w = r.samples.slice(asamp, bsamp)
    const natural = Math.round((w.length / sr) * 1000)
    const consLen = vsamp - asamp
    const vowelSeg = w.slice(consLen)
    const targetVowel = Math.round((TARGET / 1000) * sr) - consLen
    if (targetVowel > vowelSeg.length) {
      const ratio = targetVowel / vowelSeg.length
      if (ratio > 1.35) { console.log(`  pa #${a}: 自然${natural}ms 拉${ratio.toFixed(2)} 跳过`); continue }
      w = new Float32Array([...w.slice(0, consLen), ...wsola(vowelSeg, sr, targetVowel)])
    } else w = w.slice(0, consLen + targetVowel)
    const tail = Math.min(w.length, Math.round(sr * 0.08))
    const fade = Math.min(w.length, Math.round(sr * 0.012))
    for (let i = 0; i < tail; i++) w[w.length - 1 - i] *= Math.exp(-3 * (i / tail))
    for (let i = 0; i < fade; i++) w[w.length - 1 - i] *= i / fade
    const fi = Math.min(w.length, Math.round(sr * 0.004))
    for (let i = 0; i < fi; i++) w[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fi)
    const st = sliceStats(w, sr)
    console.log(`  pa #${a}: 自然${natural}ms→${st.ms}ms per ${st.per}`)
    cands.push({ w, sr, st, ls: 3.2, text: 'ぱん', natural })
  }
  if (cands.length) {
    const best = cands.reduce((x, y) => (y.st.per > x.st.per ? y : x))
    const mp3 = encodeMp3(polish(best.w, best.sr), best.sr, cfg.encode.bitrateKbps)
    await fs.writeFile(path.join(OUT_BASE, 'm', 'pa.mp3'), mp3)
    D.stats.m.pa = { voice: 'tsukuyomi-v1', strategy: `ぱん ls3.2 完整切＋a段WSOLA（自然${best.natural}ms）`, form: 'ぱん', dur: best.st.ms, per: Math.round(best.st.per * 100) / 100, zcr: Math.round(best.st.zcr * 100) / 100, attempts: 1, flag: false }
    console.log(`pa: ぱん ls3.2 自然${best.natural}ms→${best.st.ms}ms per ${best.st.per}`)
  } else console.log('✗ pa')
}
await fs.writeFile(path.join(OUT_BASE, 'data.js'), 'window.KANA_VARIANTS = ' + JSON.stringify(D, null, 1) + '\n')
console.log('round17 完成')
