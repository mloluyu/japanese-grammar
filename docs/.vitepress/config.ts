import { defineConfig } from 'vitepress'
import { cjkTokenize } from './search-tokenizer.mjs'
import { searchPageRender } from './search-render.mjs'

const year = new Date().getFullYear()
// base 必须与最终托管 URL 一致。
// 当前为 '/'：对应 Cloudflare Pages 的域名根路径托管（如 *.pages.dev 或自定义域）。
// 若改为仓库子路径托管，需同步改回如 '/japanese-grammar/'。
export default defineConfig({
  lang: 'zh-CN',
  title: '日语知识文档库',
  description: '由学习群共同维护的日语知识参考：可检索、可筛选、可练习。',
  base: '/',

  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '语法索引', link: '/grammar-index' },
      { text: '语言知识', link: '/reference/' },
      { text: '五十音', link: '/kana/' },
      { text: '新手入门', link: '/start/' },
      {
        text: '关于',
        items: [
          { text: '问题反馈与贡献指南', link: '/contribute/' },
          { text: '关于本站', link: '/team/' },
          { text: '友情链接', link: '/links/' },
        ],
      },
    ],
    sidebar: {
      '/start/': [
        {
          text: '新手入门',
          items: [
            { text: '总览与学习路线', link: '/start/' },
            { text: '教材怎么选', link: '/start/textbooks' },
            { text: '网课与视频资源', link: '/start/courses' },
            { text: 'APP 推荐', link: '/start/apps' },
            { text: '高频问答', link: '/start/faq' },
          ],
        },
      ],
      '/reference/': [
        {
          text: '',
          items: [
            { text: '总览', link: '/reference/' },
          ],
        },
        {
          text: '语言知识',
          items: [
            { text: '自动词与他动词', link: '/reference/jidoushi-tadoushi' },
          ],
        },
        {
          text: '对比与辨析',
          items: [
            { text: '条件表达：と・ば・たら・なら', link: '/reference/conditionals' },
            { text: '决定、努力与变化', link: '/reference/decision-and-intention' },
          ],
        },
      ],
      '/contribute/': [
        {
          text: '参与贡献',
          items: [
            { text: '贡献总览', link: '/contribute/' },
            { text: '语法条目编写指南', link: '/contribute/writing-guide' },
            { text: '语言知识编写指南', link: '/contribute/reference-guide' },
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
    editLink: {
      // 条目页底部的「在 GitHub 上编辑此页」。:path 相对 srcDir（docs/），
      // 因此 pattern 需带 docs/ 前缀指向仓库里的真实文件。
      pattern: 'https://github.com/mloluyu/japanese-grammar/edit/main/docs/:path',
      text: '在 GitHub 上编辑此页',
    },
    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',
    footer: {
      message: `©${year > 2026 ? `2026-${year}` : 2026} <a href="/team/">本站维护组</a> · <a href="/contribute/#侵权投诉">侵权投诉</a> · <a href="/links/">友情链接</a>`,
      copyright: '除<a href="/team/">音频</a>外，采用<a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank">CC BY-NC-SA 4.0</a>协议',
    }
  },
})
