# Privacy Policy — img2prompt

Last updated: 2026-09-29

## 中文

img2prompt 是一款浏览器扩展，用于将网页图片转换为 AI 绘画提示词。我们非常重视你的隐私。

### 我们收集什么
**我们不收集、不存储、不传输任何个人数据到我们自己的服务器**——因为我们没有服务器。

### 数据存储
- 你的 API Key、Base URL、模型配置、自定义模板、历史记录、收藏：全部保存在你浏览器本地的 `chrome.storage` 中，只存在你的设备上。
- 卸载扩展后，以上本地数据会被浏览器一并清除。

### 数据传输
- 仅当你主动触发一次识别（右键图片 / 快捷键框选 / popup 上传）时，扩展会把**该次的图片**发送到**你自己在设置页配置的 AI 接口**（例如 OpenAI 或你填写的第三方 / 本地接口），用于生成提示词。
- 除此之外，扩展不会向任何第三方发送任何数据。

### 权限说明
- `contextMenus`：在图片 / 页面上添加右键菜单项。
- `activeTab` / `scripting`：在当前标签页注入结果面板与框选 overlay。
- `storage`：在本地保存你的配置与历史。
- `https://*/*` 主机权限：下载你右键点击的图片（跨域图片需经扩展下载），以及请求你配置的 AI 接口。

### 联系方式
如有隐私问题，请通过 GitHub 仓库提交 issue。

---

## English

img2prompt is a browser extension that turns web images into AI art prompts. We take your privacy seriously.

### What we collect
**We do not collect, store, or transmit any personal data to our own servers** — we have none.

### Data storage
- Your API keys, base URLs, model settings, custom templates, history, and favorites are stored exclusively in your browser's local `chrome.storage`, on your device only.
- Uninstalling the extension removes this local data.

### Data transmission
- Only when you actively trigger a recognition (right-click an image / shortcut region select / popup upload) does the extension send **that image** to **the AI endpoint you configured** in settings (e.g. OpenAI or a third-party / local endpoint you entered), to generate the prompt.
- The extension sends no data to any other third party.

### Permissions
- `contextMenus`: adds right-click menu items on images / pages.
- `activeTab` / `scripting`: injects the result panel and region-select overlay into the current tab.
- `storage`: stores your settings and history locally.
- `https://*/*` host permissions: downloads the image you right-clicked (cross-origin images must be fetched by the extension) and calls your configured AI endpoint.

### Contact
For privacy questions, please open an issue on the GitHub repository.
