#!/usr/bin/env node
// 第 16 轮（对症第 15 轮反馈）：
// re 辅音没了→换载词让弹音更清楚（おれ 词尾れ全实现／かれし れ后接し闭塞／れもん れ后接ん闭塞／れー 直接长音），自然语速；
// ro 听到 roku→切口终点加能量尾修剪（最后一个高能量样本+25ms 封口），た332…确保く不进窗；
// pa「哔——」→回到您第 13 轮点名的(ls3.2)ぱん自然切片(349ms很好就是短)，仅把 a 段 WSOLA 补到 400（比≈1.15，不换配方）；
// pu 依旧 fu→按「爆破锐度」选掷（p爆破=瞬时尖峰，ɸ摩擦=持续中等），4 掷竞速；
// gyu 一并按自然语速+微拉伸重试。
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
// 能量尾修剪：从尾往前找最后一个 |x|>thresh 的样本，封口在其后 tailMs
function trimTail(w, sr, thresh = 0.02, tailMs = 25) {
  const keep = Math.round((tailMs / 1000) * sr)
  let last = w.length - 1
  while (last >= 0 && Math.abs(w[last]) <= thresh) last--
  if (last < 0) return w
  const end = Math.min(w.length, last + 1 + keep)
  return w.slice(0, end)
}
// 爆破锐度：前 40ms 内最大单样本幅度 / 前 80ms 平均幅度（p 爆破尖峰高、ɸ摩擦平稳）
function burstSharpness(w, sr) {
  const n1 = Math.min(w.length, Math.round(sr * 0.04))
  const n2 = Math.min(w.length, Math.round(sr * 0.08))
  let peak = 0
  for (let i = 0; i < n1; i++) peak = Math.max(peak, Math.abs(w[i]))
  let sum = 0
  for (let i = 0; i < n2; i++) sum += Math.abs(w[i])
  const avg = sum / Math.max(1, n2)
  return avg > 0 ? peak / avg : 0
}
const dataRaw = await fs.readFile(path.join(OUT_BASE, 'data.js'), 'utf8')
const D = JSON.parse(dataRaw.replace(/^window\.KANA_VARIANTS = /, '').trim())
const TARGET = 400

// cells: 载词/速度档/是否拉伸到 TARGET
const CELLS = {
  re:  { arms: [{ text: 'おれ', vowel: 'e', nth: 2 }, { text: 'かれし', vowel: 'e', nth: 1 }, { text: 'れもん', vowel: 'e', nth: 1 }, { text: 'れー', vowel: 'e', nth: 1 }], ls: [1.4, 1.8, 2.2], stretch: true },
  ro:  { arms: [{ text: 'ろく', vowel: 'o', nth: 1 }, { text: 'ろー', vowel: 'o', nth: 1 }, { text: 'ろもん', vowel: 'o', nth: 1 }], ls: [1.4, 1.8, 2.2], stretch: true, trim: true },
  pa:  { arms: [{ text: 'ぱん', vowel: 'a', nth: 1 }], ls: [3.0, 3.4], stretch: true },
  pu:  { arms: [{ text: 'ぷーる', vowel: 'u', nth: 1 }, { text: 'ぷりん', vowel: 'u', nth: 1 }], ls: [1.4, 1.8], stretch: true, burst: true },
  gyu: { arms: [{ text: 'ぎゅう', vowel: 'u', nth: 1 }, { text: 'ぎゅうど', vowel: 'u', nth: 1 }], ls: [1.8, 2.2], stretch: true },
}

for (const [slug, spec] of Object.entries(CELLS)) {
  const cands = []
  for (const arm of spec.arms) {
    for (const ls of spec.ls) {
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
        let w = r.samples.slice(asamp, bsamp)
        if (spec.trim) w = trimTail(w, sr)
        const natural = Math.round((w.length / sr) * 1000)
        if (spec.stretch) {
          const consLen = vsamp - asamp
          const vowelSeg = w.slice(consLen)
          const targetVowel = Math.round((TARGET / 1000) * sr) - consLen
          if (targetVowel > vowelSeg.length) {
            const ratio = targetVowel / vowelSeg.length
            if (ratio > 1.6) { console.log(`  ${slug} ${arm.text} ls${ls}#${a}: 自然${natural}ms 拉${ratio.toFixed(2)} 跳过`); continue }
            w = new Float32Array([...w.slice(0, consLen), ...wsola(vowelSeg, sr, targetVowel)])
          } else w = w.slice(0, consLen + targetVowel)
        }
        const tail = Math.min(w.length, Math.round(sr * 0.08))
        const fade = Math.min(w.length, Math.round(sr * 0.012))
        for (let i = 0; i < tail; i++) w[w.length - 1 - i] *= Math.exp(-3 * (i / tail))
        for (let i = 0; i < fade; i++) w[w.length - 1 - i] *= i / fade
        const fi = Math.min(w.length, Math.round(sr * 0.004))
        for (let i = 0; i < fi; i++) w[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fi)
        const st = sliceStats(w, sr)
        const burst = spec.burst ? burstSharpness(w, sr) : 0
        console.log(`  ${slug} 「${arm.text}」ls${ls}#${a}: 自然${natural}ms→${st.ms}ms per ${st.per}${spec.burst ? ` 爆破${burst.toFixed(1)}` : ''}`)
        cands.push({ w, sr, st, ls, text: arm.text, natural, burst })
      }
    }
  }
  if (!cands.length) { console.log(`✗ ${slug}`); continue }
  const pool = cands.filter((c) => c.st.ms >= 360 && c.st.ms <= 450)
  const base = pool.length ? pool : cands
  let best
  if (spec.burst) best = base.reduce((x, y) => (y.burst > x.burst ? y : x))
  else best = base.reduce((x, y) => (y.st.per > x.st.per ? y : x))
  const mp3 = encodeMp3(polish(best.w, best.sr), best.sr, cfg.encode.bitrateKbps)
  await fs.writeFile(path.join(OUT_BASE, 'm', `${slug}.mp3`), mp3)
  D.stats.m[slug] = { voice: 'tsukuyomi-v1', strategy: `载词「${best.text}」ls${best.ls}（自然${best.natural}ms）`, form: best.text, dur: best.st.ms, per: Math.round(best.st.per * 100) / 100, zcr: Math.round(best.st.zcr * 100) / 100, attempts: 1, flag: false }
  console.log(`${slug}: 「${best.text}」ls${best.ls} 自然${best.natural}ms→${best.st.ms}ms per ${best.st.per}`)
}
await fs.writeFile(path.join(OUT_BASE, 'data.js'), 'window.KANA_VARIANTS = ' + JSON.stringify(D, null, 1) + '\n')
console.log('round16 完成')
