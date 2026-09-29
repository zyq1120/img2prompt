# img2prompt v0.3.0 代码审计报告

> 审计日期：2026-09-29。审计对象：`main` 分支 v0.3.0 tag 之后、至本报告提交前的全部改动。
> 审计方式：逐文件人工审查 + 单测/E2E 真机回归验证。报告中的修复均已提交，见下方"本次提交"。

## 结论

共发现并修复 **2 个 High（竞态）**、**11 个 Medium**、**11 个 Low**。质量门禁全部通过：
`typecheck` / `lint` / `format:check` / 单测 **102/102** / 生产构建验证 /
E2E 真机（真实 Chromium + 打包 dist）**verify 14/14、shortcut 4/4、v03 8/8、uifix 7/7、uifix2 3/3、
audit-popup 6/6**。

## High（已修复）

### H1. background 取消链路竞态（`src/background/service-worker.ts`）

旧请求 A 被新请求 B 取代并 abort 后，A 的 `catch` 会**误删 B 的控制器**并**误发取消消息**。
修复：清理前先校验 `tabAbortControllers.get(tabId) === abortController`，
被取代的旧请求静默退出，不再触碰新请求的状态。

### H2. popup 连续上传竞态（`src/popup/popup.ts`）

连续上传 A、B 时，A 的 `catch`/`finally` 会隐藏或清理 B 的 spinner、取消按钮和结果。
修复：只有当前 `uploadAborter === aborter` 的任务才能清理 UI；被取代的旧任务静默退出。

> 注：两个竞态的逻辑层有单测覆盖下载取消路径（`fetchImageAsDataUrl` abort），
> 完整的并发交错回归目前靠代码审查 + E2E 单链路验证，尚未做自动化并发 E2E（见"未覆盖"）。

## Medium（已修复）

| # | 问题 | 修复 |
|---|------|------|
| M1 | 图片下载无大小上限（恶意/超大图可撑爆内存） | `Content-Length` 声明超 30MB 直接拒绝；实际 `blob.size` 超 30MB 拒绝（`src/lib/api.ts`） |
| M2 | 下载 `fetch` 不支持取消，`signal` 未透传 | `fetchImageAsDataUrl` 接受 `signal` 并透传；取消时抛出"已取消本次请求"而非网络错误 |
| M3 | HTTP 200 但 body 非 JSON（如网关 HTML 错误页）误报"网络请求失败" | 新增 `parseJsonResponse`，给出"检查 Base URL / 兼容接口"的明确提示 |
| M4 | HTTP 400/413 只有通用文案 | 400→"检查模型配置"，413→"图片过大"（`friendlyHttpError`） |
| M5 | `IMG2PROMPT_GENERATE` 消息无运行时校验，`lang`/`templateId` 可注入任意值 | `lang` 仅接受 `zh`/`en`，`templateId` 必须为非空字符串 |
| M6 | popup 上传文件无大小上限 | 解码前拒绝 >20MB 文件（`fileToCompressedDataUrl`，`MAX_UPLOAD_BYTES`） |
| M7 | content script 重复 `executeScript` 会累积 message listener | 全局注入标记守卫，重复注入直接跳过 |
| M8 | provider Key 未清洗：首尾空格、复制粘贴带入的换行/制表符导致"Key 无效"假故障 | 新增 `cleanApiKey()`（trim + 剥离 `\r\n\t`），保存与测试连接均使用清洗后的 Key |
| M9 | 明文 `http://`（非 localhost）传输 Key 无任何提醒 | 新增 `isInsecureBaseUrl()`，测试连接成功后给出明文传输警告 |
| M10 | popup 历史"清空"无确认、不可逆 | 增加 `confirm`（含条数），明确作用范围为全部非收藏记录；新增单条删除（`deleteHistoryItem` + 确认） |
| M11 | 框选只支持鼠标事件，触屏/触控笔不可用；拖出区域松手收尾不可靠 | 改为 Pointer Events（`pointer capture`、`touch-action:none`、`pointercancel`、Esc 阻止冒泡） |

## Low（已修复）

- L1. popup/options 重复的 `truncate` 下沉到 `src/lib/text.ts`。
- L2. options 内层变量遮蔽 `testBtn` → 改名 `rowTestBtn`。
- L3. 删除 provider/自定义模板无确认 → 增加确认并明确 Key 一并删除；删除成功文案"已保存"→"已删除"。
- L4. `escapeHtml` 漏转单引号 → 补齐 `&#39;`。
- L5. 浅色次要文字 `#8e8e93` 白底对比度不足 → `#6e6e73`。
- L6. 语言按钮无 `aria-pressed`、面板无 `aria-live`、loading 无 `role="status"` → 补齐；关闭/刷新按钮 aria-label 本地化。
- L7. 搜索无匹配与真正无历史共用空状态 → 区分两种空状态。
- L8. popup 不监听 `chrome.storage.onChanged` → 跨页面改配置后自动刷新。
- L9. provider 表单缺校验（名称/Base URL/model 必填、Base URL 须为合法 http(s) URL）→ 补齐。
- L10. E2E hook 打包进生产构建 → `npm run build`（生产）与 `npm run build:e2e`（测试）分离，生产包经 grep 验证不含 `__img2promptE2E`。
- L11. `downscaleDataUrl` / `cropScreenshot` 解码异常裸奔 → 包装为用户可读错误。

## 本次新增测试

单测（75 → 102）：`parseJsonResponse` 非 JSON/合法 JSON、30MB 声明与实际大小拒绝、
下载取消语义、`signal` 透传、`isInsecureBaseUrl` 四象限、400/413 文案、
`deleteHistoryItem`、`cleanApiKey`、provider 保存清洗、上传 20MB 守卫、
`truncate`。另修复一个测试卫生问题：旧测试的 `vi.unstubAllGlobals()` 会清掉
全局 chrome stub，导致后续测试全部"chrome is not defined"——改为精准清理单个全局量。

E2E（新增 `e2e/verify-audit-popup.mjs` 6/6）：storage 外部写入后 popup 自动刷新、
单条删除按钮渲染与确认删除、清空"取消"保留/"确认"清空+空状态、搜索无匹配专用空状态。

## 仍未覆盖 / 待定

1. **`/models` 连接测试误报**：部分 OpenAI-compatible 服务不支持 `/models`，
   `testConnection()` 可能误报失败。未修，需产品决策（改用轻量 `chat/completions` 探测或允许跳过）。
2. **保存 provider 时的明文 HTTP 警告**：目前只在"测试连接"成功后提醒；保存时是否拦截/警告待定。
3. **并发竞态的自动化 E2E**：H1/H2 的真实并发交错尚未做自动化回归。
4. **JSON 模板偶发非法 JSON**（见 `docs/KNOWN-ISSUES.md`）：原始返回仍未抓到。
5. **host permissions 较宽**：功能需要（任意网页图片 + 用户自定义 Base URL），不建议缩减；
   上架时权限披露必须解释清楚。
6. 垃圾桶按钮目前用 `🗑` emoji，真机截图已确认显示正常；如后续要更贴 Apple 风格可换 SVG。

## 验证边界（与以往一致）

- headless 下无法点击原生右键菜单 UI，E2E 通过 `__img2promptE2E.handleMenuClick`
  调用与生产相同的业务函数；快捷键测试检查 manifest 注册而非 OS 级按键。
- `captureVisibleTab` 在 headless 下无真实 `activeTab` 手势，选区测试经 CDP 截图注入。
- `e2e/real-user-verify.mjs`（原生菜单/真实拖拽）仍是未完成状态，用户确认后才继续。
- 本次 E2E 首次跑时因沙盒 Chromium 未走出口代理导致 `example.com` 访问失败，
  属环境问题（`E2E_PROXY=http://127.0.0.1:18080` 后 14/14 通过），非产品回归。
- 真实 API 相关断言仍只做非空/状态变化检测（模型输出随机）。

## 本次提交

见 git log（Conventional Commits）。本轮所有改动均已提交并推送 `main`；
未创建新 tag / Release（需用户明确确认）。
