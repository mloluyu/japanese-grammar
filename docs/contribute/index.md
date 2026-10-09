---
title: 贡献指南
---

# 贡献指南

感谢你帮助改进日语语法知识库。本页是从反馈到发布的路径总览；写作与审核标准见三份分册，不在多处维护同一份清单。

## 参与路径

- **报告问题**：使用 [Issue 反馈模板](https://github.com/mloluyu/japanese-grammar/issues/new/choose)——内容纠错／新增语法建议／搜索反馈／练习反馈／站点问题。
- **网页编辑**：在 GitHub 上打开目标文件直接编辑、提交到新分支并发起 PR，适合小幅修订；完整步骤见仓库根目录的 `CONTRIBUTING.md`。
- **本地开发**：克隆仓库后 `npm run docs:dev` 预览，提交前运行 `npm run check`；详细流程见 `CONTRIBUTING.md`。

## 三份指南

- [语法条目编写指南](/contribute/writing-guide)——Frontmatter 规范、正文结构、例句 JSON 的写法。
- [练习题编写指南](/contribute/quiz-guide)——难度语义与出题质量规则。
- [内容审核指南](/contribute/review-guide)——条目合并前的审核清单。

## 约定速览

- 新增条目：复制仓库内 `project-docs/templates/grammar-entry.md`，例句写在 `docs/grammar/<id>.json`。
- 语法 ID 不含等级与目录层级；分类必须来自注册表 `docs/.vitepress/categories.json`。
- 「相似表达」只写差异说明，不手写链接（相关条目由 `related` 自动渲染）。
- 练习题通过 `grammarIds` 自动出现在对应条目页，无需在正文中登记。

## 内容许可

提交即表示内容为本人原创或可合法再分发；站点内容以 CC BY-NC-SA 4.0 发布，代码以 MIT 发布，许可文件见仓库根目录。
