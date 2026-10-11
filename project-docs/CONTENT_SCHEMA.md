# 内容数据规范

- 状态：Draft
- 版本：0.1

本文定义语法文档、结构化例句与练习题的约定。实现校验脚本时，应以此文档为准。

## 1. 通用规则

- 文件名使用小写英文、数字和连字符，避免空格。
- `id` 在整个项目内唯一且稳定；建议使用 `koto-ni-naru` 这类简短形式，不要把等级或目录层级写进 ID，等级与分类的调整不应导致 ID 变更。
- 文本以 UTF-8 保存。
- 语法内容应由贡献者原创或基于允许再分发的来源整理。
- 必须区分事实、使用倾向与个人记忆技巧。
- 例句应自然，并提供准确中文释义；存在语境限制时注明。

## 2. Frontmatter 字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `id` | string | 是 | 全局唯一稳定 ID |
| `title` | string | 是 | 页面标题，如 `〜ことになる` |
| `reading` | string | 建议 | 读音或检索用假名 |
| `jlpt` | enum | 是（`grammar-term` 分类除外） | `N5`、`N4`、`N3`、`N2`、`N1`；文法术语类条目不标等级 |
| `category` | string | 是 | 稳定分类 ID，必须在分类注册表 `docs/.vitepress/categories.json` 中定义 |
| `tags` | string[] | 是 | 可为空数组，但字段必须存在；不写入 JLPT 等级标签 |
| `forms` | string[] | 建议 | 接续形式 |
| `related` | string[] | 是 | 关联语法 ID，可为空数组；驱动「相关语法」列表的自动渲染 |
| `status` | enum | 是 | `draft`、`reviewed`、`needs-correction` |

示例：

```yaml
---
id: koto-ni-naru
title: 〜ことになる
reading: ことになる
jlpt: N3
category: sentence-patterns
tags:
  - 结果
  - 决定
forms:
  - 动词辞书形
related:
  - koto-ni-suru
status: draft
---
```

分类 ID 集中登记在分类注册表 `docs/.vitepress/categories.json`（ID 与中文显示名一一对应），校验脚本会拒绝未注册的分类；新增分类须通过 PR 修改该注册表，避免每篇文档自造写法。标签保持轻量：中文短词（建议 1–4 字），优先复用既有标签，不写入 JLPT 等级。

JLPT 等级只通过 `jlpt` 字段维护，是等级信息的唯一事实源。`tags` 中不要写入 `N5`–`N1` 等级标签，校验脚本会将此类条目判为错误；等级徽章与索引筛选中的等级维度由构建脚本从 `jlpt` 字段自动派生，不需要手工重复维护。分类 `grammar-term`（文法术语）面向跨等级的术语解说，`jlpt` 可省略；省略后索引卡片不显示等级徽章，等级筛选下这类条目仅在「全部等级」出现。

## 3. 正文建议结构

```markdown
# 语法标题

## 核心含义
## 接续
## 例句
## 相似表达
## 使用注意
## 参考与补充
```

不是所有条目都必须机械地拥有每个标题。对于不适用的部分可以省略，但核心含义和至少一个可靠例句应作为内容审核要求。`related` 驱动"相关语法"链接列表的自动渲染，正文「相似表达」一节只写差异说明，不手写 Markdown 链接。

## 4. 练习题 JSON

建议单选题结构：

```json
{
  "id": "particles-001",
  "title": "N3 助词与句型练习",
  "questions": [
    {
      "id": "q001",
      "type": "single-choice",
      "grammarIds": ["koto-ni-naru"],
      "prompt": "来月、日本へ留学する（　）なりました。",
      "options": ["ことに", "ことが", "ものに", "ようで"],
      "answer": 0,
      "explanation": "此处考查「〜ことになる」的接续。",
      "difficulty": 2
    }
  ]
}
```

校验要求：
- 题库 `id` 全局唯一。
- 每道题 `id` 在全项目内唯一。
- `type` 第一版仅允许 `single-choice`。
- `options` 至少两项，且答案索引是有效整数。
- `grammarIds` 中的每个 ID 必须存在。
- `explanation` 非空。
- 难度建议使用 1–3 的整数，含义见《练习题编写指南》（docs/contribute/quiz-guide.md）。

## 5. 结构化例句

每条语法的例句存放在与条目同名的 JSON 文件中：`content/grammar/{语法ID}.json`（与条目 Markdown 分离存放）。

```json
{
  "grammarId": "koto-ni-naru",
  "examples": [
    {
      "id": "ex-koto-ni-naru-001",
      "text": "来月、日本へ留学することになりました。",
      "reading": "らいげつ、にほんへりゅうがくすることになりました。",
      "furigana": [
        { "text": "来月", "reading": "らいげつ" },
        { "text": "留学", "reading": "りゅうがく" }
      ],
      "translation": "（由于安排）下个月要去日本留学。",
      "audio": "/audio/{voiceId}/ex-koto-ni-naru-001.mp3"
    }
  ]
}
```

- `grammarId` 必须与文件名及对应语法条目的 `id` 一致。
- 例句 `id` 全局唯一，建议使用 `ex-{语法ID}-三位序号` 的形式。
- `furigana` 为可选字段，仅覆盖确实需要标注的词，避免重复存储整句的每个字符；`text` 必须与句中出现的写法完全一致。
- `audio` 为可选字段；不存在音频时省略或置为 `null`，并确保 UI 不显示失效播放器。音频由脚本自动生成并回写本字段（见第 6 节与《开发与部署指南》「音频生成」），贡献者不必手填。
- `reading` 为可选字段：整句假名读音，仅用于音频生成（替代 `text` 送入 TTS）。多音字、专有名词或希望控制朗读的句子建议提供；必须全假名，校验器禁止夹汉字。
- 例句一律以结构化 JSON 提供，Markdown 正文中不再手写例句或 `<ruby>` 标注；`<ruby><rt>` 只是组件渲染例句时的输出格式，不是贡献者的书写入口。页面「例句」一节由全局组件 `<ExampleSentences />` 读取该文件渲染（假名切换为会话内状态，不做本地持久化）。

## 6. 音频规范

音频由 `scripts/generate-audio.mjs` 离线批量生成，**不在构建期合成，维护者不手工录制**：

- 贡献者职责只到例句文本为止；需要控制读音时补 `reading` 字段（全假名）。
- 生成命令、引擎/模型版本钉定与许可状态见《开发与部署指南》第 4 节「音频生成」。
- 生成物路径固定为 `docs/public/audio/{voiceId}/{例句ID}.mp3`，脚本把站点地址回写进例句 `audio` 字段；更换模型或音色＝新增 voice-id，不复用旧目录。
- `content/audio-manifest.json` 为构建侧溯源台账（文本哈希/模型/参数/许可快照），前端不读取。
- 手工提供音频（如自录）仍须有合法再分发权限，路径与命名须符合上述约定，校验器会核对 `audio` 指向的文件真实存在。
- 音频不是必需依赖：无音频的例句只显示「暂无音频」，不得影响文本阅读。

## 7. 状态与审核

- `draft`：未完成审核，可在贡献分支中继续编辑。
- `reviewed`：已审核，可以作为正式内容发布。
- `needs-correction`：发现问题，需要修改。
- 正式部署不应依赖 Frontmatter 状态自动隐藏内容，除非项目明确实现并测试该规则；审核仍以 PR 流程为准。
