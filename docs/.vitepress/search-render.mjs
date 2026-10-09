// 本地搜索的页面文本提取（themeConfig.search.options._render）。
//
// 背景：VitePress 构建搜索索引时用 markdown-it 渲染 Markdown 源码，不会执行
// Vue 组件，因此写在 docs/grammar/{id}.json 里的结构化例句进不了索引。
// 这里在默认渲染之后，为语法条目页追加同目录 JSON 的例句文本（仅进入索引，
// 页面显示不受影响；搜索详情视图里能看到命中例句片段）。
//
// 注意：此函数只在构建端执行；经 _vp-fn_ 序列化随站点数据下发到客户端后
// 不会被调用。
import { readFile } from 'node:fs/promises'

/**
 * @param {string} mdSrc 处理过 include 的 Markdown 源码
 * @param {{ path: string, relativePath: string, frontmatter?: Record<string, unknown> }} env
 * @param {import('markdown-it')} md
 * @returns {Promise<string>} 用于索引的 HTML 文本
 */
export async function searchPageRender(mdSrc, env, md) {
  let html = md.render(mdSrc, env)
  const frontmatter = env.frontmatter
  if (!frontmatter || frontmatter.search === false) return ''
  // 正文中的组件标签会被当作文本噪声，清掉。
  html = html.replace(/<ExampleSentences\s*\/?>/g, '')
  const id = typeof frontmatter.id === 'string' ? frontmatter.id : ''
  if (!id) return html

  const jsonPath = env.path.replace(/\.md$/, '.json')
  try {
    const parsed = JSON.parse(await readFile(jsonPath, 'utf8'))
    if (!parsed || parsed.grammarId !== id || !Array.isArray(parsed.examples)) return html
    const parts = []
    for (const ex of parsed.examples) {
      if (typeof ex?.text === 'string' && ex.text) parts.push(ex.text)
      if (typeof ex?.translation === 'string' && ex.translation) parts.push(ex.translation)
      if (Array.isArray(ex?.furigana)) {
        for (const part of ex.furigana) {
          if (typeof part?.reading === 'string' && part.reading) parts.push(part.reading)
        }
      }
    }
    const lines = parts.join(' ')
    return lines ? `${html}<div>${lines}</div>` : html
  } catch {
    return html
  }
}
