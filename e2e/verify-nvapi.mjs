/**
 * img2prompt 真实浏览器 E2E：NVIDIA Build API 真实 Key 全链路。
 * Key 从环境变量 NVAPI_KEY 读取，不写入任何文件。跑完脚本可删。
 */
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const KEY = process.env.NVAPI_KEY;
if (!KEY) { console.error('FATAL: 缺少 NVAPI_KEY 环境变量'); process.exit(1); }

const anchor = '/home/hatch/workspace/skills/design-card/package.json';
const { chromium } = createRequire(anchor)('playwright-core');

const EXT_DIR = '/home/hatch/workspace/img2prompt/dist';
const SHOTS = '/tmp/e2e-shots';
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'img2prompt-nvapi-'));
const BASE_URL = 'https://integrate.api.nvidia.com/v1';
const MODEL = 'meta/llama-3.2-11b-vision-instruct';
const IMAGE_URL = 'https://picsum.photos/seed/img2prompt/640/400';

function findChrome() {
  const candidates = [
    '/opt/meta-chromium/chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  ];
  return candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
}
const CHROME_BIN = findChrome();
if (!CHROME_BIN) throw new Error('找不到 Chromium');

fs.mkdirSync(SHOTS, { recursive: true });
const E2E_PROXY = process.env.E2E_PROXY || '';
const TEST_URL = 'https://example.com/';
const report = { steps: [] };
function step(name, ok, detail = '') {
  report.steps.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const shadowText = (sel) =>
  document.querySelector('#img2prompt-panel-root')?.shadowRoot?.querySelector(sel)?.textContent || '';

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
      const settings = prefs.extensions?.settings || {};
      for (const [id, v] of Object.entries(settings)) {
        if (JSON.stringify(v).includes('img2prompt/dist')) { extId = id; break; }
      }
    } catch {}
  }
  step('扩展已安装并拿到 ID', !!extId, extId || '');

  const cdpPage = await context.newPage();
  const session = await context.newCDPSession(cdpPage);
  await session.send('ServiceWorker.enable');
  await session.send('ServiceWorker.startWorker', { scopeURL: `chrome-extension://${extId}/` }).catch(() => {});
  worker = context.serviceWorkers().find((w) => w.url().includes(extId));
  for (let i = 0; i < 10 && !worker; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    worker = context.serviceWorkers().find((w) => w.url().includes(extId));
  }
  step('Service Worker 已启动', !!worker);
  if (!worker) throw new Error('no service worker');
  await cdpPage.close();

  // ---- 设置页：填真实 NVIDIA 配置 + 测试连接 ----
  try {
    const p = await context.newPage();
    await p.goto(`chrome-extension://${extId}/options/options.html`);
    await p.waitForTimeout(800);
    await p.fill('#apiKey', KEY);
    await p.fill('#baseUrl', BASE_URL);
    await p.fill('#model', MODEL);
    await p.click('#saveBtn');
    await p.waitForTimeout(500);
    await p.click('#testBtn');
    // 等待测试完成：按钮恢复可用后再断言（避开中间态 "Testing…" 也有 ok class 的问题）
    await p.waitForFunction(
      () => !document.querySelector('#testBtn').disabled,
      undefined, { timeout: 30000 }
    );
    await p.waitForTimeout(300);
    const statusOk = await p.locator('#status.ok').count();
    const status = await p.textContent('#status');
    await p.screenshot({ path: path.join(SHOTS, '01-options-nvapi.png') });
    step('设置页：NVIDIA 配置保存 + 连接测试成功', statusOk > 0 && !/Testing|测试中/.test(status || ''), (status || '').trim().slice(0, 40));
    await p.close();
  } catch (e) { step('设置页：NVIDIA 配置 + 连接测试', false, String(e).slice(0, 160)); }

  // ---- 真实链路：右键菜单钩子 → 下载真图 → 生成 → 面板展示 ----
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
  step('定位宿主 tab', typeof tabId === 'number', `tabId=${tabId}`);

  await worker.evaluate(async ({ tabId, imageUrl }) => {
    await globalThis.__img2promptE2E.handleMenuClick(tabId, imageUrl);
  }, { tabId, imageUrl: IMAGE_URL });

  // 等待中文生成结果（成功态 .ip-result，非报错）
  await page.waitForFunction(
    () => (document.querySelector('#img2prompt-panel-root')?.shadowRoot?.querySelector('.ip-result')?.textContent || '').length > 20,
    undefined, { timeout: 120000 }
  );
  const zhText = await page.evaluate(shadowText, '.ip-result');
  const copyEnabled = await page.evaluate(
    () => !document.querySelector('#img2prompt-panel-root')?.shadowRoot?.querySelector('.ip-copy')?.disabled
  );
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS, '02-panel-zh.png') });
  step('真实链路：中文绘画提示词生成并展示', zhText.length > 20 && copyEnabled, `${zhText.length}字，复制按钮可用=${copyEnabled}`);
  console.log('中文结果预览：' + zhText.slice(0, 120));

  // ---- 中英切换：点 en → 重新生成英文 ----
  await page.locator('.ip-lang button[data-lang="en"]').click();
  await page.waitForSelector('.ip-loading', { timeout: 20000 });
  await page.waitForFunction(
    (prev) => {
      const t = document.querySelector('#img2prompt-panel-root')?.shadowRoot?.querySelector('.ip-result')?.textContent || '';
      return t.length > 20 && t !== prev;
    }, zhText, { timeout: 120000 }
  );
  const enText = await page.evaluate(shadowText, '.ip-result');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS, '03-panel-en.png') });
  step('中英切换：英文重新生成并展示', enText.length > 20 && enText !== zhText, `${enText.length} chars`);
  console.log('英文结果预览：' + enText.slice(0, 120));

  await page.close();
} catch (e) {
  step('E2E 执行', false, String(e).slice(0, 220));
} finally {
  const failed = report.steps.filter((s) => !s.ok);
  console.log(`\n==== 结果：${report.steps.length - failed.length}/${report.steps.length} 通过 ====`);
  try { await context?.close(); } catch {}
  fs.writeFileSync(path.join(SHOTS, 'report.json'), JSON.stringify(report, null, 2));
  process.exit(failed.length ? 1 : 0);
}
