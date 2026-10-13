import { createContentLoader } from 'vitepress'

// 语法索引数据：构建时从 docs/grammar/*.md 的 Frontmatter 生成，
// 供「语法索引」页筛选与各语法页的「相关语法」列表共用。
// 字段规范见 project-docs/CONTENT_SCHEMA.md；不要手工维护此文件的数据。

export interface GrammarEntry {
  id: string
  title: string
  summary: string // 中文一句话简介（索引卡片副标题）
  reading: string
  jlpt: string
  category: string
  tags: string[]
  url: string // 根相对路径（不含 base），展示时用 withBase()
}

declare const data: GrammarEntry[]
export { data }

export default createContentLoader('grammar/*.md', {
  transform(raw) {
    return raw
      .map(({ url, frontmatter }) => ({
        id: String(frontmatter.id ?? ''),
        title: String(frontmatter.title ?? ''),
        summary: String(frontmatter.summary ?? ''),
        reading: String(frontmatter.reading ?? ''),
        jlpt: String(frontmatter.jlpt ?? ''),
        category: String(frontmatter.category ?? ''),
        tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : [],
        url,
      }))
      .sort((a, b) => a.title.localeCompare(b.title, 'ja'))
  },
})
