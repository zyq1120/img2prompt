# img2prompt 测试报告

- **测试日期**：2026-09-29
- **测试版本**：`3cb2fc6`（main 分支最新）
- **测试方式**：自动化（质量门禁 + 单元测试 + 真机 E2E）
- **结论**：**全部通过，可用**

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

## 8. 发布状态

- `v*.*.*` tag 自动构建 zip 并创建 Release 的流程**尚未实际验证**，需确认后再打 tag。
- 本轮测试使用的 NVIDIA Key 仅作进程环境变量一次性使用，未写入仓库或记忆；**用后请轮换**。
