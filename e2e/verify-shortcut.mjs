/**
 * 快捷键链路轻量验证（无需 API Key）：
 * 真实 Chromium 加载 dist → 经 E2E 钩子调用与快捷键完全相同的
 * triggerRegionSelectCommand → 断言框选 overlay 出现 → Esc 关闭。
 * （系统级按键本身由 Chrome 分发，headless 无法合成，故走同一处理函数。）
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
const E2E_PROXY = process.env.E2E_PROXY || '';

const results = [];
const step = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const browser = await chromium.launchPersistentContext('/tmp/e2e-shortcut-profile', {
  executablePath: CHROME_BIN,
  headless: true,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--ignore-certificate-errors',
    ...(E2E_PROXY ? [`--proxy-server=${E2E_PROXY}`] : []),
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
  ],
});
const worker = browser.serviceWorkers()[0] ?? (await browser.waitForEvent('serviceworker'));
const extId = worker.url().split('/')[2];
const page = await browser.newPage();
await page.goto('https://example.com/');
await page.waitForTimeout(1500); // 等 content script 注入

// 通过 service worker 拿到宿主 tab 的真实 tabId
const realTabId = await worker.evaluate(async () => {
  const tabs = await chrome.tabs.query({ url: 'https://example.com/*' });
  return tabs[0]?.id;
});
step('定位宿主 tab', typeof realTabId === 'number', `tabId=${realTabId}`);

// 触发与快捷键完全相同的处理函数
await worker.evaluate(async () => {
  await globalThis.__img2promptE2E.triggerRegionSelectCommand();
});
await page.waitForSelector('#img2prompt-region-overlay', { timeout: 15000 });
step('快捷键链路：框选 overlay 出现', true);
await page.screenshot({ path: path.join(SHOTS, 'shortcut-overlay.png') });

// Esc 关闭 overlay
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
const gone = await page.evaluate(() => !document.querySelector('#img2prompt-region-overlay'));
step('Esc 关闭 overlay', gone);

// manifest 中 commands 已注册
const hasCmd = await worker.evaluate(async () => {
  const cmds = await chrome.commands.getAll();
  return cmds.some((c) => c.name === 'region-select');
});
step('manifest commands 注册成功', hasCmd, 'region-select');

await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n==== 结果：${passed}/${results.length} 通过 ====`);
process.exit(passed === results.length ? 0 : 1);
