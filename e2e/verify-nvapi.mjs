/**
 * img2prompt Phase 2 真实浏览器 E2E：NVIDIA Build API 真实 Key 全链路。
 * Key 从环境变量 NVAPI_KEY 读取，不写入任何文件。
 *
 * 覆盖：
 *  1. options 新版 UI：添加 NVIDIA 服务商 → 设为当前 → 单行连接测试
 *  2. 右键菜单链路：中文生成 → EN 切换
 *  3. 选区截图链路：handleRegionDone（captureVisibleTab 真实截图 + 裁剪）
 *  4. 面板模板切换到 builtin:json：结构化渲染
 *  5. popup 拖拽上传链路：setInputFiles 真实文件 → 压缩 → 生成 → 历史
 *
 * 代理：E2E_PROXY=http://127.0.0.1:18080（e2e/fwd-proxy.mjs 转发上游）。
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
const UPLOAD_PNG = '/tmp/e2e-upload.png';

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

  // ---- 1. 设置页：新版 UI 添加 NVIDIA 服务商并设为当前 ----
  try {
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
    const rowCount = await p.locator('.provider-row').count();
    step('设置页：添加 NVIDIA 服务商', rowCount === 2, `${rowCount} rows`);

    // 设为当前
    const nvidiaRow = p.locator('.provider-row', { hasText: 'NVIDIA' });
    await nvidiaRow.locator('input[type="radio"]').check();
    await p.waitForTimeout(600);
    const activeBadge = await nvidiaRow.locator('.badge.active').count();
    step('设置页：NVIDIA 设为当前服务商', activeBadge === 1);

    // 单行连接测试
    const rowTestBtn = nvidiaRow.locator('.text-btn').nth(0);
    const btnHandle = await rowTestBtn.elementHandle();
    await rowTestBtn.click();
    await p.waitForFunction((btn) => !btn.disabled, btnHandle, { timeout: 30000 });
    await p.waitForTimeout(300);
    const statusOk = await p.locator('#status.ok').count();
    const status = await p.textContent('#status');
    await p.screenshot({ path: path.join(SHOTS, '11-options-providers.png') });
    step('设置页：NVIDIA 单行连接测试成功', statusOk > 0, (status || '').trim().slice(0, 60));
    await p.close();
  } catch (e) { step('设置页：服务商管理', false, String(e).slice(0, 200)); }

  // ---- 宿主页面 + 测试图片 ----
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

  // ---- 2. 右键菜单链路：中文 ----
  await worker.evaluate(async ({ tabId, imageUrl }) => {
    await globalThis.__img2promptE2E.handleMenuClick(tabId, imageUrl);
  }, { tabId, imageUrl: IMAGE_URL });
  await page.waitForFunction(
    () => (document.querySelector('#img2prompt-panel-root')?.shadowRoot?.querySelector('.ip-result')?.textContent || '').length > 20,
    undefined, { timeout: 120000 }
  );
  const zhText = await page.evaluate(shadowText, '.ip-result');
  const copyEnabled = await page.evaluate(
    () => !document.querySelector('#img2prompt-panel-root')?.shadowRoot?.querySelector('.ip-copy')?.disabled
  );
  const tplOptions = await page.evaluate(
    () => document.querySelector('#img2prompt-panel-root')?.shadowRoot?.querySelectorAll('.ip-template option')?.length || 0
  );
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS, '12-panel-zh.png') });
  step('右键链路：中文生成 + 面板模板下拉(7项)', zhText.length > 20 && copyEnabled && tplOptions === 7,
    `${zhText.length}字, 模板${tplOptions}项`);
  console.log('中文结果预览：' + zhText.slice(0, 100));

  // ---- 3. EN 切换 ----
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
  await page.screenshot({ path: path.join(SHOTS, '13-panel-en.png') });
  step('中英切换：英文重新生成并展示', enText.length > 20 && enText !== zhText, `${enText.length} chars`);

  // ---- 4. 选区截图链路 ----
  // headless 下无法产生授予 activeTab 的真实菜单点击，因此经 CDP 截图后
  // 调用 handleRegionShot：裁剪 → 生成 → 面板 → 历史均为真实链路。
  const rect = await page.evaluate(() => {
    const r = document.querySelector('#target').getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const shotBuffer = await page.screenshot({ type: 'png' });
  const shotDataUrl = `data:image/png;base64,${shotBuffer.toString('base64')}`;
  const beforeRegion = enText;
  await worker.evaluate(async ({ tabId, rect, shotDataUrl }) => {
    await globalThis.__img2promptE2E.handleRegionShot(tabId, rect, 1, shotDataUrl);
  }, { tabId, rect, shotDataUrl });
  await page.waitForFunction(
    (prev) => {
      const t = document.querySelector('#img2prompt-panel-root')?.shadowRoot?.querySelector('.ip-result')?.textContent || '';
      return t.length > 20 && t !== prev;
    }, beforeRegion, { timeout: 120000 }
  );
  const regionText = await page.evaluate(shadowText, '.ip-result');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS, '14-panel-region.png') });
  step('选区截图：真实截图裁剪后生成', regionText.length > 20 && regionText !== beforeRegion,
    `${regionText.length} chars`);
  console.log('选区结果预览：' + regionText.slice(0, 100));

  // ---- 5. JSON 模板：结构化渲染 ----
  await page.evaluate(() => {
    const sel = document.querySelector('#img2prompt-panel-root')?.shadowRoot?.querySelector('.ip-template');
    sel.value = 'builtin:json';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForSelector('.ip-tags', { timeout: 120000 });
  const tagCount = await page.evaluate(
    () => document.querySelector('#img2prompt-panel-root')?.shadowRoot?.querySelectorAll('.ip-tag')?.length || 0
  );
  const kvCount = await page.evaluate(
    () => document.querySelector('#img2prompt-panel-root')?.shadowRoot?.querySelectorAll('.ip-kv')?.length || 0
  );
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS, '15-panel-json.png') });
  step('JSON 模板：结构化渲染(tags/kv)', tagCount > 0, `tags=${tagCount}, kv=${kvCount}`);

  await page.close();

  // ---- 6. popup 上传链路 ----
  try {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
    await popup.waitForTimeout(800);
    const provCount = await popup.locator('#providerSelect option').count();
    step('popup：服务商下拉已加载', provCount === 2, `${provCount} options`);
    await popup.setInputFiles('#fileInput', UPLOAD_PNG);
    await popup.waitForFunction(
      () => {
        const box = document.querySelector('#uploadResult');
        const spinner = document.querySelector('#uploadSpinner');
        const txt = document.querySelector('#uploadText')?.textContent || '';
        return box && !box.hidden && spinner?.hidden && txt.length > 10
          && !/识别中|Recognizing/.test(txt);
      },
      undefined, { timeout: 120000 }
    );
    const uploadText = await popup.textContent('#uploadText');
    const histCount = await popup.locator('.history-item').count();
    await popup.waitForTimeout(400);
    await popup.screenshot({ path: path.join(SHOTS, '16-popup-upload.png') });
    step('popup 上传：真实文件生成 + 入历史', (uploadText || '').length > 10 && histCount >= 1,
      `${(uploadText || '').length} chars, 历史${histCount}条`);
    console.log('上传结果预览：' + (uploadText || '').slice(0, 100));
    await popup.close();
  } catch (e) { step('popup 上传链路', false, String(e).slice(0, 200)); }
} catch (e) {
  step('E2E 执行', false, String(e).slice(0, 220));
} finally {
  const failed = report.steps.filter((s) => !s.ok);
  console.log(`\n==== 结果：${report.steps.length - failed.length}/${report.steps.length} 通过 ====`);
  try { await context?.close(); } catch {}
  fs.writeFileSync(path.join(SHOTS, 'report.json'), JSON.stringify(report, null, 2));
  process.exit(failed.length ? 1 : 0);
}
