# Security Policy

## 支持的版本
| Version | Supported |
|---|---|
| 0.2.x | ✅ |
| 0.1.x | ✅ |
| < 0.1 | ❌ |

## 报告漏洞
请**不要**在公开 issue 中披露漏洞细节。请通过 GitHub 仓库的 **Security → Report a vulnerability**（Private vulnerability reporting）提交，我们会尽快确认并修复。

请在报告中包含：
- 漏洞描述与影响范围
- 复现步骤（越具体越好）
- 你的环境（浏览器版本、扩展版本）

## 隐私设计
- API Key 与所有用户数据只保存在浏览器本地 `chrome.storage`，不上传任何服务器（本项目无服务端）
- 图片仅在用户主动触发识别时，发往用户自己在设置页配置的 AI 接口
- 完整说明见 [隐私政策](store/PRIVACY.md)
