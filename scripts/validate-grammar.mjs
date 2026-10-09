#!/usr/bin/env node
// 语法条目 Frontmatter 与例句 JSON 校验。
// 字段规范：project-docs/CONTENT_SCHEMA.md；验收用例：project-docs/TESTING.md「数据校验测试」。
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import matter from 'gray-matter'

const GRAMMAR_DIR = path.resolve('docs/grammar')
const CATEGORIES_FILE = path.resolve('docs/.vitepress/categories.json')
const JLPT = new Set(['N5', 'N4', 'N3', 'N2', 'N1'])
const STATUS = new Set(['draft', 'reviewed', 'needs-correction'])
const REQUIRED = ['id', 'title', 'jlpt', 'category', 'tags', 'related', 'status']
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

async function walk(dir, ext) {
  const out = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full, ext)))
    else if (entry.isFile() && entry.name.endsWith(ext)) out.push(full)
  }
  return out
}

// 分类注册表：category 必须在注册表中定义（见 CONTENT_SCHEMA.md 第 2 节）。
let categories
try {
  categories = JSON.parse(await readFile(CATEGORIES_FILE, 'utf8'))
} catch (err) {
  console.error(`validate-grammar: 无法读取分类注册表 ${path.relative(process.cwd(), CATEGORIES_FILE)}（${err.message}）`)
  process.exit(1)
}

const files = await walk(GRAMMAR_DIR, '.md')
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
  if (data.category !== undefined && !Object.hasOwn(categories, data.category)) {
    errors.push(`${rel}: 未注册的 category：${JSON.stringify(data.category)}（注册表：docs/.vitepress/categories.json）`)
  }
  if (data.status !== undefined && !STATUS.has(data.status)) {
    errors.push(`${rel}: status 必须是 draft / reviewed / needs-correction 之一`)
  }
  for (const key of ['tags', 'related', 'forms']) {
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

// 例句 JSON：docs/grammar/{语法ID}.json（规范见 CONTENT_SCHEMA.md 第 5 节）。
const exampleFiles = (await walk(GRAMMAR_DIR, '.json')).filter((f) => path.basename(f) !== 'categories.json')
const exampleIds = new Set()
let exampleCount = 0
for (const file of exampleFiles) {
  const rel = path.relative(process.cwd(), file)
  const stem = path.basename(file, '.json')
  let obj
  try {
    obj = JSON.parse(await readFile(file, 'utf8'))
  } catch (err) {
    errors.push(`${rel}: JSON 解析失败（${err.message}）`)
    continue
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    errors.push(`${rel}: 顶层应为对象（grammarId + examples）`)
    continue
  }
  if (obj.grammarId !== stem) {
    errors.push(`${rel}: grammarId（${JSON.stringify(obj.grammarId)}）应与文件名 ${stem} 一致`)
  }
  if (typeof obj.grammarId === 'string' && !idToRel.has(obj.grammarId)) {
    errors.push(`${rel}: 对应的语法条目不存在：${obj.grammarId}`)
  }
  if (!Array.isArray(obj.examples)) {
    errors.push(`${rel}: 缺少 examples 数组`)
    continue
  }
  for (const ex of obj.examples) {
    exampleCount++
    const label = `${rel}#${ex?.id ?? '(无 id)'}`
    if (typeof ex?.id !== 'string' || ex.id.length === 0) {
      errors.push(`${label}: 每条例句需要非空字符串 id`)
    } else if (exampleIds.has(ex.id)) {
      errors.push(`${label}: 例句 id 在全项目内重复`)
    } else {
      exampleIds.add(ex.id)
    }
    if (typeof ex?.text !== 'string' || ex.text.trim().length === 0) {
      errors.push(`${label}: text 不能为空`)
    }
    if (typeof ex?.translation !== 'string' || ex.translation.trim().length === 0) {
      errors.push(`${label}: translation 不能为空`)
    }
    if (ex?.furigana !== undefined) {
      if (!Array.isArray(ex.furigana) || !ex.furigana.every((f) => typeof f?.text === 'string' && typeof f?.reading === 'string')) {
        errors.push(`${label}: furigana 必须是 { text, reading } 字符串对的数组`)
      } else if (typeof ex.text === 'string') {
        for (const f of ex.furigana) {
          if (!ex.text.includes(f.text)) {
            errors.push(`${label}: furigana 的 text「${f.text}」未出现在例句原文中`)
          }
        }
      }
    }
    if (ex?.audio !== undefined && ex.audio !== null && typeof ex.audio !== 'string') {
      errors.push(`${label}: audio 应为字符串或 null`)
    }
  }
}

if (errors.length > 0) {
  console.error(`validate-grammar: 发现 ${errors.length} 个问题：`)
  for (const message of errors) console.error(`  - ${message}`)
  process.exit(1)
}
console.log(`validate-grammar: ${entries.length} 个条目、${exampleFiles.length} 个例句文件（${exampleCount} 句）校验通过。`)
