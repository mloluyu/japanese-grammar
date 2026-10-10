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

## 4. 站点配置

- VitePress 配置放在 `docs/.vitepress/config.ts`。
- 站点根 `lang` 设为 `zh-CN`；日语内容由组件标记 `lang="ja"`。
- `base` 应与最终托管路径一致。
- 在仓库子路径部署时，内部链接、静态资源和音频地址都应通过站点 base 规则验证。
- 本地开发和生产预览至少各检查一次。
- 主题配置与自定义组件应集中维护，不要在每篇 Markdown 里复制交互逻辑。

## 5. Pull Request 检查

每个 PR 至少运行（与 `.github/workflows/ci.yml` 保持一致）：
1. 安装 lockfile 中的依赖：`npm ci`。
2. `npm run check`：语法元数据、例句与题库校验，加搜索分词验证。
3. `npm run docs:build`：VitePress 构建。

当前未配置类型检查与单元测试；未来引入时应先更新本清单与 ci.yml。

PR 检查失败时，贡献者应先修复再请求合并。站点部署由 Cloudflare Pages 承担，不在 CI 中进行。

## 6. 部署（Cloudflare Pages，已配置）

日常开发以本地验证为主，不在 CI 中构建或部署站点；推送到 main 后由 Cloudflare Pages 自动构建发布：

1. 本地效果验证：`npm run docs:dev`；发布前完整验证：`npm run check && npm run docs:build`。
2. Cloudflare Pages 已连接仓库，构建命令 `npm run docs:build`，输出目录 `docs/.vitepress/dist`。
3. Pages 环境变量固定 Node 版本（`NODE_VERSION=24`）。
4. 站点在域名根路径服务，`docs/.vitepress/config.ts` 的 `base` 为 `/`；若改为仓库子路径托管需同步改回。
5. 首次部署后已核对公开 URL、内部链接与资源路径；后续改动重点复查新页面的链接与资源。

## 7. 网页编辑流程

1. 在 GitHub 中打开需要修改的 Markdown 或 JSON 文件。
2. 选择编辑功能，修改内容。
3. 在提交页面选择新分支并创建 Pull Request。
4. 等待自动检查。
5. 在 PR 中说明修改内容、来源与需要审核的点。
6. 由维护者审核并合并。

不熟悉 Markdown 的贡献者可以先创建 Issue，由维护者协助整理。

## 8. 常见问题

### 页面刷新后 404
检查页面路径、文件名大小写和 VitePress `base` 配置。

### 音频在本地能播、线上不能播
检查资源路径是否包含仓库 base、文件是否已提交，以及大小写是否一致。

### 构建在本地通过但 CI 失败
检查 Node/npm 版本差异、lockfile 是否提交、大小写敏感路径和环境变量。

## 9. 维护原则

- 提交 `package-lock.json`。
- 依赖升级应通过单独 PR，并执行构建与功能回归。
- 不在浏览器代码中存放秘密。
- 不自动部署未经审核的 PR 预览到正式站点。
