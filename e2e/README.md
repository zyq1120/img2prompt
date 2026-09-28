# E2E 真机验证（img2prompt）

用真实 Chromium + 打包后的 `dist/` 扩展，跑通“右键菜单 → 悬浮面板 → 模型请求”完整链路。
原生浏览器右键菜单 UI 在 headless 环境下无法直接点击，因此脚本通过 Service Worker 暴露的
`__img2promptE2E.handleMenuClick(tabId, imageUrl)` 钩子触发**与右键菜单完全相同的业务函数**
（见 `src/background/service-worker.ts` 末尾），覆盖：注入 content script → 打开面板 →
下载/压缩图片 → 读配置调模型 → 推送 loading / result / error。

## 前置条件

1. 先构建扩展：`npm run build`
2. 安装 `playwright-core`（仓库未收录，运行前需自行安装）：`npm i -D playwright-core`
3. 需要一个 Chromium 可执行文件：设置 `E2E_CHROME`，或放在常见路径
   （`/usr/bin/chromium`、`/Applications/Google Chrome.app/...` 等，脚本会自动探测）
4. 需要互联网访问（下载 picsum 测试图、请求 api.openai.com）。
   若环境需要代理：`E2E_PROXY=http://host:port`；
   若代理需要“预先鉴权”（如本沙盒的 egress 代理），可先起本目录的转发代理：
   `https_proxy=http://user:pass@proxy:port node e2e/fwd-proxy.mjs`，
   再 `E2E_PROXY=http://127.0.0.1:18080 node e2e/verify.mjs`。
   代理凭据只从环境变量读取，不会写入仓库。

## 运行

```bash
npm run build
node e2e/verify.mjs
```

常用环境变量：

| 变量 | 说明 |
|---|---|
| `E2E_EXT_DIR` | 扩展目录，默认 `e2e/../dist` |
| `E2E_CHROME` | Chromium 可执行文件路径 |
| `E2E_PROXY` | 代理，如 `http://127.0.0.1:18080`（留空直连） |
| `E2E_SHOTS` | 截图输出目录，默认 `e2e/shots` |
| `E2E_PROFILE` | Chromium profile 目录（默认每次新建临时目录） |
| `E2E_PLAYWRIGHT_ANCHOR` | 找不到 `playwright-core` 时的回退解析锚点 |

## 验证项（2026-09-28 全量通过，14/14）

- 扩展加载并拿到扩展 ID；MV3 Service Worker 正常启动
- 设置页默认值正确（Base URL `https://api.openai.com/v1` / Model `gpt-4o` / Language `zh`），保存有反馈
- Popup 空历史状态正常
- 真实链路：SW 下载并压缩公网图片 → 未填 Key 时中文报错 + “前往设置”按钮
- 填入**无效 Key**后触发**真实 OpenAI 401**，面板正确映射为中文错误
  （测试 Key `sk-test-invalid-key-12345` 仅存在于临时 Chromium profile，未进入仓库）
- 中/EN 切换重新请求并高亮当前语言
- “前往设置”按钮打开选项页
- 结果态复制按钮：剪贴板真实写入，点击后按钮显示“已复制/Copied”
- 面板关闭按钮；整个过程 SW 无未捕获异常

截图见 `e2e/shots/`（`06-panel-error-401.png` 为真实 401 错误态）。

## 曾发现并已修复的真实 bug

复制按钮的点击处理器在 `await copyText()` 之后才读取 `event.currentTarget`，
此时事件对象已被浏览器回收，`currentTarget` 为 `null`，导致抛出
`TypeError: Cannot read properties of null (reading 'textContent')`，
“已复制”反馈永远不显示（复制本身成功）。已在
`src/content/content-script.ts` 修复：`await` 之前先捕获按钮引用。
