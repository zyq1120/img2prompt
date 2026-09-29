# Img2Prompt

> 在任意网页图片上右键，一键生成适用于 Midjourney / Stable Diffusion / FLUX 的 AI 绘画提示词。
> Right-click any web image to generate AI art prompts for Midjourney / Stable Diffusion / FLUX.

[English](#english) | [设计参考](#设计参考design-references)

## 功能 Features

- 🖱️ **右键即分析**：在图片上右键 →「生成图片提示词」，页内悬浮面板直接展示结果
- ⌨️ **快捷键框选**：`Ctrl+Shift+Y`（Mac 上 `⌘+Shift+Y`）直接进入框选截图识别，可在 `chrome://extensions/shortcuts` 修改
- 🌐 **中英一键切换**：面板内 中 / EN 切换，复用已下载图片重新生成，无需重复等待下载
- 📋 **一键复制**：结果面板、历史记录均可一键复制
- 🕘 **本地历史**：最近 20 条生成记录保存在本地，popup 点击复制、一键清空
- 🔑 **BYOK**：支持任何 OpenAI-compatible 视觉接口（OpenAI / 第三方中转 / 本地模型）
- ⚙️ **设置页**：API Key、Base URL、模型、默认语言，一键测试连接
- 🛡️ **样式隔离**：结果面板使用 Shadow DOM，不污染页面样式

## 快速开始 Quick Start

```bash
npm install
npm run build
```

1. 打开 `chrome://extensions`，开启右上角「开发者模式」
2. 点击「加载已解压的扩展程序」，选择项目下的 `dist/` 目录
3. 点击工具栏的 Img2Prompt 图标 →「设置」，填写 API Key（仅保存在本机）
4. 在任意网页图片上右键 →「生成图片提示词」✨

## 配置项 Settings

| 配置项      | 默认值                      | 说明                                   |
| ----------- | --------------------------- | -------------------------------------- |
| API Key     | （空）                      | 仅存储于本地 `chrome.storage.local`，绝不上传 |
| Base URL    | `https://api.openai.com/v1` | 任意 OpenAI-compatible 接口地址        |
| 模型 Model  | `gpt-4o`                    | 需支持视觉输入（如 `gpt-4o-mini`）     |
| 默认语言    | 中文                        | 生成提示词的语言，也可在面板内即时切换 |

## 开发 Development

```bash
npm run dev            # 监听模式构建（src/ → dist/）
npm test               # vitest 单测
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit
npm run format         # Prettier 格式化
npm run build -- --zip # 构建并打出 img2prompt-vx.y.z.zip
```

改完代码后，在 `chrome://extensions` 点击扩展卡片上的「刷新」即可生效。

## 目录结构 Project Structure

```
src/
├── background/      # service worker：右键菜单 + 完整生成链路
├── content/         # 悬浮结果面板（Shadow DOM 样式隔离）
├── popup/           # 历史记录弹窗
├── options/         # 设置页
├── lib/             # 共享库：api / storage / i18n / prompt-templates / types
├── assets/icons/    # 插件图标
└── manifest.json    # MV3 manifest
_locales/            # 中英双语文案（chrome.i18n）
test/                # vitest 单测（api / templates / storage / i18n）
scripts/build.mjs    # esbuild 构建脚本
.github/workflows/   # CI / Release
```

技术栈：Chromium Manifest V3 · TypeScript · esbuild，零运行时依赖。

## CI/CD

- **CI**（`.github/workflows/ci.yml`）：push 到 `main` 或 PR 时自动运行 lint、typecheck、format 检查、单测、构建，并上传 `dist/` 为 artifact
- **Release**（`.github/workflows/release.yml`）：推送 `v*.*.*` tag 后自动构建 zip 并创建 GitHub Release

## 代码规范 Code Style

- 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)
- 按功能模块划分目录（background / content / popup / options / lib）
- ESLint + Prettier + TypeScript 严格模式，小函数、命名清晰、中文注释

## 隐私 Privacy

- API Key **仅**存储于本地 `chrome.storage.local`，不上传、不进入版本库
- 图片仅发送到**你自己配置**的 API 地址，不经过任何第三方服务器
- 历史记录仅保存在本地浏览器，可一键清空

## 设计参考 Design References

立项时调研了以下开源项目，**仅借鉴交互思路，未使用其代码**：

1. [rmaxvell/imgprompt-ai](https://github.com/rmaxvell/imgprompt-ai) — hover 一键识别、右键菜单、侧栏历史、多 provider、图片压缩、请求超时、多语言、自定义 system prompt
2. [pingan8787/image2prompt](https://github.com/pingan8787/image2prompt) — hover 按钮、模型选择、多语言、历史记录、自定义模板、轻量 UI
3. [geslie1/eyrove-prompt-lite](https://github.com/geslie1/eyrove-prompt-lite) — BYOK OpenAI-compatible、结构化提示词、本地历史、直接请求用户配置 endpoint

v1 坚持最短流程：**右键即分析 → 页内悬浮卡展示 → 一键复制 → 中英切换**。

## Roadmap

- ✅ v0.1.0：右键生成、中英切换、悬浮面板、BYOK、本地历史
- 🚧 v0.2.0（开发中）：多服务商管理、提示词模板、框选截图 + 快捷键、popup 上传、历史搜索/收藏、请求取消、JSON 结构化输出
- 🔮 v0.3.0（候选）：Chrome Web Store 上架、侧边栏历史、批量识别

文档：[需求](docs/REQUIREMENTS.md) · [架构](docs/ARCHITECTURE.md) · [用户手册](docs/USER-GUIDE.md) · [已知问题](docs/KNOWN-ISSUES.md) · [更新日志](CHANGELOG.md) · [贡献指南](CONTRIBUTING.md)

## License

[MIT](./LICENSE)

---

## English

**Img2Prompt** — right-click any image on the web and generate a ready-to-use AI art prompt for Midjourney / Stable Diffusion / FLUX.

### Features

- 🖱️ **Right-click to analyze**: context menu on any image, floating in-page panel shows the result
- ⌨️ **Shortcut for region select**: `Ctrl+Shift+Y` (`⌘+Shift+Y` on Mac) starts region capture directly; remappable at `chrome://extensions/shortcuts`
- 🌐 **One-click zh/en switch**: re-generates in the other language reusing the downloaded image
- 📋 **One-click copy** from the panel and from history
- 🕘 **Local history**: last 20 generations stored locally, click to copy, one-click clear
- 🔑 **BYOK**: works with any OpenAI-compatible vision endpoint
- ⚙️ **Options page**: API Key, Base URL, model, default language, test-connection button
- 🛡️ **Style isolation**: result panel rendered in Shadow DOM

### Quick start

```bash
npm install && npm run build
```

1. Open `chrome://extensions`, enable "Developer mode"
2. "Load unpacked" → select the `dist/` folder
3. Toolbar icon → Settings → fill in your API Key (stored locally only)
4. Right-click any image → "Generate image prompt" ✨

### Settings

| Option         | Default                     | Notes                                              |
| -------------- | --------------------------- | -------------------------------------------------- |
| API Key        | (empty)                     | stored in local `chrome.storage.local` only        |
| Base URL       | `https://api.openai.com/v1` | any OpenAI-compatible endpoint                     |
| Model          | `gpt-4o`                    | must support vision input                          |
| Default lang   | Chinese                     | can also be switched instantly inside the panel    |

### Privacy

- The API Key lives **only** in local `chrome.storage.local` — never uploaded, never committed
- Images are sent **only** to the endpoint you configure — no third-party servers
- History is stored locally and can be cleared with one click
