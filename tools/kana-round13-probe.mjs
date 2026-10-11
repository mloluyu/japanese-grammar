#!/usr/bin/env node
// 第 13 轮：按用户听感诊断逐格对症——
// gyu 太短→ぎゅうど/ぎゅうにく（长音う后接闭塞/鼻音闭塞）；pu「嗯噗」→ん漏入切口，改词首ぷ（ぷりん/ぷれぜんと）；
// pa 辅音不明显→ぱん（词首p完整闭塞+a，420ms 帽）；re/ro 戛然而止→れーす/ろーぷ（长音元音后接清音闭塞）；
// he「哔——」→へや的や滑音，改へそ（e 后接 s 闭塞）；ni 辅音不明显→にし（n 后接 し 闭塞）/にら，高语速拉长。
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
  return { onsetMs: E[c].start_ms, vowelEndMs: E[v].end_ms }
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
  gyu: [{ text: 'ぎゅうど', vowel: 'u', nth: 1 }, { text: 'ぎゅうにく', vowel: 'u', nth: 1 }],
  pu:  [{ text: 'ぷりん', vowel: 'u', nth: 1 }, { text: 'ぷれぜんと', vowel: 'u', nth: 1 }],
  pa:  [{ text: 'ぱん', vowel: 'a', nth: 1 }],
  re:  [{ text: 'れーす', vowel: 'e', nth: 1 }, { text: 'これ', vowel: 'e', nth: 1 }],
  ro:  [{ text: 'ろーぷ', vowel: 'o', nth: 1 }, { text: 'ろく', vowel: 'o', nth: 1 }],
  he:  [{ text: 'へそ', vowel: 'e', nth: 1 }],
  ni:  [{ text: 'にし', vowel: 'i', nth: 1 }, { text: 'にら', vowel: 'i', nth: 1 }],
}
const WINDOW = 420

for (const [slug, arms] of Object.entries(CELLS)) {
  let best = null
  for (const arm of arms) {
    for (const ls of [2.2, 2.6, 3.2, 4.0]) {
      for (let a = 1; a <= 2; a++) {
        const r = await piper.synthesize(arm.text, { ...voice.params, lengthScale: ls, noiseScale: 0.5, noiseW: 0.5 })
        const loc = locateMora(r.timing.phonemes, arm.vowel, arm.nth)
        if (!loc) { console.log(`  ${slug} ${arm.text}: 未定位`); continue }
        const E = r.timing.phonemes
        const lastEnd = E[E.length - 1].end_ms
        const scale = r.samples.length / r.sampleRate / (lastEnd / 1000)
        const asamp = Math.max(0, Math.round(((loc.onsetMs - 15) / 1000) * r.sampleRate * scale))
        const bsamp = Math.min(r.samples.length, Math.round((Math.min(loc.vowelEndMs, (loc.onsetMs - 15) + WINDOW) / 1000) * r.sampleRate * scale))
        if (bsamp - asamp < Math.round(r.sampleRate * 0.12)) { console.log(`  ${slug} ${arm.text} ls${ls}#${a}: 切片过短`); continue }
        const w = r.samples.slice(asamp, bsamp)
        const tail = Math.min(w.length, Math.round(r.sampleRate * 0.08))
        const fade = Math.min(w.length, Math.round(r.sampleRate * 0.012))
        for (let i = 0; i < tail; i++) w[w.length - 1 - i] *= Math.exp(-3 * (i / tail))
        for (let i = 0; i < fade; i++) w[w.length - 1 - i] *= i / fade
        const fi = Math.min(w.length, Math.round(r.sampleRate * 0.004))
        for (let i = 0; i < fi; i++) w[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fi)
        const st = sliceStats(w, r.sampleRate)
        console.log(`  ${slug} 「${arm.text}」ls${ls}#${a}: ${st.ms}ms per ${st.per}`)
        if (!best || st.per > best.st.per) best = { w, sr: r.sampleRate, st, ls, text: arm.text }
        if (best.st.per >= 0.92) break
      }
      if (best?.st.per >= 0.92) break
    }
    if (best?.st.per >= 0.92) break
  }
  if (!best) { console.log(`✗ ${slug}`); continue }
  const mp3 = encodeMp3(polish(best.w, best.sr), best.sr, cfg.encode.bitrateKbps)
  await fs.writeFile(path.join(OUT_BASE, 'm', `${slug}.mp3`), mp3)
  D.stats.m[slug] = { voice: 'tsukuyomi-v1', strategy: `载词「${best.text}」ls${best.ls}`, form: best.text, dur: best.st.ms, per: Math.round(best.st.per * 100) / 100, zcr: Math.round(best.st.zcr * 100) / 100, attempts: 1, flag: false }
  console.log(`${slug}: 「${best.text}」ls${best.ls} → ${best.st.ms}ms per ${best.st.per}`)
}
await fs.writeFile(path.join(OUT_BASE, 'data.js'), 'window.KANA_VARIANTS = ' + JSON.stringify(D, null, 1) + '\n')
console.log('round13 完成')
