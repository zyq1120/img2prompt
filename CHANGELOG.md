# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/)，版本号遵循 [SemVer](https://semver.org/)。

## [Unreleased]

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
