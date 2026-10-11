#!/usr/bin/env node
// 第 10 轮：剩 24 格噪声重＋辅音发音怪 → 判定为「Xーーー。」三长音形态本身出格。
// 改文本形态竞速（窗口仍 390ms）：单延长「Xー。」/双延长「Xーー。」/「ん、」暖声前奏/快速低噪三长音。
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
const SLUGS = ['a', 'ke', 'sa', 'te', 'ni', 'mu', 'ya', 'yo', 'ra', 'ri', 'ru', 're', 'ro', 'wo', 'n', 'gi', 'go', 'do', 'pa', 'pu', 'po', 'ja', 'gyu', 'jo']
// 4 条臂：不同文本形态 × 参数。E1=单延长（第2轮 D/E 血统，形态最自然）；E2=双延长；W=ん、暖声前奏；F3=快速低噪三长音
const ARMS = [
  { id: 'E1', text: (b) => `${b}ー。`, ns: 0.5, nw: 0.5, ls: 2.2 },
  { id: 'E2', text: (b) => `${b}ーー。`, ns: 0.5, nw: 0.5, ls: 2.0 },
  { id: 'W', text: (b) => `ん、${b}ーー。`, ns: 0.5, nw: 0.5, ls: 2.0 },
  { id: 'F3', text: (b) => `${b}ーーー。`, ns: 0.4, nw: 0.25, ls: 1.6 },
]

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

// 定位目标假名的辅音起振点：取 timing 里第一个非空白实音素（跳过前置 pau/# 与暖声「ん、」）
function onsetOf(r) {
  const E = r.timing.phonemes
  if (!E.length) return null
  const skip = new Set(['_', '#', '[', ']', 'pau', 'sil', 'N', 'n'])
  // W 臂有暖声「ん、」：跳过开头的 n/N 与其后空白，找第一个非跳过音素
  let idx = 0
  while (idx < E.length && skip.has(E[idx].phoneme)) idx++
  if (idx >= E.length) idx = 0
  return { startMs: E[idx].start_ms, idx }
}
function cutWindow(r, sr, startMs, lenMs) {
  const E = r.timing.phonemes
  if (!E.length) return null
  const lastEnd = E[E.length - 1].end_ms
  const scale = r.samples.length / sr / (lastEnd / 1000)
  const a = Math.max(0, Math.round((startMs / 1000) * sr * scale))
  const b = Math.min(r.samples.length, a + Math.round((lenMs / 1000) * sr))
  if (b - a < Math.round(sr * 0.25)) return null
  const win = r.samples.slice(a, b)
  const tail = Math.min(win.length, Math.round(sr * 0.1))
  const fade = Math.min(win.length, Math.round(sr * 0.012))
  for (let i = 0; i < tail; i++) win[win.length - 1 - i] *= Math.exp(-3 * (i / tail))
  for (let i = 0; i < fade; i++) win[win.length - 1 - i] *= i / fade
  const fi = Math.min(win.length, Math.round(sr * 0.006))
  for (let i = 0; i < fi; i++) win[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fi)
  return win
}
const sliceStats = (win, sr) => {
  const body = win.length > Math.round(sr * 0.1) ? win.slice(0, win.length - Math.round(sr * 0.1)) : win
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
D.stats.m = {}

let done = 0
for (const slug of SLUGS) {
  const cell = D.cells.find((c) => c.slug === slug)
  const base = baseOf(cell.h)
  let best = null
  for (const arm of ARMS) {
    const text = arm.text(base)
    for (let attempt = 1; attempt <= 2; attempt++) {
      const r = await piper.synthesize(text, { ...voice.params, lengthScale: arm.ls, noiseScale: arm.ns, noiseW: arm.nw })
      const on = onsetOf(r)
      if (!on) continue
      const win = cutWindow(r, r.sampleRate, Math.max(0, on.startMs - 15), TARGET)
      if (!win) continue
      const st = sliceStats(win, r.sampleRate)
      if (!best || st.per > best.st.per || (st.per === best.st.per && st.zcr < best.st.zcr)) {
        best = { win, sr: r.sampleRate, st, arm, attempt, text }
      }
      if (best.st.per >= 0.95) break
    }
    if (best?.st.per >= 0.95) break
  }
  if (!best) { log(`✗ ${slug}: 全掷失败`); D.stats.m[slug] = { flag: true }; continue }
  const mp3 = encodeMp3(polish(best.win, best.sr), best.sr, cfg.encode.bitrateKbps)
  await fs.writeFile(path.join(OUT_BASE, 'm', `${slug}.mp3`), mp3)
  D.stats.m[slug] = {
    voice: 'tsukuyomi-v1',
    strategy: `390·形态${best.arm.id}`,
    form: best.text,
    dur: best.st.ms,
    per: Math.round(best.st.per * 100) / 100,
    zcr: Math.round(best.st.zcr * 100) / 100,
    attempts: best.attempt,
    flag: false,
  }
  done++
  if (done % 8 === 0) log(`进度 ${done}/${SLUGS.length}`)
}
D.variants = [
  ...D.variants.filter((v) => v.id !== 'm'),
  { id: 'm', label: 'M 390·形态竞速', desc: '390ms 窗口；每格 4 种文本形态竞速：E1=「Xー。」单延长 E2=「Xーー。」双延长 W=「ん、」暖声前奏 F3=快速低噪三长音' },
]
await fs.writeFile(path.join(OUT_BASE, 'data.js'), 'window.KANA_VARIANTS = ' + JSON.stringify(D, null, 1) + '\n')
const es = Object.entries(D.stats.m).filter(([, s]) => s.dur)
const pers = es.map(([, s]) => s.per).sort((a, b) => a - b)
const formTally = {}
for (const [, s] of es) { const k = s.strategy.match(/形态(\w+)/)?.[1]; if (k) formTally[k] = (formTally[k] || 0) + 1 }
log(`M 列：${es.length} 格；per min ${pers[0]} 中位 ${pers[Math.floor(pers.length / 2)]}；形态胜出 ${JSON.stringify(formTally)}`)
log('完成')
