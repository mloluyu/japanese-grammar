#!/usr/bin/env node
// M3 验收：验证本地搜索的 CJK 分词对真实日语内容有效。
// 对比 MiniSearch 默认分词与 docs/.vitepress/search-tokenizer.mjs 的二元分词，
// 自定义分词必须让所有测试查询命中，否则以非零码退出。
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import MiniSearch from 'minisearch'
import { cjkTokenize } from '../docs/.vitepress/search-tokenizer.mjs'

const DOCS_DIR = path.resolve('docs')
const CONTENT_DIR = path.resolve('content')

// 与 VitePress 构建端一致的字段与查询配置（fuzzy/prefix 保持默认主题设置）。
const FIELDS = ['title', 'titles', 'text']
const SEARCH_OPTIONS = { fuzzy: 0.2, prefix: true, boost: { title: 4, text: 2, titles: 1 } }

// 测试查询：覆盖标题命中、句中片段、长音/促音等不同情况。
// 语料与真实索引一致：M5 起搜索索引经 docs/.vitepress/search-render.mjs
// 把例句文本、释义与读音注入提取，因此这里的 md + 例句 JSON 组合即真实索引内容。
const QUERIES = [
  { q: 'ことになる', expect: '标题与正文（基线，默认分词也应命中）' },
  { q: '結婚する', expect: 'koto-ni-naru 例句片段' },
  { q: '予約しましょう', expect: 'mashou 例句片段' },
  { q: 'することになる', expect: '句中片段（默认分词的盲区）' },
  { q: 'おすすめ', expect: 'nara 例句片段' },
  { q: '的中止', expect: 'tara 例句中间片段' },
]

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '.vitepress' || entry.name === 'public' || entry.name === 'data') continue
      out.push(...(await walk(full)))
    } else if (entry.name.endsWith('.md') || entry.name.endsWith('.json')) {
      out.push(full)
    }
  }
  return out
}

// 粗粒度 Markdown 转纯文本：去 frontmatter/代码块/行内标记，保留日文正文。
function toPlainText(md) {
  return md
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~|-]+/g, ' ')
    .replace(/<[^>]+>/g, ' ')
}

// 语料 = docs 下的 Markdown + content/grammar 下的例句 JSON（与真实索引来源一致）。
const files = [...(await walk(DOCS_DIR)), ...(await walk(CONTENT_DIR))]
const documents = []
for (const file of files) {
  const raw = await readFile(file, 'utf8')
  if (file.endsWith('.json')) {
    // 例句文件：text 取日文原句 + 中文释义（M5 渲染后两者都会出现在页面上）。
    const json = JSON.parse(raw)
    const text = (json.examples ?? []).map((ex) => `${ex.text ?? ''} ${ex.translation ?? ''}`).join(' ')
    documents.push({ id: path.relative(CONTENT_DIR, file), title: `例句：${json.grammarId ?? path.basename(file, '.json')}`, titles: [], text })
    continue
  }
  const text = toPlainText(raw)
  const titleMatch = raw.match(/^# (.+)$/m)
  documents.push({
    id: path.relative(DOCS_DIR, file),
    title: titleMatch ? titleMatch[1] : path.basename(file, '.md'),
    titles: [],
    text,
  })
}

function searchWith(tokenize, query) {
  const index = new MiniSearch({ fields: FIELDS, storeFields: FIELDS, ...(tokenize ? { tokenize } : {}) })
  index.addAll(documents)
  return index.search(query, SEARCH_OPTIONS)
}

console.log(`verify-search: 语料 ${documents.length} 个文件（Markdown＋例句 JSON），${QUERIES.length} 个查询。\n`)
let failures = 0
const header = ['查询', '期望', '默认分词', 'CJK 二元分词']
const rows = QUERIES.map(({ q, expect }) => {
  const def = searchWith(null, q).length
  const cjk = searchWith(cjkTokenize, q).length
  if (cjk === 0) failures++
  return [`「${q}」`, expect, def > 0 ? `${def} 条命中` : '未命中', cjk > 0 ? `${cjk} 条命中` : '未命中 ✗']
})
const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))
const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ')
console.log(line(header))
console.log(widths.map((w) => '-'.repeat(w)).join('  '))
for (const row of rows) console.log(line(row))
console.log('')

if (failures > 0) {
  console.error(`verify-search: ${failures} 个查询在 CJK 二元分词下仍未命中。`)
  process.exit(1)
}
console.log('verify-search: 所有查询在 CJK 二元分词下均命中。')
