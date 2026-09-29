/**
 * UI 优化验证（无需 API Key）：真实 Chromium 加载 dist
 * 1. popup 空状态：未配 Key 时出现"去配置 API"按钮
 * 2. options 页：API Key 显示/隐藏切换正常工作
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

const browser = await chromium.launchPersistentContext('/tmp/e2e-uifix-profile', {
  executablePath: CHROME_BIN,
  headless: true,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--no-sandbox', '--disable-dev-shm-usage', `--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
});
const worker = browser.serviceWorkers()[0] ?? (await browser.waitForEvent('serviceworker'));
const extId = worker.url().split('/')[2];

// —— popup 空状态 ——
const popup = await browser.newPage();
await popup.setViewportSize({ width: 380, height: 600 });
await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
await popup.waitForTimeout(800);
const emptyVisible = await popup.$eval('#emptyState', (el) => !el.hidden);
const ctaVisible = await popup.$eval('#setupApiBtn', (el) => !el.hidden);
const ctaText = await popup.$eval('#setupApiBtn', (el) => el.textContent);
step('空状态显示', emptyVisible);
step('未配 Key 时出现配置按钮', ctaVisible, `文案="${ctaText}"`);
await popup.screenshot({ path: path.join(SHOTS, 'ui-popup-empty.png') });

// —— 反向边界：已配置 Key 时，配置按钮必须隐藏 ——
await worker.evaluate(async () => {
  // 新 profile 的 storage 是空的（默认只在内存合并），直接写入完整设置
  const settings = {
    providers: [
      {
        id: 'test',
        name: 'Test',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test-fake-key',
        model: 'gpt-4o',
      },
    ],
    activeProviderId: 'test',
    activeTemplateId: 'builtin:general',
    defaultLang: 'zh',
  };
  await chrome.storage.local.set({ 'img2prompt.settings': settings });
});
await popup.reload();
await popup.waitForTimeout(800);
const ctaHiddenWithKey = await popup.$eval('#setupApiBtn', (el) => el.hidden);
const emptyStillVisible = await popup.$eval('#emptyState', (el) => !el.hidden);
step('已配 Key 时配置按钮隐藏', ctaHiddenWithKey);
step('已配 Key 时空状态文案仍显示', emptyStillVisible);

// —— options Key 切换 ——
const options = await browser.newPage();
await options.setViewportSize({ width: 900, height: 700 });
await options.goto(`chrome-extension://${extId}/options/options.html`);
await options.waitForTimeout(500);
await options.click('#addProviderBtn');
await options.waitForTimeout(300);
const toggleVisible = await options.$eval('#toggleKeyBtn', (el) => !!el.offsetParent);
step('Key 切换按钮可见', toggleVisible);
const typeBefore = await options.$eval('#providerKey', (el) => el.type);
await options.click('#toggleKeyBtn');
await options.waitForTimeout(200);
const typeAfter = await options.$eval('#providerKey', (el) => el.type);
const btnText = await options.$eval('#toggleKeyBtn', (el) => el.textContent);
step('点击后 Key 明文显示', typeBefore === 'password' && typeAfter === 'text', `${typeBefore}→${typeAfter}，按钮="${btnText}"`);
await options.click('#toggleKeyBtn');
await options.waitForTimeout(200);
const typeBack = await options.$eval('#providerKey', (el) => el.type);
step('再次点击恢复隐藏', typeBack === 'password');
await options.screenshot({ path: path.join(SHOTS, 'ui-options-keytoggle.png') });

await browser.close();
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} 通过`);
process.exit(results.every(Boolean) ? 0 : 1);
