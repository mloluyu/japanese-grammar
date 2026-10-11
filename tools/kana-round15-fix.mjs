#!/usr/bin/env node
// round15 补：选片标准修正——上一版按 per 挑，结果选了 3.3× 极限拉伸（れきし 122ms→400）必然发毛。
// 新标准：modRatio = natural≥TARGET ? natural/TARGET（截断） : TARGET/natural（拉伸），
// 且截断真正生效（元音过长就切到 TARGET，不再只伸不缩）。池1=modRatio≤1.45 取 per 最高，池2≤2.2，兜底最小 modRatio。
// gyu 不再用起音 zcr 选（慢速 zcr 低反而被用户听成 ki），一视同仁按 modRatio+per。
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
  return { onsetMs: E[c].start_ms, vowelStartMs: E[v].start_ms, vowelEndMs: E[v].end_ms, nextMs: v + 1 < E.length ? E[v + 1].start_ms : null }
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
const dataRaw = await fs.readFile(path.join(OUT_BASE, 'data.js'), 'utf8')
const D = JSON.parse(dataRaw.replace(/^window\.KANA_VARIANTS = /, '').trim())

const CELLS = {
  re:  [{ text: 'これ', vowel: 'e', nth: 1 }, { text: 'れきし', vowel: 'e', nth: 1 }],
  ro:  [{ text: 'ろく', vowel: 'o', nth: 1 }, { text: 'ろーぷ', vowel: 'o', nth: 1 }],
  pa:  [{ text: 'ぱん', vowel: 'a', nth: 1 }, { text: 'いっぱい', vowel: 'a', nth: 1 }],
  pu:  [{ text: 'ぷーる', vowel: 'u', nth: 1 }],
  gyu: [{ text: 'ぎゅう', vowel: 'u', nth: 1 }, { text: 'ぎゅうど', vowel: 'u', nth: 1 }],
}
const TARGET = 400

for (const [slug, arms] of Object.entries(CELLS)) {
  const cands = []
  for (const arm of arms) {
    for (const ls of [1.4, 1.8, 2.2]) {
      for (let a = 1; a <= 2; a++) {
        const r = await piper.synthesize(arm.text, { ...voice.params, lengthScale: ls, noiseScale: 0.5, noiseW: 0.5 })
        const loc = locateMora(r.timing.phonemes, arm.vowel, arm.nth)
        if (!loc) { console.log(`  ${slug} ${arm.text}: 未定位`); continue }
        const sr = r.sampleRate
        const scale = r.samples.length / sr / (r.timing.phonemes[r.timing.phonemes.length - 1].end_ms / 1000)
        const asamp = Math.max(0, Math.round(((loc.onsetMs - 15) / 1000) * sr * scale))
        const vsamp = Math.round((loc.vowelStartMs / 1000) * sr * scale)
        const boundMs = loc.nextMs !== null ? loc.nextMs : loc.vowelEndMs
        const bsamp = Math.min(r.samples.length, Math.round(((boundMs - 25) / 1000) * sr * scale))
        if (bsamp - asamp < Math.round(sr * 0.1)) { console.log(`  ${slug} ${arm.text} ls${ls}#${a}: 切片过短`); continue }
        const w0 = r.samples.slice(asamp, bsamp)
        const natural = Math.round((w0.length / sr) * 1000)
        const modRatio = natural >= TARGET ? natural / TARGET : TARGET / natural
        if (modRatio > 2.2) { console.log(`  ${slug} ${arm.text} ls${ls}#${a}: 自然${natural}ms 调制比${modRatio.toFixed(2)} 跳过`); continue }
        const consLen = vsamp - asamp
        const vowelSeg = w0.slice(consLen)
        const targetVowel = Math.round((TARGET / 1000) * sr) - consLen
        let w
        if (targetVowel > vowelSeg.length) w = new Float32Array([...w0.slice(0, consLen), ...wsola(vowelSeg, sr, targetVowel)])
        else w = w0.slice(0, consLen + targetVowel) // 截断（自然偏长）
        const tail = Math.min(w.length, Math.round(sr * 0.08))
        const fade = Math.min(w.length, Math.round(sr * 0.012))
        for (let i = 0; i < tail; i++) w[w.length - 1 - i] *= Math.exp(-3 * (i / tail))
        for (let i = 0; i < fade; i++) w[w.length - 1 - i] *= i / fade
        const fi = Math.min(w.length, Math.round(sr * 0.004))
        for (let i = 0; i < fi; i++) w[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fi)
        const st = sliceStats(w, sr)
        console.log(`  ${slug} 「${arm.text}」ls${ls}#${a}: 自然${natural}ms 比${modRatio.toFixed(2)}→${st.ms}ms per ${st.per}`)
        cands.push({ w, sr, st, ls, text: arm.text, modRatio, natural })
      }
    }
  }
  if (!cands.length) { console.log(`✗ ${slug}`); continue }
  const p1 = cands.filter((c) => c.modRatio <= 1.45)
  const p2 = cands.filter((c) => c.modRatio <= 2.2)
  const pool = p1.length ? p1 : p2.length ? p2 : cands
  const best = pool.reduce((x, y) => (y.st.per > x.st.per ? y : x))
  const mp3 = encodeMp3(polish(best.w, best.sr), best.sr, cfg.encode.bitrateKbps)
  await fs.writeFile(path.join(OUT_BASE, 'm', `${slug}.mp3`), mp3)
  D.stats.m[slug] = { voice: 'tsukuyomi-v1', strategy: `自然语速载词「${best.text}」ls${best.ls}（自然${best.natural}ms 比${best.modRatio.toFixed(2)}）`, form: best.text, dur: best.st.ms, per: Math.round(best.st.per * 100) / 100, zcr: Math.round(best.st.zcr * 100) / 100, attempts: 1, flag: false }
  console.log(`${slug}: 「${best.text}」ls${best.ls} 自然${best.natural}ms 比${best.modRatio.toFixed(2)} → ${best.st.ms}ms per ${best.st.per}`)
}
await fs.writeFile(path.join(OUT_BASE, 'data.js'), 'window.KANA_VARIANTS = ' + JSON.stringify(D, null, 1) + '\n')
console.log('round15-fix 完成')
