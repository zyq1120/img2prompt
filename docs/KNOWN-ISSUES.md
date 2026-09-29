# 已知问题与限制（Known Issues）

> 更新日期：2026-09-29。修好一项就删一项。

## 偶发问题
- **JSON 模板偶发"返回的不是合法 JSON"**：部分模型会无视 `response_format` 或输出被截断。已做容错（提取首个 `{` 到最后一个 `}`），仍失败时重试一次即可。计划中的 hardening：失败时记录原始返回、放宽 `max_tokens`。

## 平台限制
- **`chrome://` 系统页面无法使用**：Chrome 不允许扩展向系统页面注入脚本，右键菜单/面板在这些页面不生效。这是浏览器限制，无解。
- **快捷键可能与浏览器/其他扩展冲突**：可在 `chrome://extensions/shortcuts` 中修改。

## 验证边界（测试相关，非产品缺陷）
- headless 环境无法点击原生右键菜单 UI，E2E 走与生产相同的处理函数验证链路。
- `captureVisibleTab` 在 headless 下无真实 `activeTab` 手势，E2E 经 CDP 截图注入验证裁剪→生成链路。
- 以下功能有单测覆盖但尚未做真机 E2E：请求取消、历史搜索/收藏、provider 编辑/删除、自定义模板增删改、popup 内模板切换。

## 待办
- [ ] JSON 失败 hardening（记原始返回、放宽 max_tokens、失败自动重试一次）
- [ ] 补齐上述未覆盖项的真机 E2E
- [ ] 原生右键菜单真实点击验证（Xvfb 有界面方案，`e2e/real-user-verify.mjs` 未完成）
