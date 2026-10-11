#!/usr/bin/env node
// 第 3 轮诊断：三连假名「X、X、X。」+ 能量切音方案。
// ① 音素校验（全 104 格）：G2P 结果按 pau 切成 3 段应全等，且与预期音素一致（防「读音漂移」，
//    例：は 被读成助词 wa）。② 切音可行性：12 个代表假名 × 2 组参数合成→检测突发段，
//    取中间段测时长/峰值/有声性；段数不对就重掷（最多 3 次），统计成功率。
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { findBursts, extractBurst, voicedStats, peakOf } from './kana-seg.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const log = (...m) => console.log(...m)
const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1) }

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
const kanaData = JSON.parse(await fs.readFile(path.join(ROOT, 'docs/.vitepress/theme/data/kana-data.json'), 'utf8'))

const voiceId = Object.keys(cfg.voices).find((k) => cfg.voices[k].active)
if (!voiceId) die('没有 active 声音')
const voice = cfg.voices[voiceId]
const onnxPath = path.join(ROOT, cfg.modelCacheDir, voiceId, voice.model.onnx)
if (!existsSync(onnxPath)) die('模型缓存缺失')
currentConfigPath = path.join(ROOT, cfg.modelCacheDir, voiceId, voice.model.config)

const piper = await PiperPlus.initialize({
  model: onnxPath,
  ort: await import('onnxruntime-web'),
  wasmG2pUrl: pathToFileURL(path.join(ROOT, 'node_modules/piper-plus/dist/rust-wasm/piper_plus_wasm.js')).href,
})

// ---- 清单 ---------------------------------------------------------------------------
const cells = []
for (const part of ['seion', 'dakuten', 'yoon']) {
  const group = kanaData[part]
  const list = part === 'yoon' ? group.cells : group.rows.flatMap((r) => r.cells)
  for (const cell of list) if (cell) cells.push(cell)
}
const textOf = (h) => `${h}、${h}、${h}。`

// ---- ① 音素校验 -----------------------------------------------------------------------
// 预期音素（OpenJTalk 集；接受数组内任一变体）。键＝平假名。
const PH = {
  あ: [['a']], い: [['i']], う: [['u']], え: [['e']], お: [['o']],
  か: [['k', 'a']], き: [['k', 'i']], く: [['k', 'u']], け: [['k', 'e']], こ: [['k', 'o']],
  さ: [['s', 'a']], し: [['sh', 'i']], す: [['s', 'u']], せ: [['s', 'e']], そ: [['s', 'o']],
  た: [['t', 'a']], ち: [['ch', 'i']], つ: [['ts', 'u']], て: [['t', 'e']], と: [['t', 'o']],
  な: [['n', 'a']], に: [['n', 'i']], ぬ: [['n', 'u']], ね: [['n', 'e']], の: [['n', 'o']],
  は: [['h', 'a']], ひ: [['h', 'i']], ふ: [['f', 'u'], ['h', 'u']], へ: [['h', 'e']], ほ: [['h', 'o']],
  ま: [['m', 'a']], み: [['m', 'i']], む: [['m', 'u']], め: [['m', 'e']], も: [['m', 'o']],
  や: [['y', 'a']], ゆ: [['y', 'u']], よ: [['y', 'o']],
  ら: [['r', 'a']], り: [['r', 'i']], る: [['r', 'u']], れ: [['r', 'e']], ろ: [['r', 'o']],
  わ: [['w', 'a']], を: [['o']], ん: [['N'], ['n']],
  が: [['g', 'a']], ぎ: [['g', 'i']], ぐ: [['g', 'u']], げ: [['g', 'e']], ご: [['g', 'o']],
  ざ: [['z', 'a']], じ: [['zy', 'i'], ['j', 'i']], ず: [['z', 'u']], ぜ: [['z', 'e']], ぞ: [['z', 'o']],
  だ: [['d', 'a']], ぢ: [['zy', 'i'], ['j', 'i'], ['d', 'i']], づ: [['z', 'u'], ['d', 'u']], で: [['d', 'e']], ど: [['d', 'o']],
  ば: [['b', 'a']], び: [['b', 'i']], ぶ: [['b', 'u']], べ: [['b', 'e']], ぼ: [['b', 'o']],
  ぱ: [['p', 'a']], ぴ: [['p', 'i']], ぷ: [['p', 'u']], ぺ: [['p', 'e']], ぽ: [['p', 'o']],
}
// 拗音（显式补全；zy 可被实现为 j）
Object.assign(PH,
  ...['きゃ ky a', 'きゅ ky u', 'きょ ky o', 'しゃ sh a', 'しゅ sh u', 'しょ sh o', 'ちゃ ch a', 'ちゅ ch u', 'ちょ ch o',
    'にゃ ny a', 'にゅ ny u', 'にょ ny o', 'ひゃ hy a', 'ひゅ hy u', 'ひょ hy o', 'みゃ my a', 'みゅ my u', 'みょ my o',
    'りゃ ry a', 'りゅ ry u', 'りょ ry o', 'ぎゃ gy a', 'ぎゅ gy u', 'ぎょ gy o',
    'じゃ zy a', 'じゅ zy u', 'じょ zy o', 'びゃ by a', 'びゅ by u', 'びょ by o', 'ぴゃ py a', 'ぴゅ py u', 'ぴょ py o']
    .map((s) => { const [k, ...syms] = s.split(' '); return { [k]: [syms, syms.map((x) => x.replace('zy', 'j'))] } }),
)

// 音素 id→符号
const modelConfig = JSON.parse(await fs.readFile(currentConfigPath, 'utf8'))
const idToSym = new Map()
for (const [sym, ids] of Object.entries(modelConfig.phoneme_id_map ?? {})) {
  for (const id of ids) if (!idToSym.has(id)) idToSym.set(id, sym)
}
function phonemes(text) {
  const { phonemeIds } = piper._phonemizer.encode(text, 'ja')
  return phonemeIds.map((i) => idToSym.get(i) ?? `?${i}`)
}
const matchSeg = (segs, expect) => expect.some((e) => segs.join(' ') === e.join(' '))

log('== ① 音素校验（104 格，文本形态「X、X、X。」）')
const badPh = []
for (const cell of cells) {
  const syms = phonemes(textOf(cell.h))
  const segs = []
  let cur = []
  for (const s of syms) { if (s === 'pau') { if (cur.length) segs.push(cur); cur = [] } else cur.push(s) }
  if (cur.length) segs.push(cur)
  const expect = PH[cell.h]
  const three = segs.length === 3 && segs[0].join(' ') === segs[1].join(' ') && segs[1].join(' ') === segs[2].join(' ')
  const ok = expect ? three && segs.every((s) => matchSeg(s, expect)) : three
  if (!ok) { badPh.push(cell.h); log(`  ✗ ${cell.h}: ${segs.map((s) => s.join('')).join(' | ')}`) }
}
log(`音素校验：${cells.length - badPh.length}/${cells.length} 通过${badPh.length ? `，异常：${badPh.join(' ')}` : ''}`)

// ---- ② 切音可行性 ---------------------------------------------------------------------
const PARAMS = [
  { tag: 'P1', params: { noiseScale: 0.667, lengthScale: 1.0, noiseW: 0.8 } },
  { tag: 'P2', params: { noiseScale: 0.5, lengthScale: 1.15, noiseW: 0.5 } },
]
const TEST = ['い', 'な', 'ぬ', 'り', 'る', 'へ', 'は', 'を', 'ん', 'ぱ', 'つ', 'きゃ']
log('== ② 三连合成＋切音（取中间段；段数≠3 重掷≤3 次）')
for (const { tag, params } of PARAMS) {
  let okCount = 0
  for (const h of TEST) {
    let done = null
    for (let attempt = 1; attempt <= 3 && !done; attempt++) {
      const raw = await piper.synthesize(textOf(h), { ...voice.params, ...params })
      const bursts = findBursts(raw.samples, raw.sampleRate)
      if (bursts.length === 3) {
        const mid = extractBurst(raw.samples, bursts, 1, raw.sampleRate)
        const { per, zcr } = voicedStats(mid, raw.sampleRate)
        done = { ms: Math.round(mid.length / raw.sampleRate * 1000), peakDb: Math.round(20 * Math.log10(Math.max(peakOf(mid), 1e-9)) * 10) / 10, per, zcr, attempt }
      }
    }
    if (done) {
      okCount++
      log(`  ✓ ${tag} ${h}: 中段 ${done.ms}ms peak ${done.peakDb}dB per ${done.per} zcr ${done.zcr}（第${done.attempt}掷）`)
    } else {
      log(`  ✗ ${tag} ${h}: 3 掷均未得到 3 段`)
    }
  }
  log(`  ${tag} 成功率 ${okCount}/${TEST.length}`)
}
log('done')
