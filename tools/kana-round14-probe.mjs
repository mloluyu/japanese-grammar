#!/usr/bin/env node
// 第 14 轮：
// - 切口终点改按下一音素起点（音频域）收 45ms——修 he「hetsu」（そ漏入）、ro「gu」（く漏入）。
// - pu 现行版（ぷーる 420ms 0.98）转用为 fu（用户指定）；pu 本身保留。
// - gyu：候选按「起音 80ms 内低过零率」选浊化最重（浊塞音 g 起音周期性强、zcr 低；清音 k 起音是爆破噪声、zcr 高）。
// - ni：にわ/にじ（i 在浊音 w/ʑ 前保持全浊）；pa：ぱん 拉到 400–420；re/ro/he 换掷重切。
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
  return { onsetMs: E[c].start_ms, vowelEndMs: E[v].end_ms, nextMs: v + 1 < E.length ? E[v + 1].start_ms : null, vIdx: v }
}
function zcrOf(seg) {
  let z = 0
  for (let i = 1; i < seg.length; i++) if ((seg[i - 1] < 0) !== (seg[i] < 0)) z++
  return z / seg.length
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

// pu→fu 转用（用户指定）
await fs.copyFile(path.join(OUT_BASE, 'm', 'pu.mp3'), path.join(OUT_BASE, 'm', 'fu.mp3'))
D.stats.fu = { ...D.stats.pu, strategy: 'ぷーる版转用（用户指定替代 fu）' }
console.log('fu ← pu 转用完成')

// ni 不重摇？——要：にわ/にじ。CELLS 全表（pu 已定稿不列）
const CELLS = {
  ni:  [{ text: 'にわ', vowel: 'i', nth: 1 }, { text: 'にじ', vowel: 'i', nth: 1 }],
  he:  [{ text: 'へそ', vowel: 'e', nth: 1 }, { text: 'へんじ', vowel: 'e', nth: 1 }],
  re:  [{ text: 'れきし', vowel: 'e', nth: 1 }, { text: 'れーす', vowel: 'e', nth: 1 }, { text: 'これ', vowel: 'e', nth: 1 }],
  ro:  [{ text: 'ろく', vowel: 'o', nth: 1 }, { text: 'ろーぷ', vowel: 'o', nth: 1 }],
  pa:  [{ text: 'ぱん', vowel: 'a', nth: 1 }],
  gyu: [{ text: 'ぎゅう', vowel: 'u', nth: 1 }, { text: 'ぎゅうど', vowel: 'u', nth: 1 }, { text: 'ぎゅうにゅう', vowel: 'u', nth: 1 }],
}
const WINDOW = 420
const DUR_LO = 350
const DUR_HI = 470

for (const [slug, arms] of Object.entries(CELLS)) {
  const cands = []
  for (const arm of arms) {
    for (const ls of [2.6, 3.2, 4.0, 5.0]) {
      for (let a = 1; a <= 2; a++) {
        const r = await piper.synthesize(arm.text, { ...voice.params, lengthScale: ls, noiseScale: 0.5, noiseW: 0.5 })
        const loc = locateMora(r.timing.phonemes, arm.vowel, arm.nth)
        if (!loc) { console.log(`  ${slug} ${arm.text}: 未定位`); continue }
        const sr = r.sampleRate
        const scale = r.samples.length / sr / (r.timing.phonemes[r.timing.phonemes.length - 1].end_ms / 1000)
        const asamp = Math.max(0, Math.round(((loc.onsetMs - 15) / 1000) * sr * scale))
        // 终点：下一音素起点（音频域）−45ms；无下一音素则用元音结尾
        const boundMs = loc.nextMs !== null ? loc.nextMs : loc.vowelEndMs
        const bsamp = Math.min(r.samples.length, asamp + Math.round((WINDOW / 1000) * sr), Math.round(((boundMs - 45) / 1000) * sr * scale))
        if (bsamp - asamp < Math.round(sr * 0.12)) { console.log(`  ${slug} ${arm.text} ls${ls}#${a}: 切片过短`); continue }
        const w = r.samples.slice(asamp, bsamp)
        const onsetZcr = zcrOf(w.slice(0, Math.min(w.length, Math.round(sr * 0.08))))
        const tail = Math.min(w.length, Math.round(sr * 0.08))
        const fade = Math.min(w.length, Math.round(sr * 0.012))
        for (let i = 0; i < tail; i++) w[w.length - 1 - i] *= Math.exp(-3 * (i / tail))
        for (let i = 0; i < fade; i++) w[w.length - 1 - i] *= i / fade
        const fi = Math.min(w.length, Math.round(sr * 0.004))
        for (let i = 0; i < fi; i++) w[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fi)
        const st = sliceStats(w, sr)
        console.log(`  ${slug} 「${arm.text}」ls${ls}#${a}: ${st.ms}ms per ${st.per} 起音zcr ${onsetZcr.toFixed(2)}`)
        cands.push({ w, sr, st, ls, text: arm.text, onsetZcr })
      }
    }
  }
  if (!cands.length) { console.log(`✗ ${slug}`); continue }
  const inRange = cands.filter((c) => c.st.ms >= DUR_LO && c.st.ms <= DUR_HI)
  const pool = inRange.length ? inRange : cands
  let best
  if (slug === 'gyu') {
    // 浊化优先：起音 zcr 最低者胜（要求 per≥0.75）
    const okPool = pool.filter((c) => c.st.per >= 0.75)
    const base = okPool.length ? okPool : pool
    best = base.reduce((x, y) => (y.onsetZcr < x.onsetZcr ? y : x))
  } else {
    best = pool.reduce((x, y) => (y.st.per > x.st.per ? y : x))
  }
  const mp3 = encodeMp3(polish(best.w, best.sr), best.sr, cfg.encode.bitrateKbps)
  await fs.writeFile(path.join(OUT_BASE, 'm', `${slug}.mp3`), mp3)
  D.stats.m[slug] = { voice: 'tsukuyomi-v1', strategy: `载词「${best.text}」ls${best.ls}`, form: best.text, dur: best.st.ms, per: Math.round(best.st.per * 100) / 100, zcr: Math.round(best.st.zcr * 100) / 100, onsetZcr: Math.round(best.onsetZcr * 100) / 100, attempts: 1, flag: false }
  console.log(`${slug}: 「${best.text}」ls${best.ls} → ${best.st.ms}ms per ${best.st.per} 起音zcr ${best.onsetZcr.toFixed(2)}`)
}
await fs.writeFile(path.join(OUT_BASE, 'data.js'), 'window.KANA_VARIANTS = ' + JSON.stringify(D, null, 1) + '\n')
console.log('round14 完成')
