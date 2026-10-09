import { defineConfig } from 'vitepress'
import { cjkTokenize } from './search-tokenizer.mjs'
import { searchPageRender } from './search-render.mjs'

// base 必须与最终托管 URL 一致。
// 当前为 '/'：对应 Cloudflare Pages 的域名根路径托管（如 *.pages.dev 或自定义域）。
// 若改为仓库子路径托管，需同步改回如 '/japanese-grammar/'。
export default defineConfig({
  lang: 'zh-CN',
  title: '日语语法知识库',
  description: '由学习群共同维护的日语语法参考：可检索、可筛选、可练习。',
  base: '/',

  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '语法索引', link: '/grammar-index' },
      { text: '专题', link: '/topics/' },
      { text: '编写指南', link: '/contribute/writing-guide' },
      { text: '出题指南', link: '/contribute/quiz-guide' },
      { text: '审核指南', link: '/contribute/review-guide' },
    ],
    sidebar: {
      '/topics/': [
        {
          text: '专题',
          items: [
            { text: '专题总览', link: '/topics/' },
            { text: '条件表达：と・ば・たら・なら', link: '/topics/conditionals' },
            { text: '决定、努力与变化', link: '/topics/decision-and-intention' },
          ],
        },
      ],
      '/contribute/': [
        {
          text: '参与贡献',
          items: [
            { text: '语法条目编写指南', link: '/contribute/writing-guide' },
            { text: '练习题编写指南', link: '/contribute/quiz-guide' },
            { text: '内容审核指南', link: '/contribute/review-guide' },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/mloluyu/japanese-grammar' },
    ],
    search: {
      provider: 'local',
      options: {
        // 索引文本提取：默认 Markdown 渲染之外，把语法条目的例句 JSON 纳入索引。
        _render: searchPageRender,
        miniSearch: {
          // CJK 二元分词：构建端建索引与客户端查询共用同一分词器。
          // 实现见 ./search-tokenizer.mjs；验收脚本 scripts/verify-search.mjs。
          options: {
            tokenize: cjkTokenize,
          },
        },
      },
    },
    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',
  },
})
