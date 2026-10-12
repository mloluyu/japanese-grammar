#!/usr/bin/env node
// 锁定人耳挑选的 take：把 tools/take-probe/pick-<label>.mp3 放上生产路径并写 manifest
// fingerprint 与 generate-audio.mjs 完全同构（engine+model+params+encode），以后重跑不会被判定过期
// 用法: node tools/lock-take.mjs <a|b|c|d> <exampleId>
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1) }
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const [label, exampleId] = process.argv.slice(2)
if (!label || !exampleId) die('用法: node tools/lock-take.mjs <a|b|c|d> <exampleId>')
const cfg = JSON.parse(await fs.readFile(path.join(ROOT, 'scripts/audio.config.json'), 'utf8'))
const voiceId = 'tsukuyomi-v1'
const voice = cfg.voices[voiceId]
const src = path.join(ROOT, `tools/take-probe/pick-${label}.mp3`)
if (!fs.existsSync?.call(await fs, src)) await fs.access(src).catch(() => die(`找不到 ${path.relative(ROOT, src)}（先跑 tools/take-pick.mjs 生成候选）`))
const manifestPath = path.join(ROOT, cfg.manifestFile)
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
const prev = manifest.items[`${voiceId}/${exampleId}`]
const grammarId = prev?.grammarId
if (!grammarId) die(`manifest 里找不到 ${voiceId}/${exampleId}，无法确定条目目录`)
const rel = `${cfg.audioUrlPrefix}/${voiceId}/${grammarId}/${exampleId}.mp3`
const dest = path.join(ROOT, cfg.outputDir, voiceId, grammarId, `${exampleId}.mp3`)
await fs.mkdir(path.dirname(dest), { recursive: true })
const mp3 = await fs.readFile(src)
await fs.writeFile(dest, mp3)
const onnxSha = sha256(await fs.readFile(path.join(ROOT, cfg.modelCacheDir, voiceId, voice.model.onnx)))
const fp = sha256(JSON.stringify({ engine: cfg.engine, model: voice.model, params: voice.params, encode: cfg.encode }))
manifest.items[`${voiceId}/${exampleId}`] = {
  ...(prev ?? {}),
  path: rel,
  exampleId, grammarId, voice: voiceId,
  textSource: prev?.textSource ?? 'text',
  textSha256: prev?.textSha256 ?? sha256(Buffer.from(exampleId, 'utf8')),
  audioSha256: sha256(mp3),
  bytes: mp3.length,
  sampleRate: prev?.sampleRate ?? 22050,
  fingerprint: fp,
  modelOnnxSha256: onnxSha,
  engine: { package: cfg.engine.npmPackage, version: cfg.engine.npmVersion },
  model: { repo: voice.model.repo, onnx: voice.model.onnx },
  params: voice.params,
  license: voice.license,
  generatedAt: new Date().toISOString(),
}
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 1) + '\n')
console.log(`✓ 已锁定 take ${label} → ${rel}（${(mp3.length / 1024).toFixed(1)}KB, fingerprint ${fp.slice(0, 12)}…）`)
