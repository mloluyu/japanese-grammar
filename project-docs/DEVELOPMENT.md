# 开发与部署指南

## 1. 环境准备

建议安装：
- Node.js 24+（`.nvmrc` 固定 24；Cloudflare Pages 侧 `NODE_VERSION=24`）。
- npm。
- Git。
- 一个 GitHub 账号。

## 2. 本地开发

```bash
git clone https://github.com/mloluyu/japanese-grammar.git
cd japanese-grammar
npm ci
npm run docs:dev
```

终端会输出本地开发地址。修改 `docs/` 下的内容后，开发服务器通常会自动刷新。

## 3. 脚本

脚本清单以 `package.json` 实际内容与 README《本地开发》一节为准，此处不重复维护，避免多处清单漂移。常用命令：

- `npm run docs:dev`：本地预览。
- `npm run docs:build`：完整构建。
- `npm run check`：数据校验与搜索分词验证门禁，PR 与发布前必跑。

## 4. 音频生成

例句音频由脚本离线批量生成：**维护者只需编写例句文本（多音字补 `reading` 假名字段），不手工录制、不进构建期合成**。

- 依赖安装：`npm run audio:setup`（piper-plus + onnxruntime-web + lamejs，纯 JS/Node，无需系统二进制；以 `--no-save` 安装，生成依赖不入库——重新 `npm install` 后需重跑本命令）。
- 核对缺口：`npm run audio:check`（只报告缺失/过期，不生成，不下载模型）。
- 生成：`npm run audio:generate`（默认只处理 `active` 声音；`node scripts/generate-audio.mjs --all` 处理全部声音，试点盲听用）。
- 引擎、模型版本与音色参数钉在 `scripts/audio.config.json`：更换模型、音色或关键参数＝新增 voice-id，不得复用旧 ID（避免同一文件名对应两批音质）。
- 生成物：`docs/public/audio/{voiceId}/{例句ID}.mp3`；脚本把站点地址回写到例句 JSON 的 `audio` 字段，前端组件不感知生成过程。
- 溯源台账：`content/audio-manifest.json` 记录每条音频的文本哈希、模型、参数与许可快照（文本改动或引擎/参数变化会触发自动重生成）；前端不读取该文件。
- 多音字兜底：例句 JSON 的 `reading` 字段（全假名，校验器禁止汉字）会替代 `text` 送入 TTS。
- 许可状态：引擎 MIT（lamejs 为 LGPL-3.0，仅构建期工具，产物不受其约束）；生成音频按 tsukuyomi 语料利用规约处理——**仅限站内收听（鑑賞用），不授权二次利用**，且不得标注 CC0。正式声明见 `docs/team/index.md`「许可与声明」与 `LICENSE.content` 例外段；`audio.config.json` 的 `license` 字段已落正式文字。选型已完成（tsukuyomi-v1 转正），`docs/public/audio/` 与 `tools/*.mjs` 已入库，`tools/models/`（模型缓存）与探针产物仍忽略。
- 个别句发音瑕疵处置：模型对特定音簇（如 gak）的渲染有随机劣化（约五成好take率）。流程＝整批试听 → 挑出坏句 → `node tools/take-pick.mjs` 出多个 take → 人耳选定后 `node tools/lock-take.mjs <label> <exampleId>` 锁定（写生产路径＋manifest，fingerprint 不变，重跑不会覆盖）。
- 五十音发音：**人工验收的定稿产物直接入库**（`docs/public/audio/kana/{罗马字}.mp3`，104 格），溯源台账 `content/kana-audio-manifest.json` 记录每格采用的合成形态（载词切取／延长音窗口等）与时长、清晰度指标。孤立的假名单字直接合成会退化为轻声或电流音（22 轮校准的结论），因此不做一键全量重生成；需要改动某格时，从提交 `95941b7` 的历史取回当时的探针脚本作为参照（`git show 95941b7:tools/kana-round22-probe.mjs` 等），对该格单独合成、试听、选定后覆盖对应 mp3 并同步台账。许可与例句音频相同。

## 5. 站点配置

- VitePress 配置放在 `docs/.vitepress/config.ts`。
- 站点根 `lang` 设为 `zh-CN`；日语内容由组件标记 `lang="ja"`。
- `base` 应与最终托管路径一致。
- 在仓库子路径部署时，内部链接、静态资源和音频地址都应通过站点 base 规则验证。
- 本地开发和生产预览至少各检查一次。
- 主题配置与自定义组件应集中维护，不要在每篇 Markdown 里复制交互逻辑。

## 6. Pull Request 检查

每个 PR 至少运行（与 `.github/workflows/ci.yml` 保持一致）：
1. 安装 lockfile 中的依赖：`npm ci`。
2. `npm run check`：语法元数据、例句与题库校验，加搜索分词验证。
3. `npm run docs:build`：VitePress 构建。

当前未配置类型检查与单元测试；未来引入时应先更新本清单与 ci.yml。

PR 检查失败时，贡献者应先修复再请求合并。站点部署由 Cloudflare Pages 承担，不在 CI 中进行。

## 7. 部署（Cloudflare Pages，已配置）

日常开发以本地验证为主，不在 CI 中构建或部署站点；推送到 main 后由 Cloudflare Pages 自动构建发布：

1. 本地效果验证：`npm run docs:dev`；发布前完整验证：`npm run check && npm run docs:build`。
2. Cloudflare Pages 已连接仓库，构建命令 `npm run docs:build`，输出目录 `docs/.vitepress/dist`。
3. Pages 环境变量固定 Node 版本（`NODE_VERSION=24`）。
4. 站点在域名根路径服务，`docs/.vitepress/config.ts` 的 `base` 为 `/`；若改为仓库子路径托管需同步改回。
5. 首次部署后已核对公开 URL、内部链接与资源路径；后续改动重点复查新页面的链接与资源。

## 8. 网页编辑流程

1. 在 GitHub 中打开需要修改的 Markdown 或 JSON 文件。
2. 选择编辑功能，修改内容。
3. 在提交页面选择新分支并创建 Pull Request。
4. 等待自动检查。
5. 在 PR 中说明修改内容、来源与需要审核的点。
6. 由维护者审核并合并。

不熟悉 Markdown 的贡献者可以先创建 Issue，由维护者协助整理。

## 9. 常见问题

### 页面刷新后 404
检查页面路径、文件名大小写和 VitePress `base` 配置。

### 音频在本地能播、线上不能播
检查资源路径是否包含仓库 base、文件是否已提交，以及大小写是否一致。

### 构建在本地通过但 CI 失败
检查 Node/npm 版本差异、lockfile 是否提交、大小写敏感路径和环境变量。

## 10. 维护原则

- 提交 `package-lock.json`。
- 依赖升级应通过单独 PR，并执行构建与功能回归。
- 不在浏览器代码中存放秘密。
- 不自动部署未经审核的 PR 预览到正式站点。
