# 系统架构设计

- 状态：Draft
- 版本：0.1

## 1. 设计原则

1. 内容优先，程序不成为内容贡献的门槛。
2. 静态优先，不为当前需求引入后端。
3. 元数据结构化，正文保持 Markdown 灵活性。
4. 自动检查与人工审核并行。
5. 可渐进扩展，避免提前实现账户、同步或复杂搜索。

## 2. 组件概览

```text
GitHub repository
  ├─ Markdown grammar pages
  ├─ JSON quiz banks
  ├─ public audio assets
  └─ Vue / TypeScript components
          │
          ▼ CI: validate → build
      VitePress static output
          │
          ▼ deploy from main
      GitHub Pages/Cloudflare Pages
          │
          ▼ browser
  search / filters / quiz
```

## 3. 技术职责

- **VitePress**：路由、Markdown 渲染、主题布局、本地搜索、静态构建。
- **Vue 3**：筛选控件、答题交互、假名开关；例句组件为日语句输出 `lang="ja"`、中文释义输出 `lang="zh-CN"`。
- **TypeScript**：交互逻辑、索引结构与题目数据的类型约束。
- **Markdown + YAML Frontmatter**：语法说明及可筛选元数据。
- **JSON**：题库和需要结构化处理的例句数据。
- **Node.js 校验脚本**：校验 ID、枚举、引用、答案索引与必要字段。
- **GitHub Actions**：PR 检查和主分支部署。
- **Pages**：静态托管。

## 4. 内容处理流程

1. 贡献者编辑 Markdown 或 JSON。
2. PR 检查解析 Frontmatter 和 JSON。
3. 校验脚本检查必填字段、枚举值、重复 ID、引用完整性。
4. VitePress 构建静态页面。
5. 构建成功后由维护者合并。
6. main 分支工作流发布到 Pages。

索引文件应由脚本从语法文档生成，不应由人手工重复维护。若 VitePress 插件或构建钩子不适合直接实现索引生成，可使用独立 Node.js 脚本在构建前生成。

## 5. 建议目录

```text
.github/
  ISSUE_TEMPLATE/
  workflows/
docs/
  .vitepress/
    config.ts
    theme/
    components/
  grammar/               # 语法条目平铺，分类只作为 frontmatter 元数据
  quizzes/
  data/                 # 构建生成的数据
  topics/
  contribute/
  public/audio/
scripts/
  validate-grammar.mjs
  validate-quiz.mjs
  build-index.mjs
README.md
CONTRIBUTING.md
```

`public/` 在 VitePress 项目中应位于站点根目录 `docs/public/`，构建后资源路径由站点 base 路径决定。仓库路径部署时必须正确设置 VitePress 的 `base`。

## 6. 路由与页面

建议页面：
- `/`：项目首页、快速入口、最近更新。
- `/grammar-index`：语法总索引与筛选。
- `/grammar/koto-ni-naru`：单条语法。
- `/topics/particles`：专题页面。
- `/practice`：练习入口。
- `/contribute/writing-guide`：内容贡献说明。

页面路径以实际文件结构为准；修改路径时要更新内部链接和相关语法引用。

## 7. 搜索与筛选的边界

- VitePress 本地搜索处理全文关键词检索。
- 自定义索引处理 JLPT、标签、分类等结构化筛选。
- 第一版不引入外部搜索 SaaS。
- 已知风险：本地搜索（MiniSearch）默认按空白与标点切词，对无空格的日语正文，中间片段（如例句中的「留学する」）可能无法命中。进入 M3 前先用真实日语样本验证；不达标就在搜索配置中加入 CJK 二元分词（实现成本低，无需形态分析）。
- 如果未来需要日语形态分析、罗马字搜索或同义词扩展，应先建立真实查询样本和验收集，再决定是否引入额外索引库。

## 8. 本地状态

站点不使用 `localStorage` 或其他本地持久化保存学习数据；练习等交互状态仅在当前页面会话内有效（见 ADR-0004）。

## 9. 安全与隐私

- MVP 不需要密钥或私有 API。
- 不在仓库或浏览器端存储个人学习数据。
- Markdown 中的 HTML/组件应遵循 VitePress 安全配置；贡献内容需审核。
- 不将未经审核的 PR 产物部署到正式站点。
- 练习答案是静态数据，不能保证保密。

## 10. 部署环境

- 默认使用 GitHub Pages。
- 使用 Actions 构建并部署。
- 站点配置中的 `base` 必须与实际 URL 匹配。
- 依赖使用 lockfile 固定解析结果；CI 使用 `npm ci`。
- 具体 Actions 版本、Node 版本和 VitePress 版本在实现时按官方支持状态确认并锁定。
