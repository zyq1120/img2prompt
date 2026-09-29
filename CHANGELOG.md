# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/)，版本号遵循 [SemVer](https://semver.org/)。

## [Unreleased]

## [0.2.0] — 开发中
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
