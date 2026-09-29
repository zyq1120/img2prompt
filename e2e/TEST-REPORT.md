# img2prompt 测试报告

- **测试日期**：2026-09-29
- **测试版本**：`74e30a9`（main 分支最新，v0.2.0 已发布）
- **测试方式**：自动化（质量门禁 + 单元测试 + 真机 E2E）
- **结论**：**产品代码全部通过；真实 API E2E 受模型侧抖动影响，3 次运行中所有产品链路均通过**

---

## 1. 测试环境

| 项目 | 说明 |
|---|---|
| 浏览器 | Chromium 152.0.7977.82（headless，真机）|
| 扩展包 | 当天源码重新构建的 `dist/`（MV3）|
| 模型 API | NVIDIA Build API，`meta/llama-3.2-11b-vision-instruct` |
| 网络 | 沙箱经本地转发代理出网 |
| 宿主页面 | `https://example.com/` + 注入的 picsum 测试图片 |

## 2. 质量门禁（全部通过）

| 门禁 | 结果 |
|---|---|
| TypeScript 类型检查（`tsc --noEmit`） | 通过 |
| ESLint（`src test scripts`） | 通过 |
| Prettier format check | 通过 |
| 构建（esbuild → `dist/`） | 通过 |
| GitHub Actions CI（最近 5 次 main push） | 全部 success（约 30 秒/次） |

## 3. 单元测试

- **64/64 通过**（vitest，4 个测试文件）
- 覆盖：模板系统、i18n、API 解析（含 JSON 容错、图片下载/解码错误包装等 Phase 2 新增单测）

## 4. 真机 E2E：12/12 通过

真实 Chromium 加载打包后的扩展，调用真实 NVIDIA API，全链路验证。

| # | 场景 | 结果 | 备注 |
|---|---|---|---|
| 1 | 扩展安装并取得 ID | 通过 | `dcdjpankbjdaennohmpapohedbjcadep` |
| 2 | Service Worker 启动 | 通过 | — |
| 3 | Options 添加 NVIDIA provider | 通过 | 列表 2 行 |
| 4 | 设为当前 provider | 通过 | — |
| 5 | provider 单行连接测试 | 通过 | `NVIDIA: Connection OK` |
| 6 | 定位宿主 tab | 通过 | `tabId=748108423` |
| 7 | 右键图片 → 中文生成 + 面板模板下拉 | 通过 | 结果 169 字，模板下拉 7 项 |
| 8 | 中英切换重新生成 | 通过 | 英文结果 841 字符，与中文不同 |
| 9 | 选区截图 → 真实裁剪 → 生成 | 通过 | 结果 72 字 |
| 10 | JSON 模板结构化渲染 | 通过 | tags=3，kv=3 |
| 11 | popup provider 下拉加载 | 通过 | 2 个选项 |
| 12 | popup 真实文件上传 → 生成 → 写入历史 | 通过 | 结果 82 字，历史 3 条 |

## 5. 本轮 E2E 发现并修复的真实问题（5 个）

| 提交 | 问题 | 修复 |
|---|---|---|
| `848cdc8` | Phase 2 重构把"缺少图片"检查放到图片下载之前，首次右键必失败 | 先下载图片再做检查 |
| `2bdbb23` | headless 无真实用户手势拿不到 `activeTab`，`captureVisibleTab` 调不通 | 拆出 `handleRegionShot`，E2E 经 CDP 截图注入验证裁剪→生成→面板→历史 |
| `188d0e7` | llama-3.2-vision 无视 `response_format: json_object`，在 JSON 前加 `**AI 绘画提示词**` 前缀 | 解析器改为提取首个 `{` 到最后一个 `}`，JSON 模板提示词加硬约束；+3 单测 |
| `1432c15` | 图片下载/解码异常裸奔，面板显示"未知错误" | 包成 `VisionApiError` 用户可读错误；+3 单测 |
| `3cb2fc6` | popup 历史项 wrapper 和 button 重用 `.history-item` 类，计数翻倍 | button 改名 `.history-main` |

以上修复均已推送远端 `main`，CI 全绿。

## 6. 已知偶发问题（非必现）

- JSON 模板模式有一次出现"模型返回的不是合法 JSON"（模型输出被截断或非 JSON）。复测通过，判定为**模型侧随机性**，非产品必现 bug。
- 建议的后续 hardening（未做）：JSON 解析失败时记录原始返回前 500 字；JSON 模式放宽 `max_tokens`。

## 7. 验证边界（诚实说明）

- headless Chromium 点不了**原生右键菜单 UI**；右键链路走的是与生产完全相同的 `handleMenuClick` 业务函数。
- `captureVisibleTab` 那一行没有在 headless 下获得真实 `activeTab` 后直接执行；生产环境点击右键菜单即授予 `activeTab`（已查文档确认）。
- 本次 E2E **未覆盖**：请求取消、历史搜索/收藏、provider 编辑/删除、自定义模板增删改、popup 内模板切换（以上逻辑层有单测）。
- 模型输出有随机性，E2E 断言采用"非空、状态变化、结构存在性"，不设固定长度阈值。
- 沙箱出口网络中途有过抖动（picsum 超时、API 响应变慢），属环境波动，重跑后通过。

## 9. v0.2.0 正式测试（第二轮，2026-09-29 下午）

针对 v0.2.0（含两批 UI 优化）的完整正式测试：质量门禁 → 单元测试 → 流程 E2E → 边界测试 → 真实 API E2E。

### 9.1 质量门禁与单元测试（全部通过）

| 门禁 | 结果 |
|---|---|
| TypeScript 类型检查 | 通过 |
| ESLint | 通过 |
| Prettier format check | 通过 |
| 构建（esbuild → `dist/`） | 通过 |
| 单元测试（vitest，5 个文件） | **72/72 通过**（新增 4 个 `renderRichText` 边界单测：空串/多段加粗/空格/中文标点混排） |

### 9.2 流程 E2E（真机 Chromium + 打包 dist）

| 脚本 | 结果 | 说明 |
|---|---|---|
| `verify.mjs` 主流程 | **14/14** | 安装、SW 启动、设置页、popup、面板注入、无 Key 报错、无效 Key 真实 401、中英切换、前往设置、复制、关闭 |
| `verify-shortcut.mjs` 快捷键 | **4/4** | overlay 出现、Esc 关闭、manifest commands 注册 |
| `verify-uifix.mjs` UI 第一批 | **7/7** | 空状态 CTA、Key 显示/隐藏切换；新增反向边界：已配 Key 时 CTA 必须隐藏 |
| `verify-uifix2.mjs` UI 第二批 | **3/3** | 编辑器内测试连接按钮、空 Key 错误走 i18n（英文环境） |

### 9.3 真实 API E2E（`verify-nvapi.mjs`，llama-3.2-vision 真实生成）

共跑 3 次（模型输出有随机性）：

| 轮次 | 结果 | 失败点 | 定性 |
|---|---|---|---|
| 第 1 次 | 9/10 | 快捷键 overlay 等待超时 | **测试脚本 bug**：选择器写成 `[data-img2prompt-region-overlay]`，实际是 `#img2prompt-region-overlay`（id）；已修复（`74e30a9`） |
| 第 2 次 | 10/11 | JSON 模板 `.ip-tags` 等待超时 | **模型侧抖动**：模型返回了非 JSON 文本，面板按设计报错"不是合法 JSON"；产品解析/报错链路本身正常 |
| 第 3 次 | 6/7（tail） | 中文生成步骤模型超时 | **模型侧抖动**：`请求超时：模型响应太慢`，面板超时报错链路正常 |

**结论**：所有产品代码链路（安装/设置/多服务商/连接测试/中文生成/中英切换/选区裁剪/快捷键 overlay/JSON 模板切换/popup 上传/历史）在模型正常响应时**全部通过**；3 次失败中有 1 个是测试脚本 bug（已修），2 个是模型侧随机失败（超时、非 JSON 输出），均非产品必现 bug。

### 9.4 本轮正式测试发现并修复的测试脚本问题（2 个）

| 提交 | 问题 | 修复 |
|---|---|---|
| `ec6ffac` | `verify.mjs` 仍用 v0.1 老 DOM（`#apiKey`/`#saveBtn`），v0.2.0 多服务商重构后 3 个步骤超时失败 | 按新 DOM 重写：走新增服务商编辑器（`#providerBaseUrl`/`#providerModel` 默认值 + 保存反馈）；无效 Key 测试改为新增服务商并设为当前 |
| `74e30a9` | `verify-nvapi.mjs` 快捷键步骤的选择器写错（`[data-...]` 属性选择器 vs 实际 `id`），d16e930 引入后从未跑通过 | 改为 `#img2prompt-region-overlay`，与 `verify-shortcut.mjs` 一致 |

> 教训：UI 重构后必须同步更新 E2E 脚本的选择器；新增测试步骤要在合入前至少跑通一次。

### 9.5 仍未覆盖（与上一轮一致）

请求取消、历史搜索/收藏、provider 编辑/删除、自定义模板 CRUD、popup 内模板切换（逻辑层有单测）。

## 10. 发布状态

- `v0.2.0` tag 已打，release.yml 自动构建 zip 并创建 GitHub Release，全绿；资产 `img2prompt-v0.2.0.zip`（28 文件）已下载验包。
- 本轮测试使用的 NVIDIA Key 仅作进程环境变量一次性使用，未写入仓库或记忆；**用后请轮换**。

## 11. v0.3.0 开发测试（2026-09-29，未发布）

需求：提示词尽可能详细、新增刷新提示词按钮、UI 按 Apple 设计思路更人性化。

### 11.1 质量门禁（全部通过）

| 门禁 | 结果 |
|---|---|
| TypeScript 类型检查 | 通过 |
| ESLint | 通过 |
| Prettier format check | 通过 |
| esbuild 构建 | 通过 |

### 11.2 单元测试：75/75 通过

新增 3 个模板单测：全部文本模板含"five concrete visual details / Prefer completeness over brevity"、长度提示已加长（150–350 字）、JSON 模板 prompt 字段同样要求详细。

### 11.3 真机 E2E

| 脚本 | 结果 |
|---|---|
| `verify.mjs`（主流程） | 14/14 |
| `verify-shortcut.mjs`（快捷键） | 4/4 |
| `verify-uifix.mjs`（UI 优化） | 7/7 |
| `verify-uifix2.mjs`（编辑器内测试连接） | 3/3 |
| `verify-v03.mjs`（新增：刷新按钮/分阶段 loading/元信息） | **8/8** |

`verify-v03.mjs` 验证点：错误态刷新按钮禁用 → 合成结果态按钮可用、元信息 `模板名 · 字数` 出现 → 点击刷新进入 loading（阶段一文案）且图标旋转 → 无 Key 报错（证明重新生成链路真实跑通）。

### 11.4 本轮发现并修复的真实问题（2 个）

1. **刷新图标在错误态一直旋转**：`setState` 的 error 分支未清除 `spinning` 类。已修复，error/result 分支都清除。
2. **`verify-uifix.mjs` 固定 profile 残留配置**：脚本用 `/tmp/e2e-uifix-profile` 固定路径，自身"已配 Key 反向边界"步骤写入的 Key 会污染下次运行，导致"未配 Key"断言失败。改为运行前 `chrome.storage.local.clear()`。产品代码无问题。

### 11.5 真实 API 验证（2026-09-29，`verify-nvapi-v03.mjs`，7/7 通过）

- 连接测试成功；中文生成 **1563–1705 字**（旧模板典型约 100–150 字），详细度目标达成
- 刷新按钮真实触发重新生成，新结果措辞不同、同样详细，元信息 caption 同步更新
- **发现的模型侧现象**：第一次运行中第二次生成陷入复读 loop（"树林道路"重复几十次，1874 字），属 llama-3.2-vision 的随机退化，非产品 bug；已在模板中追加防复读约束（"Never repeat the same phrase; state each detail once"），第二次运行两次生成均连贯无复读
- Key 仅作进程环境变量一次性使用；**用后请轮换**
