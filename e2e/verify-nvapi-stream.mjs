/**
 * 流式生成真实 API 验证：首 token 速度 + 增量推送 + 最终详细度 + 无复读。
 *
 * Key 从环境变量 NVAPI_KEY 读取（一次性使用，不写入任何文件）。
 * 模型：meta/llama-3.2-11b-vision-instruct（NVIDIA Build API）。
 * 代理：E2E_PROXY=http://127.0.0.1:18080。
 * 构建：需先 npm run build:e2e（含 __img2promptE2E 钩子）。
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
const PROFILE = process.env.E2E_PROFILE || fs.mkdtempSync(path.join(os.tmpdir(), 'img2prompt-nvapi-stream-'));
const E2E_PROXY = process.env.E2E_PROXY || '';
const BASE_URL = 'https://integrate.api.nvidia.com/v1';
const MODEL = 'meta/llama-3.2-11b-vision-instruct';

function findChrome() {
  if (process.env.E2E_CHROME) return process.env.E2E_CHROME;
  const candidates = [
    '/opt/meta-chromium/chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
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

const panelQuery = (sel) =>
  `document.querySelector('#img2prompt-panel-root')?.shadowRoot?.querySelector('${sel}')`;
const panelText = (sel) => `${panelQuery(sel)}?.textContent || ''`;

const TEST_URL = 'https://example.com/';
// 真实照片：生成时间长（15-30s），采样窗口充足，能观察到文本增长
const IMAGE_URL = 'https://picsum.photos/seed/img2prompt-stream/640/400';

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

  // ---- 触发真实生成（不 await：轮询必须与生成并发进行） ----
  const t0 = Date.now();
  const genPromise = worker.evaluate(async ({ tabId, imageUrl }) => {
    await globalThis.__img2promptE2E.handleMenuClick(tabId, imageUrl);
  }, { tabId, imageUrl: IMAGE_URL });
  genPromise.catch(() => {});

  // 1) 流式条出现（首 token 到达）应在 60 秒内；同时观察是否直接报错
  await page.waitForFunction(() => {
    const root = document.querySelector('#img2prompt-panel-root')?.shadowRoot;
    if (!root) return false;
    return !!root.querySelector('.ip-streaming-bar') || !!root.querySelector('.ip-error-msg') || !!root.querySelector('.ip-result');
  }, null, { timeout: 60000 }).catch(() => {});
  const streamingSeen = await page.evaluate(`!!(${panelQuery('.ip-streaming-bar')})`);
  const errEarly = await page.evaluate(`(${panelText('.ip-error-msg')})`);
  const firstTokenMs = Date.now() - t0;
  step('流式状态出现（首 token 到达）', streamingSeen, `${firstTokenMs}ms${errEarly ? ' / 错误:' + errEarly.slice(0, 60) : ''}`);
  await page.screenshot({ path: path.join(SHOTS, 'stream-mid.png') });
  if (!streamingSeen) throw new Error('未进入流式状态，中止（早期错误：' + errEarly + '）');

  // 2) 文本在增长：流式条出现后立即密集采样，真实照片生成需 15-30s，窗口充足
  const samples = [];
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(1000);
    samples.push(await page.evaluate(`(${panelText('.ip-result')}).length`));
    const barGone = await page.evaluate(`!(${panelQuery('.ip-streaming-bar')})`);
    if (barGone) break;
  }
  const grew = samples.some((v, i) => i > 0 && v > samples[i - 1]);
  step('流式文本持续增长', grew, samples.join(' → '));

  // 3) 等待完成：流式条消失且有最终结果
  await page.waitForFunction(() => {
    const root = document.querySelector('#img2prompt-panel-root')?.shadowRoot;
    if (!root) return false;
    return !root.querySelector('.ip-streaming-bar') && !root.querySelector('.ip-loading')
      && (root.querySelector('.ip-result')?.textContent || '').length > 0;
  }, null, { timeout: 180000 }).catch(async () => {
    const err = await page.evaluate(`(${panelText('.ip-error-msg')})`);
    throw new Error('等待最终结果超时 / 面板错误: ' + err);
  });
  const totalMs = Date.now() - t0;
  const finalText = await page.evaluate(`(${panelText('.ip-result')})`);
  await page.screenshot({ path: path.join(SHOTS, 'stream-final.png') });

  // 4) 详细度：新模板目标 300-600 字，阈值取 200（模型输出有随机性）
  step('最终输出足够详细', finalText.length >= 200, `${finalText.length}字，总耗时${totalMs}ms`);
  console.log('结果预览：' + finalText.slice(0, 150).replace(/\n/g, ' '));

  // 5) 无复读 loop：任意 8 字片段最多出现 3 次
  const counts = {};
  let maxRep = 0;
  for (let i = 0; i + 8 <= finalText.length; i += 4) {
    const s = finalText.slice(i, i + 8);
    counts[s] = (counts[s] || 0) + 1;
    if (counts[s] > maxRep) maxRep = counts[s];
  }
  step('无复读 loop', maxRep <= 3, `最高8字重复${maxRep}次`);

  // 6) 元信息 caption 正常
  const meta = await page.evaluate(`(${panelText('.ip-meta')})`);
  step('元信息 caption 显示', meta.includes('·') && /\d+/.test(meta), meta);
  await genPromise;
} catch (e) {
  step('E2E 执行', false, String(e).slice(0, 220));
} finally {
  try { await context?.close(); } catch {}
}

console.log(`\n==== 结果：${passed}/${passed + failed} 通过 ====`);
process.exit(failed ? 1 : 0);
