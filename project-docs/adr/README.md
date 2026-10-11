# 架构决策记录（ADR）

ADR 用于记录影响项目长期维护的技术决策。小型文案修改不需要新增 ADR；改变框架、内容模型、部署方式或本地数据策略时应考虑记录。

## 状态约定

- Proposed：提议中
- Accepted：已采纳
- Rejected：已否决
- Superseded：被新决策替代

## ADR 模板

创建 `NNNN-short-title.md`：

```markdown
# ADR-NNNN：标题

- 状态：Proposed
- 日期：YYYY-MM-DD

## 背景
为什么需要做出决策？

## 备选方案
列出主要方案及其优缺点。

## 决策
选择了什么？

## 后果
带来了哪些收益、成本和限制？

## 复审条件
什么情况下应重新评估？
```

## 初始决策索引

- [ADR-0001：使用 VitePress 作为文档框架](0001-vitepress.md)
- [ADR-0002：使用 Markdown Frontmatter 与 JSON 分离内容](0002-content-model.md)
- [ADR-0003：使用静态托管与本地学习状态](0003-static-first.md)（本地学习状态部分已被 ADR-0004 取代）
- [ADR-0004：不实现本地学习记录](0004-no-local-study-state.md)
- [ADR-0005：生成音频的许可与模型分发策略](0005-generated-audio-licensing.md)
