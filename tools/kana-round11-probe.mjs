#!/usr/bin/env node
// 第 11 轮：剩 10 格（ni/ra/ru/re/ro/wo/pa/pu/ja/gyu）改载词法——
// 目标假名放进真实单词，辅音自然发音，用 timing 精确切出目标莫拉（同「へ→屁」思路）。
// 切法：定位目标莫拉元音（第 nth 次出现的元音字形），从其前辅音簇起点−15ms 切到该元音单元结束；
// 含长音的载词（ぷーる/ぎゅう，元音持续）切固定 390ms。を = お 同音，直接复制用户勾选的 L 版音频。
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
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
const onnx = path.join(dir, voice.model.onnx)
if (!existsSync(onnx)) process.exit(1)
const piper = await PiperPlus.initialize({
  model: onnx,
  ort: await import('onnxruntime-web'),
  wasmG2pUrl: pathToFileURL(path.join(ROOT, 'node_modules/piper-plus/dist/rust-wasm/piper_plus_wasm.js')).href,
})
log('tsukuyomi 就绪')

// 载词表：text=单词；vowel+nth=目标莫拉的元音（第 nth 次出现）；fixed=元音持续型切固定时长
const WORDS = {
  ni: { text: 'にわ', vowel: 'i', nth: 1 },        // 庭：切「に」
  ra: { text: 'とら', vowel: 'a', nth: 2 },        // 虎：切词中「ら」
  ru: { text: 'くり', vowel: 'u', nth: 1 },        // 栗：切「る」
  re: { text: 'これ', vowel: 'e', nth: 1 },        // 此れ：切「れ」
  ro: { text: 'いろ', vowel: 'o', nth: 1 },        // 色：切「ろ」
  pa: { text: 'ぱん', vowel: 'a', nth: 1 },        // 面包：切「ぱ」
  pu: { text: 'ぷーる', vowel: 'u', nth: 1, fixed: 390 }, // 泳池：ぷ+长音，u 持续
  ja: { text: 'じゃがいも', vowel: 'a', nth: 1 },  // 土豆：切「じゃ」
  gyu: { text: 'ぎゅう', vowel: 'u', nth: 1, fixed: 390 }, // 牛：ぎゅ+长音，u 持续
}
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u'])
const SKIP = new Set(['_', '#', '[', ']', 'pau', 'sil'])

function floatToInt16(samples) {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}
const lameMod = await import('@breezystack/lamejs')
const lame = lameMod.Mp3Encoder ? lameMod : lameMod.default
function encodeMp3(samples, sampleRate, kbps) {
  const enc = new lame.Mp3Encoder(1, sampleRate, kbps)
  const pcm = floatToInt16(samples)
  const chunks = []
  for (let i = 0; i < pcm.length; i += 1152) {
    const buf = enc.encodeBuffer(pcm.subarray(i, i + 1152))
    if (buf.length) chunks.push(Buffer.from(buf))
  }
  const tail = enc.flush()
  if (tail.length) chunks.push(Buffer.from(tail))
  return Buffer.concat(chunks)
}

// 找第 nth 次出现的元音字形 → 回溯辅音簇起点 → [簇起点−15, 元音单元结束]；fixed 则到 +fixed ms
function locateMora(E, w) {
  let seen = 0, vIdx = -1
  for (let i = 0; i < E.length; i++) {
    if (E[i].phoneme === w.vowel) { seen++; if (seen === w.nth) { vIdx = i; break } }
  }
  if (vIdx < 0) return null
  let cIdx = vIdx
  while (cIdx > 0 && !VOWELS.has(E[cIdx - 1].phoneme) && !SKIP.has(E[cIdx - 1].phoneme)) cIdx--
  return { onsetMs: E[cIdx].start_ms, vowelEndMs: E[vIdx].end_ms }
}
function cut(r, sr, aMs, bMs) {
  const E = r.timing.phonemes
  const lastEnd = E[E.length - 1].end_ms
  const scale = r.samples.length / sr / (lastEnd / 1000)
  const a = Math.max(0, Math.round((aMs / 1000) * sr * scale))
  const b = Math.min(r.samples.length, Math.round((bMs / 1000) * sr * scale))
  if (b - a < Math.round(sr * 0.12)) return null
  const win = r.samples.slice(a, b)
  const tail = Math.min(win.length, Math.round(sr * 0.08))
  const fade = Math.min(win.length, Math.round(sr * 0.012))
  for (let i = 0; i < tail; i++) win[win.length - 1 - i] *= Math.exp(-3 * (i / tail))
  for (let i = 0; i < fade; i++) win[win.length - 1 - i] *= i / fade
  const fi = Math.min(win.length, Math.round(sr * 0.004))
  for (let i = 0; i < fi; i++) win[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fi)
  return win
}
const sliceStats = (win, sr) => {
  const body = win.length > Math.round(sr * 0.08) ? win.slice(0, win.length - Math.round(sr * 0.08)) : win
  const { per, zcr } = voicedStats(body, sr)
  return { ms: Math.round((win.length / sr) * 1000), per, zcr }
}
function polish(win, sr) {
  const peak = peakOf(win)
  if (peak > 0) { const g = 0.6 / peak; for (let i = 0; i < win.length; i++) win[i] *= g }
  const out = new Float32Array(win.length + Math.round(sr * (0.08 + 0.24)))
  out.set(win, Math.round(sr * 0.08))
  return out
}

const dataRaw = await fs.readFile(path.join(OUT_BASE, 'data.js'), 'utf8')
const D = JSON.parse(dataRaw.replace(/^window\.KANA_VARIANTS = /, '').trim())
await fs.mkdir(path.join(OUT_BASE, 'm'), { recursive: true })

// を = お 同音：复制用户勾选的 L 版音频
if (D.stats.l?.o?.dur && existsSync(path.join(OUT_BASE, 'l', 'o.mp3'))) {
  await fs.copyFile(path.join(OUT_BASE, 'l', 'o.mp3'), path.join(OUT_BASE, 'm', 'wo.mp3'))
  D.stats.m.wo = { ...D.stats.l.o, strategy: 'を=お同音转写(L版o)', form: 'を（=お）', flag: false }
  log('wo ← 复制 L 版 o.mp3（を 现代标准读 o）')
}

for (const [slug, w] of Object.entries(WORDS)) {
  let best = null
  for (const ls of [2.6, 3.2]) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const r = await piper.synthesize(w.text, { ...voice.params, lengthScale: ls, noiseScale: 0.5, noiseW: 0.5 })
      const loc = locateMora(r.timing.phonemes, w)
      if (!loc) continue
      const aMs = Math.max(0, loc.onsetMs - 15)
      const bMs = w.fixed ? aMs + w.fixed : loc.vowelEndMs
      const win = cut(r, r.sampleRate, aMs, bMs)
      if (!win) continue
      const st = sliceStats(win, r.sampleRate)
      if (!best || st.per > best.st.per) best = { win, sr: r.sampleRate, st, ls, attempt }
      if (best.st.per >= 0.95) break
    }
    if (best?.st.per >= 0.95) break
  }
  if (!best) { log(`✗ ${slug}: 全掷失败`); D.stats.m[slug] = { ...(D.stats.m[slug] || {}), flag: true }; continue }
  const mp3 = encodeMp3(polish(best.win, best.sr), best.sr, cfg.encode.bitrateKbps)
  await fs.writeFile(path.join(OUT_BASE, 'm', `${slug}.mp3`), mp3)
  D.stats.m[slug] = {
    voice: 'tsukuyomi-v1',
    strategy: `载词「${w.text}」ls${best.ls}`,
    form: w.text,
    dur: best.st.ms,
    per: Math.round(best.st.per * 100) / 100,
    zcr: Math.round(best.st.zcr * 100) / 100,
    attempts: best.attempt,
    flag: false,
  }
  log(`${slug}: 「${w.text}」ls${best.ls} → ${best.st.ms}ms per ${best.st.per}`)
}
D.variants = [
  ...D.variants.filter((v) => v.id !== 'm'),
  { id: 'm', label: 'M 载词精切', desc: '10 个顽固格改载词法（にわ/とら/くり/これ/いろ/ぱん/ぷーる/じゃがいも/ぎゅう，を=お同音）——真实单词里辅音自然发音，timing 精切目标莫拉' },
]
await fs.writeFile(path.join(OUT_BASE, 'data.js'), 'window.KANA_VARIANTS = ' + JSON.stringify(D, null, 1) + '\n')
const es = Object.entries(D.stats.m).filter(([, s]) => s.dur)
log(`M 列现有 ${es.length} 格`)
log('完成')
