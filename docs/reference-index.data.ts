import { createContentLoader } from 'vitepress'

// 语言知识总览的自动列表：扫描 reference/ 下全部页面（排除总览自身），
// 新增页面无需改本文件或总览页，只需放入 docs/reference/ 并在 config 侧边栏登记。
export default createContentLoader('reference/*.md', {
  transform(raw) {
    return raw
      .filter((p) => p.url !== '/reference/')
      .map(({ url, frontmatter }) => ({ url, title: String(frontmatter.title ?? url) }))
      .sort((a, b) => a.title.localeCompare(b.title, 'ja'))
  },
})
