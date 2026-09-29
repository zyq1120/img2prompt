/**
 * v0.3.0 E2E：刷新提示词按钮 + 分阶段 loading + 结果元信息。
 *
 * 流程（无需真实 API Key）：
 *  1. 右键链路（无 Key）→ 错误态：刷新按钮存在但禁用
 *  2. 经 SW 向 tab 发送合成的 IMG2PROMPT_PANEL_STATE(result) → 结果态
 *  3. 断言：刷新按钮可用、元信息 caption（模板名 · 字数）出现
 *  4. 点击刷新 → loading 出现、刷新图标旋转 → 无 Key 报错（证明重新生成链路跑通）
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import path from 'path';

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
const PROFILE = process.env.E2E_PROFILE || fs.mkdtempSync(path.join(os.tmpdir(), 'img2prompt-v03-'));
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
if (!CHROME_BIN) throw new Error('找不到 Chromium 可执行文件');
if (process.env.E2E_PROFILE) fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

function step(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  return ok;
}

const IMAGE_URL = 'https://picsum.photos/seed/img2prompt/640/400';
const FAKE_RESULT = '白色瓷杯，红色莓果，自然光，木质桌面，柔和色调，高饱和度，用于验证刷新按钮的合成结果文本。';

let context, worker, extId, page;
let passed = 0, failed = 0;
function tally(ok) { ok ? passed++ : failed++; return ok; }

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
  tally(step('扩展已安装', !!extId));

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

  page = await context.newPage();
  await page.goto('https://example.com/', { timeout: 45000 });
  await page.evaluate((img) => {
    document.body.insertAdjacentHTML('beforeend', `<img id="target" src="${img}" width="640" height="400">`);
  }, IMAGE_URL);
  await page.waitForSelector('#target', { timeout: 15000 });
  const tabId = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] && tabs[0].id;
  });

  // 无 Key 走右键链路 → 错误态
  await worker.evaluate(async ({ tabId, imageUrl }) => {
    await globalThis.__img2promptE2E.handleMenuClick(tabId, imageUrl);
  }, { tabId, imageUrl: IMAGE_URL });
  await page.waitForSelector('.ip-error-msg', { timeout: 60000 });
  const shadowOf = (sel) => page.evaluate((s) => {
    const root = document.querySelector('#img2prompt-panel-root');
    return root?.shadowRoot?.querySelector(s) ? true : false;
  }, sel);

  tally(step('错误态：刷新按钮存在', await shadowOf('.ip-refresh')));
  const refreshDisabledInError = await page.evaluate(() => {
    const root = document.querySelector('#img2prompt-panel-root');
    return root?.shadowRoot?.querySelector('.ip-refresh')?.disabled === true;
  });
  tally(step('错误态：刷新按钮禁用', refreshDisabledInError));

  // 合成结果态（不经过模型，纯 UI 链路）
  await worker.evaluate(async ({ tabId, text }) => {
    await chrome.tabs.sendMessage(tabId, {
      type: 'IMG2PROMPT_PANEL_STATE', state: 'result', text, lang: 'zh',
    });
  }, { tabId, text: FAKE_RESULT });
  await page.waitForSelector('.ip-result', { timeout: 10000 });
  await page.waitForTimeout(1200); // 等异步的元信息渲染
  const refreshEnabled = await page.evaluate(() => {
    const root = document.querySelector('#img2prompt-panel-root');
    return root?.shadowRoot?.querySelector('.ip-refresh')?.disabled === false;
  });
  tally(step('结果态：刷新按钮可用', refreshEnabled));
  const metaText = await page.evaluate(() => {
    const root = document.querySelector('#img2prompt-panel-root');
    return root?.shadowRoot?.querySelector('.ip-meta')?.textContent || '';
  });
  tally(step('结果态：元信息 caption（模板名 · 字数）', metaText.includes('·') && metaText.includes(String(FAKE_RESULT.length)), metaText));
  await page.screenshot({ path: path.join(SHOTS, 'v03-panel-result.png') });

  // 点击刷新 → 重新生成链路（点击 handler 是同步渲染 loading，直接同 tick 断言）
  const loadingText1 = await page.evaluate(() => {
    const root = document.querySelector('#img2prompt-panel-root');
    root?.shadowRoot?.querySelector('.ip-refresh')?.click();
    return root?.shadowRoot?.querySelector('.ip-loading-text')?.textContent || '';
  });
  tally(step('刷新后进入 loading（阶段一文案）', loadingText1.length > 0, loadingText1));
  const spinning = await page.evaluate(() => {
    const root = document.querySelector('#img2prompt-panel-root');
    return root?.shadowRoot?.querySelector('.ip-refresh')?.classList.contains('spinning') === true;
  });
  tally(step('loading 中刷新图标旋转', spinning));
  // 无 Key → 生成失败回到错误态，证明刷新真实触发了重新生成
  await page.waitForSelector('.ip-error-msg', { timeout: 90000 });
  tally(step('刷新触发重新生成（无 Key 报错）', true));
  await page.screenshot({ path: path.join(SHOTS, 'v03-panel-refresh.png') });
} catch (e) {
  tally(step('E2E 执行', false, String(e).slice(0, 200)));
} finally {
  try { await context?.close(); } catch {}
}

console.log(`\n==== 结果：${passed}/${passed + failed} 通过 ====`);
process.exit(failed ? 1 : 0);
