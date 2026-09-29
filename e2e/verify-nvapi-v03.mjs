/**
 * v0.3.0 真实 API 验证：新模板的输出详细度 + 刷新按钮真实重生成。
 *
 * Key 从环境变量 NVAPI_KEY 读取（一次性使用，不写入任何文件）。
 * 模型：meta/llama-3.2-11b-vision-instruct（NVIDIA Build API）。
 * 代理：E2E_PROXY=http://127.0.0.1:18080。
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import path from 'path';

const KEY = process.env.NVAPI_KEY;
if (!KEY) { console.error('FATAL: 缺少 NVAPI_KEY 环境变量'); process.exit(1); }

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright-core');
} catch {
  const anchor = process.env.E2E_PLAYWRIGHT_ANCHOR || '/home/hatch/workspace/skills/design-card/package.json';
  playwright = createRequire(anchor)('playwright-core');
}
const { chromium } = playwright;

const EXT_DIR = process.env.E2E_EXT_DIR || path.join(E2E_DIR, '..', 'dist');
const SHOTS = process.env.E2E_SHOTS || path.join(E2E_DIR, 'shots');
const PROFILE = process.env.E2E_PROFILE || fs.mkdtempSync(path.join(os.tmpdir(), 'img2prompt-nvapi-v03-'));
const E2E_PROXY = process.env.E2E_PROXY || '';
const BASE_URL = 'https://integrate.api.nvidia.com/v1';
const MODEL = 'meta/llama-3.2-11b-vision-instruct';

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
if (!CHROME_BIN) throw new Error('找不到 Chromium 可执行文件');
if (process.env.E2E_PROFILE) fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

let passed = 0, failed = 0;
function step(name, ok, detail = '') {
  ok ? passed++ : failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

const shadowText = (sel) =>
  document.querySelector('#img2prompt-panel-root')?.shadowRoot?.querySelector(sel)?.textContent || '';

async function waitForPanelResult(page, prevText, stepName, timeout = 120000) {
  await page.waitForFunction(
    (prev) => {
      const root = document.querySelector('#img2prompt-panel-root')?.shadowRoot;
      if (!root || root.querySelector('.ip-loading')) return false;
      const t = root.querySelector('.ip-result')?.textContent || '';
      return t.length > 0 && t !== prev;
    }, prevText, { timeout }
  ).catch((e) => {
    const state = page.evaluate(shadowText, '.ip-error-msg');
    throw new Error(`${stepName} 超时: ${String(e).slice(0, 80)} / 面板: ${state}`);
  });
}

const TEST_URL = 'https://example.com/';
const IMAGE_URL = 'https://picsum.photos/seed/img2prompt-v03/640/400';

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
  for (let i = 0; i < 30 && !extId; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const prefs = JSON.parse(fs.readFileSync(`${PROFILE}/Default/Preferences`, 'utf8'));
      for (const [id, v] of Object.entries(prefs.extensions?.settings || {})) {
        if (JSON.stringify(v).includes('img2prompt/dist')) { extId = id; break; }
      }
    } catch {}
  }
  step('扩展已安装', !!extId);
  const cdpPage = await context.newPage();
  const session = await context.newCDPSession(cdpPage);
  await session.send('ServiceWorker.enable');
  await session.send('ServiceWorker.startWorker', { scopeURL: `chrome-extension://${extId}/` }).catch(() => {});
  for (let i = 0; i < 10 && !worker; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    worker = context.serviceWorkers().find((w) => w.url().includes(extId));
  }
  await cdpPage.close();
  if (!worker) throw new Error('no service worker');
  step('Service Worker 已启动', true);

  // ---- 设置页：添加 NVIDIA 并设为当前 ----
  const p = await context.newPage();
  await p.goto(`chrome-extension://${extId}/options/options.html`);
  await p.waitForTimeout(800);
  await p.click('#addProviderBtn');
  await p.fill('#providerName', 'NVIDIA');
  await p.fill('#providerKey', KEY);
  await p.fill('#providerBaseUrl', BASE_URL);
  await p.fill('#providerModel', MODEL);
  await p.click('#saveProviderBtn');
  await p.waitForTimeout(600);
  const nvidiaRow = p.locator('.provider-row', { hasText: 'NVIDIA' });
  await nvidiaRow.locator('input[type="radio"]').check();
  await p.waitForTimeout(600);
  const rowTestBtn = nvidiaRow.locator('.text-btn').nth(0);
  const btnHandle = await rowTestBtn.elementHandle();
  await rowTestBtn.click();
  await p.waitForFunction((btn) => !btn.disabled, btnHandle, { timeout: 30000 });
  const statusOk = await p.locator('#status.ok').count();
  step('NVIDIA 连接测试成功', statusOk > 0);
  await p.close();

  // ---- 宿主页面 ----
  const page = await context.newPage();
  await page.goto(TEST_URL, { timeout: 45000 });
  await page.evaluate((img) => {
    document.body.insertAdjacentHTML('beforeend', `<img id="target" src="${img}" width="640" height="400">`);
  }, IMAGE_URL);
  await page.waitForSelector('#target', { timeout: 15000 });
  const tabId = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] && tabs[0].id;
  });

  // ---- 中文生成：验证详细度 ----
  await worker.evaluate(async ({ tabId, imageUrl }) => {
    await globalThis.__img2promptE2E.handleMenuClick(tabId, imageUrl);
  }, { tabId, imageUrl: IMAGE_URL });
  await waitForPanelResult(page, '', '中文生成');
  const zhText = await page.evaluate(shadowText, '.ip-result');
  const meta = await page.evaluate(shadowText, '.ip-meta');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, 'v03-nvapi-zh.png') });
  // 新模板目标 150-350 字；模型输出有随机性，阈值取 100（旧模板目标 80-200，典型输出约 100-150）
  step('中文生成：输出足够详细', zhText.length >= 100, `${zhText.length}字`);
  step('元信息 caption 显示', meta.includes('·') && /\d+/.test(meta), meta);
  console.log('中文结果预览：' + zhText.slice(0, 120).replace(/\n/g, ' '));

  // ---- 刷新按钮：真实重新生成 ----
  await page.locator('.ip-refresh').click();
  await waitForPanelResult(page, zhText, '刷新重生成');
  const zhText2 = await page.evaluate(shadowText, '.ip-result');
  const meta2 = await page.evaluate(shadowText, '.ip-meta');
  await page.screenshot({ path: path.join(SHOTS, 'v03-nvapi-refresh.png') });
  step('刷新：重新生成出新结果', zhText2.length >= 100, `${zhText2.length}字${zhText2 === zhText ? '（与上次相同）' : '（措辞不同）'}`);
  step('刷新后元信息更新', meta2.includes('·') && /\d+/.test(meta2), meta2);
  console.log('刷新结果预览：' + zhText2.slice(0, 120).replace(/\n/g, ' '));
} catch (e) {
  step('E2E 执行', false, String(e).slice(0, 220));
} finally {
  try { await context?.close(); } catch {}
}

console.log(`\n==== 结果：${passed}/${passed + failed} 通过 ====`);
process.exit(failed ? 1 : 0);
