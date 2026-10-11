// 五十音切音工具：能量分帧 → 突发段检测 → 取中间段＋淡入淡出。
// 供 tools/kana-diag2.mjs（诊断）与试听探针/正式生成共用。

// 分帧 RMS（frame/hop 单位：样本）
export function frameRms(samples, frame = 256, hop = 128) {
  const n = Math.max(0, Math.floor((samples.length - frame) / hop) + 1)
  const out = new Float32Array(n)
  for (let f = 0; f < n; f++) {
    let sum = 0
    for (let i = 0; i < frame; i++) { const v = samples[f * hop + i]; sum += v * v }
    out[f] = Math.sqrt(sum / frame)
  }
  return out
}

// 检测能量突发段（如「か、か、か。」的三个莫拉）。帧内允许 gapSec 内的小凹陷（浊音内部起伏），
// 段最短 minDurSec。返回 [{start, end}]（样本索引，闭开区间）。
export function findBursts(samples, sr, { minDurSec = 0.045, gapSec = 0.05, relThresh = 0.06 } = {}) {
  const rms = frameRms(samples)
  let maxRms = 0
  for (const v of rms) if (v > maxRms) maxRms = v
  const thr = maxRms * relThresh
  const hopSec = 128 / sr
  const gapFrames = Math.max(1, Math.round(gapSec / hopSec))
  const minFrames = Math.max(1, Math.round(minDurSec / hopSec))
  const raw = []
  let start = -1
  for (let f = 0; f <= rms.length; f++) {
    const on = f < rms.length && rms[f] >= thr
    if (on && start < 0) start = f
    if (!on && start >= 0) { raw.push([start, f]); start = -1 }
  }
  // 合并相邻段（间隔 ≤ gapFrames）
  const merged = []
  for (const seg of raw) {
    const last = merged[merged.length - 1]
    if (last && seg[0] - last[1] <= gapFrames) last[1] = seg[1]
    else merged.push([...seg])
  }
  return merged
    .filter(([a, b]) => b - a >= minFrames)
    .map(([a, b]) => ({ start: a * 128, end: Math.min(b * 128 + 256, samples.length) }))
}

// 取第 i 段并做 6ms 余弦淡入淡出（去咔哒声），两侧各多留 pad 样本。
export function extractBurst(samples, burst, i, sr) {
  const fade = Math.round(sr * 0.006)
  const headPad = Math.round(sr * 0.01)
  const tailPad = Math.round(sr * 0.02)
  const b = burst[i]
  const a0 = Math.max(0, b.start - headPad)
  const a1 = Math.min(samples.length, b.end + tailPad)
  const out = samples.slice(a0, a1)
  for (let k = 0; k < fade && k < out.length; k++) {
    const g = 0.5 - 0.5 * Math.cos((Math.PI * k) / fade)
    out[k] *= g
    out[out.length - 1 - k] *= g
  }
  return out
}

// 有声性指标：过零率（低=元音）与归一化自相关峰值（高=周期性元音）。
export function voicedStats(samples, sr) {
  const n = samples.length
  let mean = 0
  for (let i = 0; i < n; i++) mean += samples[i]
  mean /= n
  const x = new Float32Array(n)
  for (let i = 0; i < n; i++) x[i] = samples[i] - mean
  let zc = 0
  for (let i = 1; i < n; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) zc++
  const zcr = zc / n
  let e0 = 0
  for (let i = 0; i < n; i++) e0 += x[i] * x[i]
  let per = 0
  for (let lag = Math.round(sr / 400); lag <= Math.round(sr / 80); lag++) {
    let r = 0, e1 = 0, e2 = 0
    for (let i = 0; i + lag < n; i++) { r += x[i] * x[i + lag]; e1 += x[i] * x[i]; e2 += x[i + lag] * x[i + lag] }
    const norm = r / Math.sqrt(Math.max(e1 * e2, 1e-12))
    if (norm > per) per = norm
  }
  return { zcr: Math.round(zcr * 1000) / 1000, per: Math.round(per * 100) / 100 }
}

export function peakOf(samples) {
  let p = 0
  for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]); if (a > p) p = a }
  return p
}
