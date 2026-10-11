#!/usr/bin/env node
// 锁定人耳挑选的 take：把 tools/take-probe/pick-<label>.mp3 放上生产路径并写 manifest
// fingerprint 与 generate-audio.mjs 完全同构（engine+model+params+encode），以后重跑不会被判定过期
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const [label, exampleId] = process.argv.slice(2)
if (!label || !exampleId) { console.error('用法: node tools/lock-take.mjs <a|b|c|d> <exampleId>'); process.exit(1) }
const cfg = JSON.parse(await fs.readFile(path.join(ROOT, 'scripts/audio.config.json'), 'utf8'))
const voiceId = 'tsukuyomi-v1'
const voice = cfg.voices[voiceId]
const src = path.join(ROOT, `tools/take-probe/pick-${label}.mp3`)
const dest = path.join(ROOT, cfg.outputDir, voiceId, `${exampleId}.mp3`)
await fs.mkdir(path.dirname(dest), { recursive: true })
const mp3 = await fs.readFile(src)
await fs.writeFile(dest, mp3)
const grammarId = 'jidoushi-tadoushi' // ex-jt-03 所在条目
const text = '電気が消える。' // ex-jt-03，reading 为 null → textSource 'text'
const manifestPath = path.join(ROOT, cfg.manifestFile)
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
const onnxSha = sha256(await fs.readFile(path.join(ROOT, cfg.modelCacheDir, voiceId, voice.model.onnx)))
const fp = sha256(JSON.stringify({ engine: cfg.engine, model: voice.model, params: voice.params, encode: cfg.encode }))
manifest.items[`${voiceId}/${exampleId}`] = {
  path: `${cfg.audioUrlPrefix}/${voiceId}/${exampleId}.mp3`,
  exampleId, grammarId, voice: voiceId,
  textSource: 'text',
  textSha256: sha256(Buffer.from(text, 'utf8')),
  audioSha256: sha256(mp3),
  bytes: mp3.length,
  sampleRate: 22050,
  fingerprint: fp,
  modelOnnxSha256: onnxSha,
  engine: { package: cfg.engine.npmPackage, version: cfg.engine.npmVersion },
  model: { repo: voice.model.repo, onnx: voice.model.onnx },
  params: voice.params,
  license: voice.license,
  generatedAt: new Date().toISOString(),
}
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
console.log(`✓ 已锁定 take ${label} → docs/public/audio/${voiceId}/${exampleId}.mp3（${(mp3.length / 1024).toFixed(1)}KB, fingerprint ${fp.slice(0, 12)}…）`)
