#!/usr/bin/env node
// round13 补：修三件事——①帽窗改为音频域样本数计算（此前 scale>1 时帽失效切出 598ms）；
// ②元音尾部 shave 45ms 避开下一辅音起振（ぷーる 的る起音漏入）；③选片改为时长约束（优先 350–460ms 内 per 最高）。
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

// 载词优先用目标长音在词内自然占满时长的（ぎゅう=牛肉单词、ぷーる=プール单词）
const CELLS = {
  gyu: [{ text: 'ぎゅう', vowel: 'u', nth: 1 }, { text: 'ぎゅうど', vowel: 'u', nth: 1 }],
  pu:  [{ text: 'ぷーる', vowel: 'u', nth: 1 }, { text: 'ぷりん', vowel: 'u', nth: 1 }],
  re:  [{ text: 'れーす', vowel: 'e', nth: 1 }, { text: 'これ', vowel: 'e', nth: 1 }],
  ro:  [{ text: 'ろーぷ', vowel: 'o', nth: 1 }, { text: 'ろく', vowel: 'o', nth: 1 }],
  he:  [{ text: 'へそ', vowel: 'e', nth: 1 }],
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
        // 音频域帽窗：最多 WINDOW 毫秒；且在元音 timing 结束前 45ms 收（避开下一辅音起振）
        const vowelEndSamp = Math.round(((loc.vowelEndMs - 45) / 1000) * sr * scale)
        const capSamp = asamp + Math.round((WINDOW / 1000) * sr)
        const bsamp = Math.min(r.samples.length, vowelEndSamp, capSamp)
        if (bsamp - asamp < Math.round(sr * 0.12)) { console.log(`  ${slug} ${arm.text} ls${ls}#${a}: 切片过短`); continue }
        const w = r.samples.slice(asamp, bsamp)
        const tail = Math.min(w.length, Math.round(sr * 0.08))
        const fade = Math.min(w.length, Math.round(sr * 0.012))
        for (let i = 0; i < tail; i++) w[w.length - 1 - i] *= Math.exp(-3 * (i / tail))
        for (let i = 0; i < fade; i++) w[w.length - 1 - i] *= i / fade
        const fi = Math.min(w.length, Math.round(sr * 0.004))
        for (let i = 0; i < fi; i++) w[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fi)
        const st = sliceStats(w, sr)
        console.log(`  ${slug} 「${arm.text}」ls${ls}#${a}: ${st.ms}ms per ${st.per}`)
        cands.push({ w, sr, st, ls, text: arm.text })
      }
    }
  }
  // 时长约束选片：优先 DUR_LO–DUR_HI 内 per 最高；否则选时长最接近 420 的
  const inRange = cands.filter((c) => c.st.ms >= DUR_LO && c.st.ms <= DUR_HI)
  const best = inRange.length ? inRange.reduce((x, y) => (y.st.per > x.st.per ? y : x)) : cands.reduce((x, y) => (Math.abs(y.st.ms - 420) < Math.abs(x.st.ms - 420) ? y : x))
  if (!best) { console.log(`✗ ${slug}`); continue }
  const mp3 = encodeMp3(polish(best.w, best.sr), best.sr, cfg.encode.bitrateKbps)
  await fs.writeFile(path.join(OUT_BASE, 'm', `${slug}.mp3`), mp3)
  D.stats.m[slug] = { voice: 'tsukuyomi-v1', strategy: `载词「${best.text}」ls${best.ls}`, form: best.text, dur: best.st.ms, per: Math.round(best.st.per * 100) / 100, zcr: Math.round(best.st.zcr * 100) / 100, attempts: 1, flag: false }
  console.log(`${slug}: 「${best.text}」ls${best.ls} → ${best.st.ms}ms per ${best.st.per}`)
}
await fs.writeFile(path.join(OUT_BASE, 'data.js'), 'window.KANA_VARIANTS = ' + JSON.stringify(D, null, 1) + '\n')
console.log('round13-fix 完成')
