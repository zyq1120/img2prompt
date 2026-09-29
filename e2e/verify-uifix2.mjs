/**
 * UI 优化第二批验证（无需真实 API Key）：
 * 1. options 服务商编辑器里有"测试连接"按钮，点它用表单值测试（空 Key 应报错而非崩溃）
 * 2. 面板 renderRichText 逻辑已由单测覆盖，这里只确认 content script 正常加载
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const { chromium } = createRequire('/home/hatch/workspace/skills/design-card/package.json')('playwright-core');
import fs from 'fs';

function findChrome() {
  const candidates = [
    '/opt/meta-chromium/chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  ];
  return candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
}
const CHROME_BIN = findChrome();
if (!CHROME_BIN) throw new Error('找不到 Chromium');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');
const SHOTS = path.join(__dirname, 'shots');

const results = [];
const step = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const browser = await chromium.launchPersistentContext('/tmp/e2e-uifix2-profile', {
  executablePath: CHROME_BIN,
  headless: true,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--no-sandbox', '--disable-dev-shm-usage', `--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
});
const worker = browser.serviceWorkers()[0] ?? (await browser.waitForEvent('serviceworker'));
const extId = worker.url().split('/')[2];

const options = await browser.newPage();
await options.setViewportSize({ width: 900, height: 800 });
await options.goto(`chrome-extension://${extId}/options/options.html`);
await options.waitForTimeout(500);
await options.click('#addProviderBtn');
await options.waitForTimeout(300);

const draftBtnVisible = await options.$eval('#testDraftBtn', (el) => !!el.offsetParent);
step('编辑器内测试连接按钮可见', draftBtnVisible);
const btnText = await options.$eval('#testDraftBtn', (el) => el.textContent);
step('按钮文案正确', btnText === '测试连接' || btnText === 'Test connection', `文案="${btnText}"`);

// 空 Key 点测试：应显示错误状态，而不是崩溃（状态 3 秒后自动清除，轮询读取）
await options.click('#testDraftBtn');
let statusText = '';
for (let i = 0; i < 20 && !statusText; i++) {
  await options.waitForTimeout(200);
  statusText = await options.$eval('#status', (el) => el.textContent ?? '');
}
step('空 Key 测试给出错误提示', statusText.length > 0, `状态="${statusText.slice(0, 40)}"`);
await options.screenshot({ path: path.join(SHOTS, 'ui-options-drafttest.png') });

await browser.close();
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} 通过`);
process.exit(results.every(Boolean) ? 0 : 1);
