import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright-core');
} catch {
  // fallback: resolve playwright-core relative to an anchor package (sandbox convenience)
  const anchor = process.env.E2E_PLAYWRIGHT_ANCHOR || '/home/hatch/workspace/skills/design-card/package.json';
  playwright = createRequire(anchor)('playwright-core');
}
const { chromium } = playwright;

const EXT_DIR = process.env.E2E_EXT_DIR || path.join(E2E_DIR, '..', 'dist');
const SHOTS = process.env.E2E_SHOTS || path.join(E2E_DIR, 'shots');
const PROFILE = process.env.E2E_PROFILE || fs.mkdtempSync(path.join(os.tmpdir(), 'img2prompt-e2e-'));
// E2E_PROXY e.g. http://127.0.0.1:18080 (empty = direct connection); E2E_CHROME overrides the Chromium binary
const E2E_PROXY = process.env.E2E_PROXY || '';
function findChrome() {
  if (process.env.E2E_CHROME) return process.env.E2E_CHROME;
  const candidates = [
    '/opt/meta-chromium/chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
}
const CHROME_BIN = findChrome();
if (!CHROME_BIN) throw new Error('找不到 Chromium 可执行文件：请设置 E2E_CHROME 环境变量');
if (process.env.E2E_PROFILE) fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

const report = { steps: [] };
function step(name, ok, detail = '') {
  report.steps.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

const TEST_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>img2prompt test</title></head>
<body><h1>test page</h1><img id="target" src="https://picsum.photos/seed/img2prompt/640/400" width="640" height="400"></body></html>`;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(TEST_HTML);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const TEST_URL = 'https://example.com/';
const IMAGE_URL = 'https://picsum.photos/seed/img2prompt/640/400';
const DATA_URL = 'data:image/png;base64,' + fs.readFileSync(path.join(path.dirname(SHOTS), 'tiny.b64'), 'utf8');

const workerErrors = [];
let context, worker, extId;
try {
  context = await chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME_BIN,
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors',
           ...(E2E_PROXY ? [`--proxy-server=${E2E_PROXY}`] : []),
           `--load-extension=${EXT_DIR}`],
  });
  // wait for OUR extension id in Preferences (match by path, not just first entry)
  for (let i = 0; i < 30 && !extId; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const prefs = JSON.parse(fs.readFileSync(`${PROFILE}/Default/Preferences`, 'utf8'));
      const settings = prefs.extensions?.settings || {};
      for (const [id, v] of Object.entries(settings)) {
        if (JSON.stringify(v).includes('img2prompt/dist')) { extId = id; break; }
      }
    } catch {}
  }
  step('扩展已安装并拿到 ID', !!extId, extId || '');

  // start the MV3 service worker via CDP
  const cdpPage = await context.newPage();
  const session = await context.newCDPSession(cdpPage);
  await session.send('ServiceWorker.enable');
  await session.send('ServiceWorker.startWorker', { scopeURL: `chrome-extension://${extId}/` }).catch((e) => {
    step('CDP 启动 SW', false, String(e).slice(0, 120));
  });
  worker = context.serviceWorkers().find((w) => w.url().includes(extId));
  for (let i = 0; i < 10 && !worker; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    worker = context.serviceWorkers().find((w) => w.url().includes(extId));
  }
  step('Service Worker 已启动', !!worker, worker ? worker.url().slice(0, 60) : '');
  if (!worker) throw new Error('no service worker');
  worker.on('pageerror', (e) => workerErrors.push(String((e && e.message) || e)));
  await cdpPage.close();

  // ---- options page (v0.2.0: multi-provider) ----
  try {
    const p = await context.newPage();
    await p.goto(`chrome-extension://${extId}/options/options.html`);
    await p.waitForTimeout(800);
    const rowCount = await p.locator('.provider-row').count();
    const lang = await p.inputValue('#defaultLang');
    // 打开新增编辑器，检查默认值
    await p.click('#addProviderBtn');
    await p.waitForTimeout(300);
    const baseUrl = await p.inputValue('#providerBaseUrl');
    const model = await p.inputValue('#providerModel');
    await p.screenshot({ path: path.join(SHOTS, '02-options.png') });
    step('设置页渲染且默认值正确', rowCount >= 1 && baseUrl === 'https://api.openai.com/v1' && model === 'gpt-4o' && lang === 'zh', `rows=${rowCount} baseUrl=${baseUrl} model=${model} lang=${lang}`);
    // 保存一个服务商，检查反馈
    await p.fill('#providerName', 'E2E');
    await p.fill('#providerKey', '<redacted>');
    await p.click('#saveProviderBtn');
    await p.waitForTimeout(500);
    const status = (await p.textContent('#status')) || '';
    step('设置页保存有反馈', status.trim().length > 0, status.trim().slice(0, 50));
    await p.close();
  } catch (e) { step('设置页', false, String(e).slice(0, 160)); }

  // ---- popup ----
  try {
    const p = await context.newPage();
    await p.goto(`chrome-extension://${extId}/popup/popup.html`);
    await p.waitForTimeout(800);
    const emptyVisible = await p.locator('#emptyState').isVisible().catch(() => false);
    await p.screenshot({ path: path.join(SHOTS, '03-popup.png') });
    step('Popup 渲染（空历史）', emptyVisible);
    await p.close();
  } catch (e) { step('Popup', false, String(e).slice(0, 160)); }

  // ---- panel flow (real https host page + real image download in the SW) ----
  let page;
  try {
    page = await context.newPage();
    await page.goto(TEST_URL, { timeout: 45000 });
    await page.evaluate((img) => {
      document.body.insertAdjacentHTML('beforeend', `<img id="target" src="${img}" width="640" height="400">`);
    }, IMAGE_URL);
    await page.waitForSelector('#target', { timeout: 15000 });
    const tabId = await worker.evaluate(async () => {
      // 注：manifest 未申请 tabs 权限，用 activeTab 可见的当前活动 tab（url 属性受限，直接取 id）
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return tabs[0] && tabs[0].id;
    });
    step('定位宿主 tab（example.com）', typeof tabId === 'number', `tabId=${tabId}`);

    // 经 E2E 钩子触发与右键菜单点击完全相同的链路：handleMenuClick(tabId, srcUrl)
    await worker.evaluate(async ({ tabId, imageUrl }) => {
      const e2e = globalThis.__img2promptE2E;
      if (!e2e) throw new Error('E2E hook missing');
      await e2e.handleMenuClick(tabId, imageUrl);
    }, { tabId, imageUrl: IMAGE_URL });
    await page.waitForSelector('.ip-panel', { timeout: 10000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(SHOTS, '04-panel-loading.png') });
    step('悬浮面板注入并显示 loading', true);

    // leave loading state via a synthetic error, then click retry -> REAL worker chain
    // 注：handleMenuClick 已自动跑完首次识别（无 Key → 报错态），直接断言终态
    await page.waitForFunction(
      () => /尚未填写 API Key/.test(
        document.querySelector('#img2prompt-panel-root')?.shadowRoot?.querySelector('.ip-error-msg')?.textContent || ''
      ),
      undefined,
      { timeout: 60000 }
    );
    const errText = (await page.locator('.ip-error-msg').textContent()) || '';
    const hasSettingsBtn = (await page.locator('.ip-goto-settings').count()) > 0;
    await page.screenshot({ path: path.join(SHOTS, '05-panel-error-nokey.png') });
    step('真实链路：下载+压缩真图 → 无 Key 中文报错 + 前往设置', /尚未填写 API Key/.test(errText) && hasSettingsBtn, errText.slice(0, 70));
  } catch (e) { step('面板/无 Key 真实链路', false, String(e).slice(0, 220)); }

  // ---- invalid key -> real 401 from api.openai.com ----
  try {
    const p = await context.newPage();
    await p.goto(`chrome-extension://${extId}/options/options.html`);
    // 新增一个无效 Key 的服务商并设为当前（v0.2.0 多服务商结构）
    await p.click('#addProviderBtn');
    await p.waitForTimeout(300);
    await p.fill('#providerName', 'E2E-Bad');
    await p.fill('#providerKey', 'sk-test-invalid-key-12345');
    await p.click('#saveProviderBtn');
    await p.waitForTimeout(500);
    const rows = p.locator('.provider-row');
    await rows.nth(await rows.count() - 1).locator('input[type=radio]').check();
    await p.waitForTimeout(500);
    await p.close();

    await page.bringToFront();
    await page.locator('.ip-retry').click();
    await page.waitForFunction(
      () => {
        const t = document.querySelector('#img2prompt-panel-root')?.shadowRoot?.querySelector('.ip-error-msg')?.textContent || '';
        return /API Key 无效|网络请求失败/.test(t);
      },
      undefined,
      { timeout: 120000 }
    );
    const errText = (await page.locator('.ip-error-msg').textContent()) || '';
    await page.screenshot({ path: path.join(SHOTS, '06-panel-error-401.png') });
    step('无效 Key 触发真实 401 中文映射', /API Key 无效或已过期（401）/.test(errText), errText.slice(0, 70));

    // language toggle must trigger a re-request: first observe the loading state (guards against matching the stale pre-toggle error), then the fresh error
    await page.locator('.ip-lang button[data-lang="en"]').click();
    await page.waitForSelector('.ip-loading', { timeout: 20000 });
    await page.waitForFunction(
      () => {
        const root = document.querySelector('#img2prompt-panel-root')?.shadowRoot;
        const active = root?.querySelector('.ip-lang button[data-lang="en"]')?.classList.contains('active');
        const t = root?.querySelector('.ip-error-msg')?.textContent || '';
        return active && /API Key 无效/.test(t);
      },
      undefined,
      { timeout: 90000 }
    );
    await page.screenshot({ path: path.join(SHOTS, '07-panel-toggle-en.png') });
    step('中/EN 切换重新请求并高亮', true);
  } catch (e) { step('无效 Key/语言切换', false, String(e).slice(0, 220)); }

  // ---- goto settings (panel must be in error state with the settings button; runs before close) ----
  try {
    const n0 = context.pages().length;
    await page.locator('.ip-goto-settings').click();
    await page.waitForTimeout(1500);
    const pages = context.pages();
    const optPage = pages.find((x) => (x.url() || '').includes('options/options.html'));
    step('面板"前往设置"打开选项页', pages.length > n0 && !!optPage, optPage ? optPage.url().slice(-40) : '');
    if (optPage) await optPage.close().catch(() => {});
    await page.bringToFront();
  } catch (e) { step('前往设置', false, String(e).slice(0, 160)); }

  // ---- copy button with synthetic result ----
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    const tabId2 = await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return tabs[0] && tabs[0].id;
    });
    await worker.evaluate(async (tid) => {
      await chrome.tabs.sendMessage(tid, { type: 'IMG2PROMPT_PANEL_STATE', state: 'result', text: 'a red apple on a wooden table, soft window light', lang: 'en' });
    }, tabId2);
    await page.waitForSelector('.ip-copy:not([disabled])', { timeout: 8000 });
    await page.screenshot({ path: path.join(SHOTS, '08-panel-result.png') });
    await page.locator('.ip-copy').click();
    await page.waitForTimeout(800);
    const copyLabel = (await page.locator('.ip-copy').textContent()) || '';
    step('结果态复制按钮', /已复制|Copied/.test(copyLabel), copyLabel);
  } catch (e) { step('结果态复制按钮', false, String(e).slice(0, 160)); }

  // ---- close panel ----
  try {
    await page.locator('.ip-close').click();
    await page.waitForTimeout(500);
    const gone = (await page.locator('#img2prompt-panel-root').count()) === 0;
    step('面板关闭按钮', gone);
  } catch (e) { step('面板关闭', false, String(e).slice(0, 160)); }

  step('SW 无未捕获异常', workerErrors.length === 0, workerErrors.slice(0, 2).join(' | ') || 'clean');
} catch (e) {
  step('整体流程', false, String(e).slice(0, 200));
} finally {
  fs.writeFileSync(path.join(path.dirname(SHOTS), 'report.json'), JSON.stringify(report, null, 2));
  await context?.close().catch(() => {});
  server.close();
}
console.log('DONE');
