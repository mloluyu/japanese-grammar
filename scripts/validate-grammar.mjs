#!/usr/bin/env node
// 语法条目 Frontmatter 校验。
// 字段规范：docs/CONTENT_SCHEMA.md；验收用例：docs/TESTING.md「数据校验测试」。
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import matter from 'gray-matter'

const GRAMMAR_DIR = path.resolve('docs/grammar')
const JLPT = new Set(['N5', 'N4', 'N3', 'N2', 'N1'])
const STATUS = new Set(['draft', 'reviewed', 'needs-correction'])
const REQUIRED = ['id', 'title', 'jlpt', 'category', 'tags', 'related', 'status']
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

async function walkMarkdown(dir) {
  const out = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walkMarkdown(full)))
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full)
  }
  return out
}

const files = await walkMarkdown(GRAMMAR_DIR)
if (files.length === 0) {
  console.log('validate-grammar: docs/grammar 下暂无条目，跳过校验。')
  process.exit(0)
}

const errors = []
const entries = []

for (const file of files) {
  const rel = path.relative(process.cwd(), file)
  const base = path.basename(file, '.md')
  if (!ID_RE.test(base)) {
    errors.push(`${rel}: 文件名应只使用小写英文、数字和连字符`)
  }

  let data
  try {
    data = matter(await readFile(file, 'utf8')).data
  } catch (err) {
    errors.push(`${rel}: Frontmatter 解析失败（${err.message}）`)
    continue
  }
  entries.push({ rel, data })

  for (const key of REQUIRED) {
    if (data[key] === undefined) errors.push(`${rel}: 缺少必填字段 ${key}`)
  }
  if (data.id !== undefined) {
    if (typeof data.id !== 'string' || !ID_RE.test(data.id)) {
      errors.push(`${rel}: id 非法，应为小写英文/数字/连字符，且不要把等级或目录层级写进 ID`)
    }
  }
  if (data.jlpt !== undefined && !JLPT.has(data.jlpt)) {
    errors.push(`${rel}: jlpt 必须是 N5–N1 之一，当前为 ${JSON.stringify(data.jlpt)}`)
  }
  if (data.status !== undefined && !STATUS.has(data.status)) {
    errors.push(`${rel}: status 必须是 draft / reviewed / needs-correction 之一`)
  }
  for (const key of ['tags', 'related']) {
    if (data[key] !== undefined && !(Array.isArray(data[key]) && data[key].every((v) => typeof v === 'string'))) {
      errors.push(`${rel}: ${key} 必须是字符串数组（可为空数组）`)
    }
  }
  if (Array.isArray(data.tags)) {
    const levelTags = data.tags.filter((t) => JLPT.has(t))
    if (levelTags.length > 0) {
      errors.push(`${rel}: tags 中不应写入 JLPT 等级标签（${levelTags.join('、')}）；等级只由 jlpt 字段维护`)
    }
  }
}

const idToRel = new Map()
for (const { rel, data } of entries) {
  if (typeof data.id === 'string' && ID_RE.test(data.id)) {
    if (idToRel.has(data.id)) {
      errors.push(`${rel}: 语法 ID 重复：${data.id}（已用于 ${idToRel.get(data.id)}）`)
    } else {
      idToRel.set(data.id, rel)
    }
  }
}
for (const { rel, data } of entries) {
  if (Array.isArray(data.related)) {
    for (const rid of data.related) {
      if (!idToRel.has(rid)) {
        errors.push(`${rel}: related 引用的语法 ID 不存在：${rid}`)
      }
    }
  }
}

if (errors.length > 0) {
  console.error(`validate-grammar: 发现 ${errors.length} 个问题：`)
  for (const message of errors) console.error(`  - ${message}`)
  process.exit(1)
}
console.log(`validate-grammar: ${entries.length} 个条目校验通过。`)
