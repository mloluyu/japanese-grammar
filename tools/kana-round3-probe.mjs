#!/usr/bin/env node
// 五十音一次性参数试听探针·第 3 轮（timing 精切混合策略）。
// 诊断链（kana-diag.mjs～diag4.mjs）证实：裸假名=纯噪声；延长音「Xー」可靠有声但首元音之后
// 会拖尾漂移；三连「X、X、X。」声学粘团但 timing 时间戳可精切中段。
// 本轮：每格先 C2=延长音首元音精切 ×3 掷，不行再 C1=三连中段精切 ×3 掷（含 E=3 元音/拨音行），
// 仍不行取最优切片并打 flag。产物 tools/kana-variants/f/ + data.js，供试听页。
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { voicedStats, peakOf } from './kana-seg.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_BASE = path.join(ROOT, 'tools/kana-variants')
const DATA_FILE = path.join(ROOT, 'docs/.vitepress/theme/data/kana-data.json')

const log = (...m) => console.log(...m)
const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1) }

// ---- 垫片（与 generate-audio.mjs 相同）----------------------------------------------
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
const kanaData = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'))

const voiceId = Object.keys(cfg.voices).find((k) => cfg.voices[k].active)
if (!voiceId) die('没有 active 声音')
const voice = cfg.voices[voiceId]

const NORM_PEAK = 0.6
const HEAD_SEC = 0.08
const TAIL_SEC = 0.28

// は/へ 的 G2P 特例：は 平假名恒读 wa（助词），用片假名 ハ；へ 恒读 e，用汉字 屁（字典音 h e）。
const baseOf = (h) => (h === 'は' ? 'ハ' : h === 'へ' ? '屁' : h)

// ---- 清单 ---------------------------------------------------------------------------
const cells = []
for (const part of ['seion', 'dakuten', 'yoon']) {
  const group = kanaData[part]
  const list = part === 'yoon' ? group.cells : group.rows.flatMap((r) => r.cells)
  for (const cell of list) if (cell) cells.push({ ...cell, slug: cell.s ?? cell.r })
}

// 清掉第 1/2 轮产物与旧 data.js（保留试听页 html）
for (const d of ['a', 'b', 'c', 'd', 'e']) await fs.rm(path.join(OUT_BASE, d), { recursive: true, force: true })
await fs.rm(path.join(OUT_BASE, 'data.js'), { force: true })
const outDir = path.join(OUT_BASE, 'f')
await fs.mkdir(outDir, { recursive: true })

// ---- 编码 ---------------------------------------------------------------------------
const lameMod = await import('@breezystack/lamejs')
const lame = lameMod.Mp3Encoder ? lameMod : lameMod.default
if (!lame?.Mp3Encoder) die('lamejs 加载失败——先运行 npm run audio:setup')
function floatToInt16(samples) {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}
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

// ---- 引擎 ---------------------------------------------------------------------------
const onnxPath = path.join(ROOT, cfg.modelCacheDir, voiceId, voice.model.onnx)
if (!existsSync(onnxPath)) die('模型缓存缺失——先运行 npm run audio:generate')
currentConfigPath = path.join(ROOT, cfg.modelCacheDir, voiceId, voice.model.config)
const piper = await PiperPlus.initialize({
  model: onnxPath,
  ort: await import('onnxruntime-web'),
  wasmG2pUrl: pathToFileURL(path.join(ROOT, 'node_modules/piper-plus/dist/rust-wasm/piper_plus_wasm.js')).href,
})

// ---- timing 精切 ----------------------------------------------------------------------
// timing 时间轴 → 音频样本：scale = 音频时长 / timing 末尾（每次合成实测校准）
function sliceByTiming(r, startMs, endMs, sr) {
  const E = r.timing.phonemes
  const lastEnd = E[E.length - 1].end_ms
  const scale = r.samples.length / sr / (lastEnd / 1000)
  const a = Math.max(0, Math.round((startMs / 1000) * sr * scale))
  const b = Math.min(r.samples.length, Math.round((endMs / 1000) * sr * scale))
  return r.samples.slice(a, b)
}
// C2：延长音「Xー」首个元音末精切。实项 >=5（C,#,V,[,V）→ 元音=E[2]；4（V,],[,V）/3（N,[,N）→ E[0]。
function cutLong(r) {
  const E = r.timing.phonemes
  if (E.length < 3) return null
  const vi = E.length >= 5 ? 2 : 0
  return sliceByTiming(r, E[0].start_ms, E[vi].end_ms, r.sampleRate)
}
// C1：三连「X、X、X。」中段精切。实项数必为 3 的倍数（元音/拨音行=3，其余=9）。
function cutTriple(r) {
  const E = r.timing.phonemes
  if (E.length < 3 || E.length % 3 !== 0) return null
  const mid = E.length / 3
  return sliceByTiming(r, E[mid].start_ms, E[2 * mid - 1].end_ms, r.sampleRate)
}
function sliceStats(s, sr) {
  const { per, zcr } = voicedStats(s, sr)
  return { ms: Math.round((s.length / sr) * 1000), per, zcr }
}
const okSlice = (st) => st.ms >= 80 && st.ms <= 500 && st.per >= 0.65 && st.zcr <= 0.35

function polish(slice, sr) {
  // 6ms 余弦淡入出 + 峰值归一化 + 头 80ms/尾 280ms 静音垫
  const f = Math.round(sr * 0.006)
  for (let i = 0; i < f && i < slice.length; i++) {
    const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / f)
    slice[i] *= g
    slice[slice.length - 1 - i] *= g
  }
  const peak = peakOf(slice)
  if (peak > 0) { const gain = NORM_PEAK / peak; for (let i = 0; i < slice.length; i++) slice[i] *= gain }
  const out = new Float32Array(slice.length + Math.round(sr * (HEAD_SEC + TAIL_SEC)))
  out.set(slice, Math.round(sr * HEAD_SEC))
  return out
}

// ---- 主流程 ---------------------------------------------------------------------------
const STRATS = [
  { tag: '延长切', text: (h) => baseOf(h) + 'ー', params: { noiseScale: 0.667, lengthScale: 1.8, noiseW: 0.8 }, cut: cutLong, rolls: 3 },
  { tag: '三连切', text: (h) => { const b = baseOf(h); return `${b}、${b}、${b}。` }, params: { noiseScale: 0.667, lengthScale: 1.0, noiseW: 0.8 }, cut: cutTriple, rolls: 3 },
]

const stats = { f: {} }
const flags = []
let failures = 0
for (const cell of cells) {
  try {
    let chosen = null // {slice, sr, st, strategy, attempt}
    let best = null
    for (const strat of STRATS) {
      const params = { ...voice.params, ...strat.params }
      for (let attempt = 1; attempt <= strat.rolls && !chosen; attempt++) {
        const r = await piper.synthesize(strat.text(cell.h), params)
        const slice = strat.cut(r)
        if (!slice || slice.length < 8) continue
        const st = sliceStats(slice, r.sampleRate)
        const cand = { slice, sr: r.sampleRate, st, strategy: strat.tag, attempt }
        if (okSlice(st)) { chosen = cand; break }
        const score = st.per - Math.abs(st.ms - 250) / 1000
        if (!best || score > best._score) best = { ...cand, _score: score }
      }
      if (chosen) break
    }
    const picked = chosen ?? best
    if (!picked) throw new Error('6 掷无可切片段')
    const flagged = !chosen
    const final = polish(picked.slice, picked.sr)
    const mp3 = encodeMp3(final, picked.sr, cfg.encode.bitrateKbps)
    await fs.writeFile(path.join(outDir, `${cell.slug}.mp3`), mp3)
    const rec = {
      strategy: picked.strategy,
      dur: picked.st.ms,
      per: Math.round(picked.st.per * 100) / 100,
      zcr: Math.round(picked.st.zcr * 100) / 100,
      attempts: flagged ? 7 : picked.attempt,
      flag: flagged,
    }
    stats.f[cell.slug] = rec
    if (flagged) flags.push(cell.slug)
    log(`  ✓ ${cell.slug} ${picked.strategy} ${rec.dur}ms per ${rec.per} 第${rec.attempt}掷${flagged ? ' ⚠FLAG' : ''}`)
  } catch (err) {
    failures++
    console.error(`  ✗ ${cell.slug}: ${err.message}`)
  }
}

const byStrategy = Object.values(stats.f).reduce((m, s) => { m[s.strategy] = (m[s.strategy] ?? 0) + 1; return m }, {})
log(`== 完成：${cells.length - failures}/104 成功，失败 ${failures}；策略分布 ${JSON.stringify(byStrategy)}；FLAG ${flags.length} 格${flags.length ? '：' + flags.join(' ') : ''}`)

await fs.writeFile(
  path.join(OUT_BASE, 'data.js'),
  'window.KANA_VARIANTS = ' + JSON.stringify({
    cells,
    variants: [{ id: 'f', label: 'F 精切', desc: 'timing 精切（延长音首选＋三连补切）· 峰值 0.6 · 64kbps' }],
    stats,
  }, null, 1) + '\n',
)
if (failures) process.exit(1)
