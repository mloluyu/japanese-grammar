# 日语语法知识库

> 开放共享的可检索、可练习的日语语法参考。

[在线阅览](https://hinata.mloluyu.uno) · [反馈问题](https://github.com/mloluyu/japanese-grammar/issues/new/choose) · [参与贡献](CONTRIBUTING.md)

## 这是什么

面向日语学习者的静态语法参考站点，以学习群为主要读者。内容以 Git 仓库为单一事实源，网站只读呈现，修订通过 Pull Request 进入审核流程。

- **结构化条目**——每篇语法一个 Markdown 文件，Frontmatter 统一维护 JLPT 等级、分类与标签；语法 ID 稳定且不含等级，等级调整不影响链接。
- **检索与筛选**——本地全文搜索针对日语做了二元分词，句中片段（如「予約しましょう」）与假名读音都能命中；[语法索引](docs/grammar-index.md)支持关键词、等级、分类、标签组合筛选。
- **例句与假名**——例句为结构化 JSON（假名标注、中文释义，音频位预留），页面一键切换假名显示。
- **条目内练习**——单选题内嵌每篇条目，即时反馈与解析；跨条目对比题会同时出现在相关条目上。
- **语言知识**——术语解释、数词等参考内容与跨条目对比，如[条件表达：と・ば・たら・なら](docs/reference/conditionals.md)。

## 当前状态

站点已部署于 Cloudflare Pages，并向群内管理员开放试用。里程碑进度与验收标准见 [project-docs/ROADMAP.md](project-docs/ROADMAP.md)。

## 本地开发

要求 Node.js 24+（仓库内 `.nvmrc` 固定 CI 版本）。

```bash
git clone https://github.com/mloluyu/japanese-grammar.git
cd japanese-grammar
npm ci
npm run docs:dev        # 本地预览
```

提交前完整验证：

```bash
npm run check           # 条目/例句/题库校验 + 搜索分词验证
npm run docs:build      # 完整构建
```

## 参与贡献

贡献流程、PR 要求与行为规范见 [CONTRIBUTING.md](CONTRIBUTING.md)；各环节分册指南：

- 新增或修订语法 → [语法条目编写指南](docs/contribute/writing-guide.md)，条目模板在 `project-docs/templates/grammar-entry.md`
- 出题 → [练习题编写指南](docs/contribute/quiz-guide.md)
- 合并前审核 → [内容审核指南](docs/contribute/review-guide.md)

只想报问题、不动代码：走 [Issue 模板](https://github.com/mloluyu/japanese-grammar/issues/new/choose)（内容纠错／新增语法建议／搜索反馈／练习反馈／站点问题）。

## 项目文档

设计与维护文档集中在 [project-docs/](project-docs/)；实现与文档不一致时应同步更新文档：

| 文档 | 内容 |
|---|---|
| [产品需求 PRD](project-docs/PRD.md) | 目标用户、功能需求与验收标准 |
| [系统架构](project-docs/ARCHITECTURE.md) | 技术选型、站点结构与搜索/筛选边界 |
| [内容数据规范](project-docs/CONTENT_SCHEMA.md) | 条目 Frontmatter、例句 JSON 与题库格式 |
| [开发与部署](project-docs/DEVELOPMENT.md) | 本地开发、CI 约定与 Cloudflare Pages 配置 |
| [测试策略](project-docs/TESTING.md) | 自动化校验范围与手工验收清单 |
| [路线图](project-docs/ROADMAP.md) | 里程碑与当前进度 |
| [架构决策记录 ADR](project-docs/adr/README.md) | 重大技术选择的背景与结论 |

## 技术栈

- [VitePress](https://vitepress.dev) + Vue 3 + TypeScript：静态站点与交互（筛选、练习、假名切换）。
- Node.js 校验脚本：`npm run check` 汇总数据校验与搜索分词验证；CI 仅在 PR 时运行。
- 部署：Cloudflare Pages，推送到 main 自动构建发布。

## 许可证

代码与配置以 [MIT](LICENSE) 许可发布；语法讲解、例句等创作内容以 [CC BY-NC-SA 4.0](LICENSE.content) 提供。贡献者应只提交自己创作、获得许可或可合法再分发的内容；不要直接复制受版权保护的教材、题库、音频或网站释义。

**例句音频不在上述许可范围内**：站内例句发音由开源 TTS 模型 [ayousanz/piper-plus-tsukuyomi-chan](https://huggingface.co/ayousanz/piper-plus-tsukuyomi-chan)（训练语料：[つくよみちゃんコーパス](https://tyc.rei-yumesaki.net/material/corpus/)，CV. 夢前黎）生成，仅限站内收听，不授权二次利用。模型文件不随仓库分发，由维护者从 Hugging Face 获取。完整的开源组件引用与模型分发政策见[维护团队页的「许可与声明」](docs/team/index.md)。
