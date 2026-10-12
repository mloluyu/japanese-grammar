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
          ▼ deploy（推送 main 自动发布）
      Cloudflare Pages
          │
          ▼ browser
  search / filters / quiz
```

## 3. 技术职责

- **VitePress**：路由、Markdown 渲染、主题布局、本地搜索、静态构建。
- **Vue 3**：筛选控件、答题交互、假名开关；例句组件为日语句输出 `lang="ja"`；中文释义依赖站点根 `lang="zh-CN"` 继承，不重复标注。
- **TypeScript**：交互逻辑、索引结构与题目数据的类型约束。
- **Markdown + YAML Frontmatter**：语法说明及可筛选元数据。
- **JSON**：题库和需要结构化处理的例句数据。
- **Node.js 校验脚本**：校验 ID、枚举、引用、答案索引与必要字段。
- **GitHub Actions**：仅在 PR 时运行数据校验与构建检查；直接推送 main 不触发远程构建。
- **Cloudflare Pages**：静态托管（已配置，推送 main 自动发布）。

## 4. 内容处理流程

1. 贡献者编辑 Markdown 或 JSON。
2. PR 检查解析 Frontmatter 和 JSON。
3. 校验脚本检查必填字段、枚举值、重复 ID、引用完整性。
4. VitePress 构建静态页面。
5. 构建成功后由维护者合并。
6. 合并到 main 后由 Cloudflare Pages 自动构建发布；GitHub Actions 不参与部署。

索引由 VitePress 数据加载器（createContentLoader）在构建时从语法条目生成：`docs/grammar-index.data.ts` 输出精简后的条目列表（ID、标题、读音、等级、分类、标签、URL），供索引页筛选与「相关语法」组件共用，无需手工维护。

## 5. 建议目录

```text
.github/
  ISSUE_TEMPLATE/        # 6 个 issue 表单 + config.yml（空白 issue 关闭）
  workflows/ci.yml       # 仅 pull_request：check + build
docs/
  .vitepress/
    config.ts            # 站点配置：nav/sidebar/search(_render + CJK 分词)/editLink/footer
    categories.json      # 分类注册表（校验器强制）
    search-tokenizer.mjs # CJK 二元分词（构建端与客户端共用）
    search-render.mjs    # 搜索索引文本提取（例句注入）
    theme/               # Layout + 组件注册
    components/          # GrammarIndex / RelatedGrammar / ExampleSentences / PracticeQuiz
  grammar/               # 语法条目 .md 平铺
  kana/                  # 五十音速查页
  grammar-index.data.ts  # 索引页数据加载器（createContentLoader）
  examples.data.ts       # 例句聚合数据加载器
  quizzes.data.ts        # 题库聚合数据加载器
  index.md  grammar-index.md  team/  links/
  reference/ contribute/   # 语言知识与贡献文档（reference 含 index 总览页）
  public/audio/          # 生成例句音频（按 voiceId/条目ID/ 分目录）＋ kana/ 假名定稿音频；仅站内收听
content/                 # 内容数据（在 docs 之外，构建时由加载器与校验器读取）
  grammar/               # 例句 JSON，与条目同名
  quizzes/               # 题库 JSON
  audio-manifest.json    # 音频溯源台账（脚本维护，前端不读取）
project-docs/            # 项目管理文档，不构建进公开站点
scripts/
  validate-grammar.mjs  validate-quiz.mjs  verify-search.mjs
README.md  CONTRIBUTING.md  LICENSE  LICENSE.content
```

`public/` 在 VitePress 项目中应位于站点根目录 `docs/public/`，构建后资源路径由站点 base 路径决定。仓库路径部署时必须正确设置 VitePress 的 `base`。

## 6. 路由与页面

建议页面：
- `/`：首页与快速入口。
- `/grammar-index`：语法总索引与筛选。
- `/grammar/<id>`：单条语法（如 `/grammar/koto-ni-naru`）。
- `/reference/`：语言知识区（语法术语／对比与辨析，无固定格式、不强制例句），导航为普通链接指向总览页；总览为自动列表（`docs/reference-index.data.ts` 扫描 `reference/*.md`，新增页面零维护），页面需在 `config.ts` 侧边栏登记。现有页面 `/reference/jidoushi-tadoushi`、`/reference/conditionals`、`/reference/decision-and-intention`。原 `/topics/` 专题区已并入。
- `/contribute/`：贡献总览；四份指南（语法条目／语言知识／练习题／内容审核）在其下。
- `/team/`：维护团队。
- `/links/`：友情链接（卡片数据 `theme/data/friend-links.json`，加链接只改 JSON；无申请模板，下架经 Issue 反馈）。

页面路径以实际文件结构为准；修改路径时要更新内部链接和相关语法引用。

## 7. 搜索与筛选的边界

- VitePress 本地搜索处理全文关键词检索；已配置 CJK 二元分词（docs/.vitepress/search-tokenizer.mjs），构建端与客户端共用同一分词器，假名与汉字连续段做重叠二元切分。
- 分词效果由 scripts/verify-search.mjs 用真实语料（含例句 JSON）验证并并入 `npm run check` 门禁；默认空白分词下句中片段查询不可命中，为已知结论。
- 例句渲染与索引分开处理：页面由 `ExampleSentences` 组件渲染（`<ruby><rt>`、假名切换、音频位、`lang="ja"`）；搜索索引基于 Markdown 源渲染、不执行组件，因此通过 `themeConfig.search.options._render`（docs/.vitepress/search-render.mjs）把例句文本、中文释义与注音读音显式注入索引提取。
- 自定义索引处理 JLPT、标签、分类等结构化筛选。
- 第一版不引入外部搜索 SaaS。
- 如果未来需要日语形态分析、罗马字搜索或同义词扩展，应先建立真实查询样本和验收集，再决定是否引入额外索引库。

## 8. 本地状态

站点不使用 `localStorage` 或其他本地持久化保存学习数据；练习等交互状态仅在当前页面会话内有效（见 ADR-0004）。

## 9. 安全与隐私

- MVP 不需要密钥或私有 API。
- 不在仓库或浏览器端存储个人学习数据。
- Markdown 中的 HTML/组件应遵循 VitePress 安全配置；贡献内容需审核。
- 不将未经审核的 PR 产物部署到正式站点。
- 练习答案是静态数据，不能保证保密。
