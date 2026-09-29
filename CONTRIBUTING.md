# Contributing

## 开发流程
1. 从 `main` 切分支：`feat/xxx`、`fix/xxx`、`docs/xxx`
2. 改完跑全部门禁（缺一不可）：
   ```bash
   npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
   ```
3. 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)：
   `feat(...)` / `fix(...)` / `docs(...)` / `test(...)` / `refactor(...)` / `chore(...)`
4. 每一个功能动作都要有 git 记录，不允许无提交的改动上线

## 编码规范
- TypeScript 严格模式，注意 `noUncheckedIndexedAccess` 这类边界
- ESLint + Prettier 是强制门禁，提交前 `npm run format` 自动修
- UI 文案必须走 `chrome.i18n`，中英双语 key 同步加
- UI 配色遵循 Apple HIG 风格，**禁用紫 / 靛蓝 / 紫蓝渐变**
- 错误面向用户可读：底层异常统一包装为 `VisionApiError`

## 测试要求
- `src/lib` 的纯逻辑必须有单测（vitest），断言用行为/结构而非固定值（模型输出随机）
- 涉及 background / content 链路的改动，尽量在 `e2e/` 加验证步骤
- 真机 E2E 用真实 Chromium + 打包后的 `dist`，需要真实 API Key 的场景走 `verify-nvapi.mjs`
- 发现 bug 先写复现/验证，再修，提交信息里写清复现路径

## 版本与发布
- 版本号在 `package.json` 与 `src/manifest.json` 同步改，遵循 SemVer
- 发布：打 `v*.*.*` annotated tag 并 push，CI 自动构建 zip 创建 GitHub Release
- 发版前更新 `CHANGELOG.md` 的对应版本小节
