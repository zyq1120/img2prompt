# img2prompt 架构设计

## 1. 总览
Chromium MV3 扩展，TypeScript + esbuild 构建。无后端、无账号，所有状态在本地。

```
src/
├── manifest.json            # MV3 清单：permissions / commands / action / options
├── background/service-worker.ts  # 大脑：菜单、快捷键、生成链路、取消、历史写入
├── content/
│   ├── content-script.ts    # 注入页面：悬浮面板（Shadow DOM）、消息中转
│   └── region-selector.ts   # 框选 overlay：拖拽选区、Esc 取消
├── popup/                   # 工具栏弹窗：上传 / 历史 / 搜索 / 收藏 / provider 切换
├── options/                 # 设置页：provider 管理 / 模板管理 / 通用
└── lib/
    ├── api.ts               # 视觉接口调用、图片下载/压缩/裁剪、JSON 容错解析
    ├── storage.ts           # chrome.storage 封装：设置 / provider / 模板 / 历史
    ├── prompt-templates.ts  # 内置模板定义与渲染
    ├── image.ts             # 图片处理（压缩、缩略图）
    ├── i18n.ts              # 语言工具
    └── types.ts             # 全局类型
```

## 2. 核心链路

### 右键图片生成
```
右键菜单点击 → handleMenuClick(tabId, srcUrl)
  → 下载图片 → 压缩（downscaleDataUrl）
  → 按当前 provider + 模板组装请求 → generateImagePrompt（可取消）
  → 推送面板状态（loading → result / error）
  → 写入本地历史（含缩略图）
```

### 框选截图生成
```
右键"框选截图" / 快捷键 Ctrl+Shift+Y → startRegionSelect(tabId)
  → 注入 content script → 发送 IMG2PROMPT_REGION_SELECT
  → region-selector 显示 overlay → 用户拖拽
  → IMG2PROMPT_REGION_DONE(rect) → captureVisibleTab
  → cropScreenshot → handleRegionShot → 同右键链路后半段
```

### 面板内交互（语言/模板切换、重试、取消）
- 复用 `tabImageCache` 中的已下载图片，不重复下载
- 每次生成创建 `AbortController` 存入 `tabAbortControllers`，取消 / tab 关闭时 abort

## 3. 关键设计决策

| 决策 | 说明 |
|---|---|
| Shadow DOM 面板 | 结果面板渲染在 Shadow DOM 内，与宿主页面样式完全隔离 |
| BYOK 多 provider | provider 配置（Base URL / Key / 模型）存本地，调用时按"当前 provider"解析；OpenAI-compatible 接口通用 |
| 模板系统 | 提示词模板 = system prompt 模板，支持变量插值；JSON 模板走结构化解析 + tags/kv 渲染 |
| 快捷键走同一链路 | `chrome.commands` 触发 `triggerRegionSelectCommand`，与右键菜单共用 `startRegionSelect`，不分叉 |
| E2E 钩子 | `__img2promptE2E` 暴露与生产相同的处理函数，headless 下可验证完整链路；不改变生产行为 |
| 错误可读化 | 网络/解码异常统一包装为 `VisionApiError`，面板显示用户可读文案而非"未知错误" |

## 4. 数据模型（chrome.storage.local）
- `settings`：默认语言、当前 providerId、当前模板等
- `providers[]`：{ id, name, baseUrl, apiKey, model }
- `templates[]`：{ id, name, systemPrompt, nameEn... }，含内置与自定义
- `history[]`：最近 20 条 { imageThumb, prompt, lang, templateId, providerId, favorite, createdAt }

## 5. 构建与发布
- `npm run build` → esbuild 打包到 `dist/`；`--zip` 生成商店/Releases 包（版本号取 manifest）
- CI（.github/workflows/ci.yml）：lint + typecheck + format:check + test + build
- Release（release.yml）：推送 `v*.*.*` tag → 自动构建 zip → 创建 GitHub Release
