#!/usr/bin/env node
// 练习题 JSON 校验。
// 字段规范：project-docs/CONTENT_SCHEMA.md 第 4 节；出题质量：docs/contribute/quiz-guide.md。
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import matter from 'gray-matter'

const QUIZ_DIR = path.resolve('docs/quizzes')
const GRAMMAR_DIR = path.resolve('docs/grammar')

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

// 收集现有语法 ID，用于 grammarIds 引用完整性检查。
async function collectGrammarIds() {
  const ids = new Set()
  for (const file of await walk(GRAMMAR_DIR, '.md')) {
    try {
      const { data } = matter(await readFile(file, 'utf8'))
      if (typeof data.id === 'string') ids.add(data.id)
    } catch {
      // 语法文件自身的问题由 validate-grammar.mjs 报告。
    }
  }
  return ids
}

const grammarIds = await collectGrammarIds()
const quizFiles = await walk(QUIZ_DIR, '.json')
if (quizFiles.length === 0) {
  console.log('validate-quiz: docs/quizzes 下暂无题库，跳过校验。')
  process.exit(0)
}

const errors = []
const bankIds = new Set()
const questionIds = new Set()

for (const file of quizFiles) {
  const rel = path.relative(process.cwd(), file)
  let bank
  try {
    bank = JSON.parse(await readFile(file, 'utf8'))
  } catch (err) {
    errors.push(`${rel}: JSON 解析失败（${err.message}）`)
    continue
  }
  if (typeof bank.id !== 'string' || bank.id.length === 0) {
    errors.push(`${rel}: 题库缺少非空字符串 id`)
  } else if (bankIds.has(bank.id)) {
    errors.push(`${rel}: 题库 id 重复：${bank.id}`)
  } else {
    bankIds.add(bank.id)
  }
  if (!Array.isArray(bank.questions)) {
    errors.push(`${rel}: 缺少 questions 数组`)
    continue
  }

  for (const q of bank.questions) {
    const label = `${rel}#${q.id ?? '(无 id)'}`
    if (typeof q.id !== 'string' || q.id.length === 0) {
      errors.push(`${label}: 每道题需要非空字符串 id`)
    } else if (questionIds.has(q.id)) {
      errors.push(`${label}: 题目 id 在全项目内重复`)
    } else {
      questionIds.add(q.id)
    }
    if (q.type !== 'single-choice') {
      errors.push(`${label}: type 当前仅允许 single-choice`)
    }
    if (!Array.isArray(q.options) || q.options.length < 2 || !q.options.every((o) => typeof o === 'string')) {
      errors.push(`${label}: options 必须是至少两项的字符串数组`)
    }
    if (!Number.isInteger(q.answer) || !Array.isArray(q.options) || q.answer < 0 || q.answer >= q.options.length) {
      errors.push(`${label}: answer 必须是有效的选项索引`)
    }
    if (typeof q.explanation !== 'string' || q.explanation.trim().length === 0) {
      errors.push(`${label}: explanation 不能为空`)
    }
    if (!Array.isArray(q.grammarIds)) {
      errors.push(`${label}: 缺少 grammarIds 数组`)
    } else {
      for (const gid of q.grammarIds) {
        if (!grammarIds.has(gid)) {
          errors.push(`${label}: grammarIds 引用的语法 ID 不存在：${gid}`)
        }
      }
    }
    if (q.difficulty !== undefined && (!Number.isInteger(q.difficulty) || q.difficulty < 1 || q.difficulty > 3)) {
      errors.push(`${label}: difficulty 建议使用 1–3 的整数`)
    }
  }
}

if (errors.length > 0) {
  console.error(`validate-quiz: 发现 ${errors.length} 个问题：`)
  for (const message of errors) console.error(`  - ${message}`)
  process.exit(1)
}
console.log(`validate-quiz: ${quizFiles.length} 个题库、${questionIds.size} 道题校验通过。`)
