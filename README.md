# 日语语法知识库

一个以 GitHub 仓库为内容源的日语语法文档与学习工具。目标是让群友能方便地阅读、检索、练习，并通过 GitHub 网页编辑或 Pull Request 参与贡献。

## 项目目标

- 提供清晰、可检索的日语语法文档。
- 支持 JLPT 等级、标签与专题导航。
- 提供例句、假名标注与可选音频。
- 提供轻量练习与自测。
- 以静态网站发布，不依赖自建后端或数据库。

## 技术方案

- VitePress：文档站与静态构建。
- Vue 3 + TypeScript：筛选、练习、假名显示等交互。
- Markdown + YAML Frontmatter：语法正文与元数据。
- JSON：练习题数据。
- GitHub Actions：仅在 PR 时运行数据校验与构建检查；部署由 Cloudflare Pages 承担（正式发布时配置）。

## 文档导航

- [产品需求](project-docs/PRD.md)
- [系统架构](project-docs/ARCHITECTURE.md)
- [内容数据规范](project-docs/CONTENT_SCHEMA.md)
- [开发与部署](project-docs/DEVELOPMENT.md)
- [测试策略](project-docs/TESTING.md)
- [路线图](project-docs/ROADMAP.md)
- [贡献指南](CONTRIBUTING.md)
- [Issue 反馈入口](https://github.com/mloluyu/japanese-grammar/issues/new/choose)：内容纠错／新增语法建议／搜索反馈／练习反馈／站点问题
- [语法编写指南](docs/contribute/writing-guide.md)
- [练习题编写指南](docs/contribute/quiz-guide.md)
- [内容审核指南](docs/contribute/review-guide.md)
- [语法条目模板](project-docs/templates/grammar-entry.md)
- [架构决策记录](project-docs/adr/README.md)

## 状态

Milestone 0（仓库初始化）已完成：VitePress 站点骨架、数据校验脚本与 CI/Pages 工作流已就位；语法内容按路线图（M1 起）逐步补充。开发过程中若实际实现与文档不同，应同步更新文档，并在重大技术选择时新增 ADR。

## 许可证与内容来源

代码与配置以 [MIT](LICENSE) 许可发布；语法讲解、例句等创作内容以 [CC BY-SA 4.0](LICENSE.content) 提供。贡献者应只提交自己创作、获得许可或可合法再分发的内容；不要直接复制受版权保护的教材、题库、音频或网站释义。
