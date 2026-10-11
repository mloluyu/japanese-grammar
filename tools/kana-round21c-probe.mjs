#!/usr/bin/env node
// 第 19 轮：按用户指示「往前切一点」——切口起点从辅音 timing 起点−15ms 改为−70ms，
// 把弹音的闭塞段（含前一元音的收尾过渡）包进来，爆破感才会出来。
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
  return { onsetMs: E[c].start_ms, vowelStartMs: E[v].start_ms, vowelEndMs: E[v].end_ms, nextMs: v + 1 < E.length ? E[v + 1].start_ms : null, cIdx: c }
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
function boostOnset(w, sr, want = 0.55) {
  const n = Math.min(w.length, Math.round(sr * 0.08))
  let onPeak = 0
  for (let i = 0; i < n; i++) onPeak = Math.max(onPeak, Math.abs(w[i]))
  let allPeak = 0
  for (let i = 0; i < w.length; i++) allPeak = Math.max(allPeak, Math.abs(w[i]))
  if (allPeak <= 0 || onPeak / allPeak >= want) return w
  const gain = Math.min(2.5, want / (onPeak / allPeak))
  const fade = Math.round(sr * 0.03)
  const out = w.slice()
  for (let i = 0; i < n; i++) {
    let g = gain
    if (i > n - fade) g = 1 + (gain - 1) * (n - i) / fade
    out[i] *= g
  }
  return out
}
const dataRaw = await fs.readFile(path.join(OUT_BASE, 'data.js'), 'utf8')
const D = JSON.parse(dataRaw.replace(/^window\.KANA_VARIANTS = /, '').trim())
const TARGET = 400
const EARLY = 68 // 往前多切的毫秒数（70 不够、140 过头）
// 钳制：前切不得越过前一音素起点+30ms（避免吞进上上个音）
function clampEarly(E, cIdx, onsetMs, early) {
  if (cIdx > 0) { const prevStart = E[cIdx - 1].start_ms; return Math.min(early, Math.max(0, onsetMs - (prevStart + 30))) }
  return early
}

const CELLS = {
  re: [{ text: 'それ', vowel: 'e', nth: 1 }, { text: 'とれ', vowel: 'e', nth: 1 }, { text: 'くれ', vowel: 'e', nth: 1 }, { text: 'あれ', vowel: 'e', nth: 1 }],
}
for (const [slug, arms] of Object.entries(CELLS)) {
  const cands = []
  for (const arm of arms) {
    for (const ls of [1.8, 2.2]) {
      for (let a = 1; a <= 2; a++) {
        const r = await piper.synthesize(arm.text, { ...voice.params, lengthScale: ls, noiseScale: 0.5, noiseW: 0.5 })
        const loc = locateMora(r.timing.phonemes, arm.vowel, arm.nth)
        if (!loc) { console.log(`  ${slug} ${arm.text}: 未定位`); continue }
        const sr = r.sampleRate
        const scale = r.samples.length / sr / (r.timing.phonemes[r.timing.phonemes.length - 1].end_ms / 1000)
        const earlyEff = clampEarly(r.timing.phonemes, loc.cIdx ?? 0, loc.onsetMs, EARLY)
        const asamp = Math.max(0, Math.round(((loc.onsetMs - earlyEff) / 1000) * sr * scale))
        const vsamp = Math.round((loc.vowelStartMs / 1000) * sr * scale)
        const boundMs = loc.nextMs !== null ? loc.nextMs : loc.vowelEndMs
        const bsamp = Math.min(r.samples.length, Math.round(((boundMs - 25) / 1000) * sr * scale))
        if (bsamp - asamp < Math.round(sr * 0.15)) { console.log(`  ${slug} ${arm.text} ls${ls}#${a}: 切片过短`); continue }
        let w = r.samples.slice(asamp, bsamp)
        const natural = Math.round((w.length / sr) * 1000)
        const consLen = Math.max(0, vsamp - asamp)
        const vowelSeg = w.slice(consLen)
        const targetVowel = Math.round((TARGET / 1000) * sr) - consLen
        if (targetVowel > vowelSeg.length) {
          const ratio = targetVowel / vowelSeg.length
          if (ratio > 1.5) { console.log(`  ${slug} ${arm.text} ls${ls}#${a}: 自然${natural}ms 拉${ratio.toFixed(2)} 跳过`); continue }
          w = new Float32Array([...w.slice(0, consLen), ...wsola(vowelSeg, sr, targetVowel)])
        } else w = w.slice(0, consLen + targetVowel)
        w = boostOnset(w, sr)
        const tail = Math.min(w.length, Math.round(sr * 0.08))
        const fade = Math.min(w.length, Math.round(sr * 0.012))
        for (let i = 0; i < tail; i++) w[w.length - 1 - i] *= Math.exp(-3 * (i / tail))
        for (let i = 0; i < fade; i++) w[w.length - 1 - i] *= i / fade
        const fi = Math.min(w.length, Math.round(sr * 0.004))
        for (let i = 0; i < fi; i++) w[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fi)
        const st = sliceStats(w, sr)
        console.log(`  ${slug} 「${arm.text}」ls${ls}#${a}: 自然${natural}ms→${st.ms}ms per ${st.per}`)
        cands.push({ w, sr, st, ls, text: arm.text, natural })
      }
    }
  }
  if (!cands.length) { console.log(`✗ ${slug}`); continue }
  const inRange = cands.filter((c) => c.st.ms >= 360 && c.st.ms <= 440)
  const base = inRange.length ? inRange : cands
  const best = base.reduce((x, y) => (y.st.per > x.st.per ? y : x))
  const mp3 = encodeMp3(polish(best.w, best.sr), best.sr, cfg.encode.bitrateKbps)
  await fs.writeFile(path.join(OUT_BASE, 'm', `${slug}.mp3`), mp3)
  D.stats.m[slug] = { voice: 'tsukuyomi-v1', strategy: `载词「${best.text}」ls${best.ls} 前切${EARLY}ms（自然${best.natural}ms）`, form: best.text, dur: best.st.ms, per: Math.round(best.st.per * 100) / 100, zcr: Math.round(best.st.zcr * 100) / 100, attempts: 1, flag: false }
  console.log(`${slug}: 「${best.text}」ls${best.ls} 前切${EARLY}ms 自然${best.natural}ms→${best.st.ms}ms per ${best.st.per}`)
}
await fs.writeFile(path.join(OUT_BASE, 'data.js'), 'window.KANA_VARIANTS = ' + JSON.stringify(D, null, 1) + '\n')
console.log('round21c 完成')
