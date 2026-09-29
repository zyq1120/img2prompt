# Chrome Web Store 提交清单

## 已准备好的材料（本目录）
| 材料 | 文件 | 状态 |
|---|---|---|
| 扩展包 | `img2prompt-v0.2.0.zip`（仓库根目录，gitignored） | ✅ 已构建（含快捷键功能） |
| 商店文案（中英） | `store/LISTING.md` | ✅ |
| 隐私政策（中英） | `store/PRIVACY.md` | ✅ |
| 截图 1280×800 ×3 | `store/screenshots/` | ✅ |
| 小宣传图 440×280 | `store/promo-small-440x280.png` | ✅ |
| 商店图标 128×128 | `src/assets/icons/icon-128.png` | ✅ |

## 需要你亲自做的步骤

### 1. 注册开发者账号（一次性）
- 打开 https://chrome.google.com/webstore/devconsole
- 用 Google 账号登录，支付 **$5 一次性注册费**（需信用卡）
- 完成开发者身份验证

### 2. 托管隐私政策（需公开 URL）
把 `store/PRIVACY.md` 放到一个可公开访问的 URL，例如：
`https://github.com/zyq1120/img2prompt/blob/main/store/PRIVACY.md`
（仓库是 private 的话需改公开，或用 GitHub Pages / 个人站点托管）

### 3. 新建商品并上传
- Developer Dashboard → New Item → 上传 `img2prompt-v0.2.0.zip`
- 商店图标：上传 `icon-128.png`

### 4. 填写商店信息（从 `LISTING.md` 复制）
- 标题、简短介绍、详细介绍（中文）
- 类别：生产力工具 / Productivity
- 语言：中文（简体）、English

### 5. 上传图片素材
- 截图：`store/screenshots/` 下 3 张（1280×800）
- 小宣传图：`store/promo-small-440x280.png`（440×280，必填）

### 6. 隐私与权限披露
- Privacy policy URL：填第 2 步的公开链接
- Single purpose（一句话用途）：
  中文：在网页图片上右键或按快捷键，调用用户自备的 AI 视觉接口生成绘画提示词。
  English: Right-click any web image or press a shortcut to generate an art prompt via the user's own AI vision endpoint.
- Host 权限理由（`https://*/*`）：用于下载用户右键点击的跨域图片，以及请求用户自己在设置页配置的 AI 接口。本地存储 API Key，不上传任何数据。

### 7. 提交审核
- Submit for review。首次审核通常需要几天。
- 审核通过后商店页即上线；后续更新只需上传新 zip 发新版。

## 注意事项
- 商店包与 GitHub Release 包是同一构建产物（`npm run build -- --zip`），版本号来自 manifest。
- 以后每次发版：改代码 → 升版本 → 打 tag → GitHub Release 自动出包 → 用同一 zip 更新商店。
