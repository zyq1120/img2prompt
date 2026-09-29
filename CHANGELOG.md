# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/)，版本号遵循 [SemVer](https://semver.org/)。

## [Unreleased]

## [3.1.0] — 2026-09-29

### Changed

- UI 按有道翻译官结果页参考重做：大圆角 + 浅蓝 tint 卡片 + 亮蓝主色（深色模式同步适配）
- 悬浮面板：顶栏改为 `×` 左 + 居中 `中文 ⇄ EN` 浅蓝 pill；结果放入浅蓝 tint hero 大卡片；底部操作条为模板选择 + 刷新图标 + 亮蓝渐变大"复制"按钮；元信息 caption 移到卡片下方
- popup：上传区浅蓝 tint + 蓝色虚线框，历史卡片 16px 大圆角，语言徽标改蓝色 pill，主按钮亮蓝渐变
- 设置页：分组卡片 16px 大圆角无边框，logo 与主按钮亮蓝渐变，文字按钮蓝色，输入框 12px 圆角
- 移除未使用的 `panelTitle` locale key

### Fixed

- v0.3.0 代码审计修复并入本版（此前已在 main，未发版）：2 个 High 竞态（后台取消链误删新请求 AbortController；popup 连续上传旧任务清掉新任务 UI）、11 个 Medium（30MB 图片下载上限、下载阶段透传取消信号、400/413 友好错误、非 JSON 响应明确报错、Key 去控制字符、明文 HTTP 警告、运行时消息校验、popup 删除/清空确认 + 20MB 上传上限、Pointer Events 选区、a11y 修复、E2E 钩子仅 E2E 构建启用）、11 个 Low；审计报告见 docs/AUDIT-v0.3.0.md

## [0.3.0] — 2026-09-29

### Added

- 面板新增"刷新提示词"按钮（iOS 风格圆形图标按钮）：结果态可用，点击用相同语言/模板重新生成
- 面板结果底部新增元信息 caption：`模板名 · 字数`（次要信息弱化排版）
- loading 改为分阶段文案：`正在分析图片…` → `正在组织提示词细节…` → `快好了，正在润色…`，减少等待焦虑
- 刷新中图标持续旋转；错误态自动停止旋转

### Changed

- 全部 7 套内置模板重写为"穷尽式细节"要求：8 大维度全覆盖、至少 5 个二看细节、拒绝泛泛形容词、防复读
- 输出长度提示加长：中文 150–350 字 / 英文 120–250 词
- `max_tokens` 800 → 1500，容纳更长的详细输出

### Fixed

- E2E 发现：错误态分支未清除刷新按钮的 `spinning` 类，图标会一直转
- E2E 脚本 `verify-uifix.mjs`：固定 profile 残留上次运行的 Key 配置导致"未配 Key"断言失败，改为运行前清空 storage

### Added

- 快捷键 `Ctrl+Shift+Y`（Mac 上 `⌘+Shift+Y`）触发框选截图识别，可在 `chrome://extensions/shortcuts` 修改
- 设置页通用区显示快捷键提示
- 多服务商配置管理（新增 / 切换 / 单行测试连接）
- 提示词模板：内置通用 / 摄影 / 插画 / JSON 结构化模板，支持自定义增删改
- 框选截图识别（右键菜单入口）
- popup 拖放 / 上传本地图片识别
- 历史搜索 / 收藏
- 请求取消、结构化 JSON 输出渲染

## [0.1.0] — 2026-09-29

### Added

- 右键图片生成 AI 绘画提示词（真实视觉模型调用）
- 页内悬浮面板（Shadow DOM 样式隔离），一键复制
- 中英一键切换（复用已下载图片重新生成）
- BYOK：任意 OpenAI-compatible 视觉接口
- 设置页：API Key / Base URL / 模型 / 默认语言 / 连接测试
- 本地历史（最近 20 条），popup 查看 / 复制 / 一键清空
- GitHub Actions CI（lint / typecheck / format / test / build）
- tag 自动发版：构建 zip 并创建 GitHub Release
