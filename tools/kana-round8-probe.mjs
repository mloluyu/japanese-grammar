#!/usr/bin/env node
// 第 8 轮：用户再要求切短，对标记「重做」的 39 格改用 390ms 定长窗口重摇。
// 方法同第 6 轮：合成「Xーーー。」（统一语速 2.6）→ 从辅音起振点截取精确 390ms → 尾部指数衰减 → 归一 0.6。
// 输出 tools/kana-variants/k/，stats.k，variants 增 K。用户已勾选的 64 格（pick i/f/j）不受影响。
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

const TARGET = 390
const LS = 2.6
const SLUGS = ['a', 'o', 'ke', 'ko', 'sa', 'ta', 'te', 'na', 'ni', 'no', 'ha', 'mu', 'mo', 'ya', 'yo', 'ra', 'ri', 'ru', 're', 'ro', 'wa', 'wo', 'n', 'ga', 'gi', 'ge', 'go', 'za', 'ji', 'do', 'ba', 'pa', 'pu', 'po', 'ja', 'pya', 'ryu', 'gyu', 'jo']

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

const baseOf = (h) => (h === 'は' ? 'ハ' : h === 'へ' ? '屁' : h)
const textFor = (h) => `${baseOf(h)}ーーー。`

function cutWindow(r, sr, startMs, lenMs) {
  const E = r.timing.phonemes
  if (!E.length) return null
  const lastEnd = E[E.length - 1].end_ms
  const scale = r.samples.length / sr / (lastEnd / 1000)
  const a = Math.max(0, Math.round((startMs / 1000) * sr * scale))
  const b = Math.min(r.samples.length, a + Math.round((lenMs / 1000) * sr))
  if (b - a < Math.round(sr * 0.25)) return null
  const win = r.samples.slice(a, b)
  const tail = Math.min(win.length, Math.round(sr * 0.12))
  const fade = Math.min(win.length, Math.round(sr * 0.012))
  for (let i = 0; i < tail; i++) win[win.length - 1 - i] *= Math.exp(-3.5 * (i / tail))
  for (let i = 0; i < fade; i++) win[win.length - 1 - i] *= i / fade
  const fi = Math.min(win.length, Math.round(sr * 0.006))
  for (let i = 0; i < fi; i++) win[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fi)
  return win
}
const sliceStats = (win, sr) => {
  const body = win.length > Math.round(sr * 0.12) ? win.slice(0, win.length - Math.round(sr * 0.12)) : win
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
await fs.mkdir(path.join(OUT_BASE, 'k'), { recursive: true })
D.stats.k = {}

let done = 0
for (const slug of SLUGS) {
  const cell = D.cells.find((c) => c.slug === slug)
  const text = textFor(cell.h)
  let picked = null, best = null
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await piper.synthesize(text, { ...voice.params, lengthScale: LS })
    const Ee = r.timing.phonemes
    if (!Ee.length) continue
    const win = cutWindow(r, r.sampleRate, Math.max(0, Ee[0].start_ms - 15), TARGET)
    if (!win) continue
    const st = sliceStats(win, r.sampleRate)
    const ok = st.per >= 0.75 && st.zcr <= 0.4 && st.ms >= TARGET - 20
    if (ok) { picked = { win, sr: r.sampleRate, st, attempt }; break }
    if (!best || st.per > best.st.per) best = { win, sr: r.sampleRate, st, attempt }
  }
  const chosen = picked ?? best
  if (!chosen) { log(`✗ ${slug}: 全掷失败`); D.stats.k[slug] = { flag: true, attempts: 4 }; continue }
  const mp3 = encodeMp3(polish(chosen.win, chosen.sr), chosen.sr, cfg.encode.bitrateKbps)
  await fs.writeFile(path.join(OUT_BASE, 'k', `${slug}.mp3`), mp3)
  D.stats.k[slug] = {
    voice: 'tsukuyomi-v1',
    strategy: '定长窗口390',
    dur: chosen.st.ms,
    per: Math.round(chosen.st.per * 100) / 100,
    zcr: Math.round(chosen.st.zcr * 100) / 100,
    attempts: chosen.attempt,
    ls: LS,
    flag: !picked,
  }
  done++
  if (done % 10 === 0) log(`进度 ${done}/${SLUGS.length}`)
}
D.variants = [
  ...D.variants.filter((v) => v.id !== 'k'),
  { id: 'k', label: 'K 390ms', desc: 'tsukuyomi · 定长窗口精确 390ms · 重摇 39 格 · 指数衰减收尾 · 峰值 0.6' },
]
await fs.writeFile(path.join(OUT_BASE, 'data.js'), 'window.KANA_VARIANTS = ' + JSON.stringify(D, null, 1) + '\n')
const es = Object.entries(D.stats.k).filter(([, s]) => s.dur)
const durs = es.map(([, s]) => s.dur).sort((a, b) => a - b)
log(`K 列：${es.length} 格；时长 ${durs[0]}–${durs[durs.length - 1]}ms；=390 ${es.filter(([, s]) => s.dur === 390).length}；per<0.75 ${es.filter(([, s]) => (s.per ?? 1) < 0.75).length}；flag ${es.filter(([, s]) => s.flag).length}`)
log('完成')
