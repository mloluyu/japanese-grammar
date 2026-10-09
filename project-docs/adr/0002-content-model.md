# ADR-0002：Markdown Frontmatter 与 JSON 分离内容

- 状态：Accepted
- 日期：2026-10-09

## 背景

语法解释适合自由排版，筛选元数据与练习题则需要稳定结构。

## 备选方案

- 全部写在 Markdown：贡献简单，但机器校验和题库交互不便。
- 全部使用 JSON/YAML：结构明确，但长篇解释和排版体验较差。
- Markdown + Frontmatter + JSON：按用途选择格式。

## 决策

语法正文使用 Markdown，元数据使用 YAML Frontmatter，练习题使用 JSON。索引由脚本生成。

## 后果

正文编辑门槛低，结构化数据可校验；需要维护校验脚本，并避免在多处重复维护同一字段。
