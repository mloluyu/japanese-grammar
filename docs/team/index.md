---
title: 关于本站
---

# 关于本站

本站来源于某个日语学习群管理员的某日突发奇想。

### 来自社群的帮助

知识共享离不开各位的支持，这个页面尽自己所能地记录了所有为本站提供帮助的人：

### 许可与声明

本站的许可分三层：

**1. 代码与配置 —— MIT**

仓库中的代码、脚本与站点配置以 [MIT](https://opensource.org/licenses/MIT) 许可发布（见仓库 [LICENSE](https://github.com/mloluyu/japanese-grammar/blob/main/LICENSE)）。

**2. 创作内容 —— CC BY-NC-SA 4.0**

语法讲解、例句、练习题等创作内容以 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh) 许可发布（见 [LICENSE.content](https://github.com/mloluyu/japanese-grammar/blob/main/LICENSE.content)）。

**3. 例句音频 —— 仅限站内收听**

站内例句发音由开源语音合成模型生成，**不在 CC BY-NC-SA 4.0 范围内**：音频仅限在本站收听（鑑賞用），不授权下载后的二次利用。这是因为训练语料「つくよみちゃんコーパス」的利用规约禁止以「允许他人把合成语音当作素材再利用」的形式公开合成语音。如需语音素材，请直接查阅该语料官方页面。

#### 开源项目引用

本站在构建过程中使用以下开源项目：

| 项目 | 许可 | 用途 |
| --- | --- | --- |
| [piper-plus](https://github.com/ayutaz/piper-plus) 0.8.1 | MIT | 语音合成引擎（含日语音素化 WASM） |
| [onnxruntime-web](https://github.com/microsoft/onnxruntime) 1.30.0 | MIT | 模型推理运行时 |
| [@breezystack/lamejs](https://github.com/breezystack/lamejs) 1.2.7 | LGPL-3.0 | MP3 编码（仅构建期工具，产物不受其约束） |

#### 模型来源与分发政策

- 例句发音使用模型 [ayousanz/piper-plus-tsukuyomi-chan](https://huggingface.co/ayousanz/piper-plus-tsukuyomi-chan)（基于 [ayousanz/piper-plus-base](https://huggingface.co/ayousanz/piper-plus-base)，CC BY-4.0）。
- **本仓库不分发模型文件**：模型由维护者按 [DEVELOPMENT 文档](https://github.com/mloluyu/japanese-grammar/blob/main/project-docs/DEVELOPMENT.md)的流程从 Hugging Face 下载至本地缓存，仓库与站点均不包含模型本体。
- 模型许可证遵循 [つくよみちゃんコーパス 利用规约](https://tyc.rei-yumesaki.net/material/corpus/)（语料：つくよみちゃんコーパス，CV. 夢前黎）。该规约若发生变更，以官方页面为准。
- 若未来需要分发模型本体或其派生物，将遵循该规约的继承条款（由其派生的部分继续按该规约处理）后再行动。
