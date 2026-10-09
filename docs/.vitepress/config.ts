import { defineConfig } from 'vitepress'

// 仓库子路径部署：base 必须与 GitHub Pages 实际 URL 一致（见 docs/DEVELOPMENT.md）。
// 若仓库名或部署方式变更，同步修改此处。
export default defineConfig({
  lang: 'zh-CN',
  title: '日语语法知识库',
  description: '由学习群共同维护的日语语法参考：可检索、可筛选、可练习。',
  base: '/japanese-grammar/',

  // 项目管理类文档（PRD、ADR 等）只保留在仓库中供维护者阅读，
  // 不构建进公开的学习站点。
  srcExclude: [
    '**/PRD.md',
    '**/ARCHITECTURE.md',
    '**/CONTENT_SCHEMA.md',
    '**/DEVELOPMENT.md',
    '**/TESTING.md',
    '**/ROADMAP.md',
    'adr/**',
  ],

  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '编写指南', link: '/contribute/writing-guide' },
      { text: '出题指南', link: '/contribute/quiz-guide' },
      { text: '审核指南', link: '/contribute/review-guide' },
    ],
    sidebar: {
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
      // TODO: 仓库公开后把 <OWNER> 替换为实际 GitHub 用户名或组织名。
      { icon: 'github', link: 'https://github.com/<OWNER>/japanese-grammar' },
    ],
    search: {
      provider: 'local',
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
