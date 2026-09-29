// 真实用户操作验证：在 Xvfb 有界面 Chromium 中，用真实右键原生菜单 + 键盘选中 + 真实拖拽框选。
// 与 __img2promptE2E 钩子无关，走生产真实链路（含 activeTab 授权）。
// 运行前：Xvfb :99 已启动；脚本自行启动 fwd-proxy。
// 交互点：脚本在需要人工看菜单截图决定按几次 ↓ 时，会等待 /tmp/nav1.txt / /tmp/nav2.txt（写入整数后继续）。
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
let _pw;
try { _pw = _require('playwright-core'); }
catch { _pw = createRequire(process.env.E2E_PLAYWRIGHT_ANCHOR || '/home/hatch/workspace/skills/design-card/package.json')('playwright-core'); }
const { chromium } = _pw;
import { spawn, execSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const EXT_ID_FILE = '/tmp/real-ext-id.txt';

const NVIDIA_KEY = process.env.NVIDIA_API_KEY;
if (!NVIDIA_KEY) { console.error('需要 NVIDIA_API_KEY'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function xshot(name) {
  execSync(`python3 -c "
import os; os.environ['DISPLAY']=':99'
from mss import MSS
with MSS() as s: s.shot(output='/tmp/${name}.png')
" 2>/dev/null`);
  console.log('X截图 ->', `/tmp/${name}.png`);
}
function waitForFile(p, timeoutMs, label) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const iv = setInterval(() => {
      if (existsSync(p)) { clearInterval(iv); resolve(readFileSync(p, 'utf8').trim()); }
      else if (Date.now() - t0 > timeoutMs) { clearInterval(iv); reject(new Error(label + ' 等待超时')); }
    }, 500);
  });
}

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok, extra }); console.log(ok ? 'PASS' : 'FAIL', '-', name, extra); };

// 1. 代理
const proxy = spawn('node', [path.join(ROOT, 'e2e/fwd-proxy.mjs')], { stdio: 'ignore' });
await sleep(1200);

// 2. 宿主测试页：公网 example.com + 注入测试图片（走 fwd-proxy 加载 picsum）
const HOST_URL = 'https://example.com/';

// 3. 有界面浏览器（launchPersistentContext，扩展走默认上下文）
const userDataDir = '/tmp/real-user-profile';
execSync(`rm -rf ${userDataDir}`);
const ctx = await chromium.launchPersistentContext(userDataDir, {
  executablePath: '/opt/meta-chromium/chrome',
  headless: false,
  env: { ...process.env, DISPLAY: ':99' },
  proxy: { server: 'http://127.0.0.1:18080', bypass: '127.0.0.1,localhost' },
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [
    '--no-sandbox', '--disable-dev-shm-usage', '--lang=zh-CN',
    '--window-size=1280,800', '--window-position=0,0',
    `--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`,
  ],
});
await sleep(3000);
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
const extId = sw.url().match(/chrome-extension:\/\/([^/]+)/)[1];
writeFileSync(EXT_ID_FILE, extId);
console.log('扩展 ID:', extId);

// 4. 注入 NVIDIA provider（Options UI 已在上一轮真机 E2E 验证过，这里聚焦右键链路）
await ctx.addInitScript(() => {});
const seed = await ctx.newPage();
await seed.goto(`chrome-extension://${extId}/options/options.html`);
await seed.evaluate((key) => {
  const p = { id: 'nvidia-real', name: 'NVIDIA 真机', baseUrl: 'https://integrate.api.nvidia.com/v1', apiKey: key, model: 'meta/llama-3.2-11b-vision-instruct' };
  return chrome.storage.sync.set({ providers: [p], activeProviderId: 'nvidia-real' });
}, NVIDIA_KEY);
await seed.close();
await sleep(500);

// 5. 打开测试页并注入图片
const page = await ctx.newPage();
await page.setViewportSize({ width: 1280, height: 720 });
await page.goto(HOST_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.evaluate(() => {
  document.body.insertAdjacentHTML('beforeend',
    `<div style="padding:60px"><h1 style="font-size:20px">真实右键验证页</h1>` +
    `<img id="target" src="https://picsum.photos/seed/realuser1/480/320" width="480" height="320" style="display:block;background:#ddd">` +
    `<p style="height:300px">空白区域</p></div>`);
});
await page.waitForSelector('#target');
await page.locator('#target').scrollIntoViewIfNeeded();
const box = await page.locator('#target').boundingBox();
console.log('图片位置:', JSON.stringify(box));
await sleep(800);
xshot('real-desktop');

// ---------- 场景 1：真实右键图片 → 原生菜单 → 键盘选中 ----------
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await page.mouse.click(cx, cy, { button: 'right' });
await sleep(1200);
xshot('real-menu-image');
console.log('>>> 请查看 /tmp/real-menu-image.png，把"生成图片提示词"是第几项（从顶部数，第1项=0次↓）写入 /tmp/nav1.txt');
const nav1 = parseInt(await waitForFile('/tmp/nav1.txt', 180000, 'nav1'), 10);
console.log('将按 ↓', nav1, '次后回车');
for (let i = 0; i < nav1; i++) { await page.keyboard.press('ArrowDown'); await sleep(150); }
await sleep(300);
await page.keyboard.press('Enter');
console.log('已回车，等待面板结果…');
const panel = page.locator('[data-img2prompt-panel]');
await panel.waitFor({ timeout: 15000 }).catch(() => {});
const panelShown = await panel.count() > 0;
check('真实右键菜单点击后面板出现', panelShown);
let oldText = '';
if (panelShown) {
  oldText = await panel.innerText().catch(() => '');
  const t0 = Date.now(); let txt = oldText;
  while (Date.now() - t0 < 90000) {
    await sleep(2000);
    txt = await panel.innerText().catch(() => '');
    const st = await panel.getAttribute('data-state').catch(() => '');
    if (st !== 'loading' && txt.trim().length > 20 && txt !== oldText) break;
  }
  const done = txt.trim().length > 20 && txt !== oldText;
  check('真实右键链路生成出结果', done, `结果长度=${txt.trim().length}`);
  const tplCount = await panel.locator('select option').count().catch(() => 0);
  check('面板模板下拉正常', tplCount >= 5, `选项数=${tplCount}`);
}
await sleep(800);
xshot('real-result1');

// ---------- 场景 2：真实右键页面 → 框选截图并识别 → 真实拖拽 ----------
await page.mouse.click(640, 660, { button: 'right' }); // 空白处
await sleep(1200);
xshot('real-menu-region');
console.log('>>> 请查看 /tmp/real-menu-region.png，把"框选截图并识别"需要按几次 ↓ 写入 /tmp/nav2.txt');
const nav2 = parseInt(await waitForFile('/tmp/nav2.txt', 180000, 'nav2'), 10);
for (let i = 0; i < nav2; i++) { await page.keyboard.press('ArrowDown'); await sleep(150); }
await sleep(300);
await page.keyboard.press('Enter');
console.log('已回车，等待框选 overlay…');
await sleep(1500);
xshot('real-overlay');
const overlay = page.locator('[data-img2prompt-region-overlay]');
const overlayShown = await overlay.count() > 0;
check('真实菜单点击后框选 overlay 出现', overlayShown);
if (overlayShown) {
  // 真实鼠标拖拽框选图片区域
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(box.x + 40 + i * 30, box.y + 40 + i * 20); await sleep(60); }
  await page.mouse.up();
  console.log('拖拽完成，等待裁剪生成结果（走真实 captureVisibleTab + activeTab）…');
  const t0 = Date.now(); let txt = '';
  while (Date.now() - t0 < 90000) {
    await sleep(2000);
    txt = await panel.innerText().catch(() => '');
    const st = await panel.getAttribute('data-state').catch(() => '');
    if (st !== 'loading' && txt.trim().length > 20) break;
  }
  const done = txt.trim().length > 20;
  check('真实拖拽框选生成出结果', done, `结果长度=${txt.trim().length}`);
}
await sleep(800);
xshot('real-result2');

console.log('\n===== 真实用户验证结果 =====');
for (const r of results) console.log(r.ok ? 'PASS' : 'FAIL', '-', r.name, r.extra || '');
const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? 'ALL PASS' : `${failed.length} FAILED`);
proxy.kill();
await ctx.close();
process.exit(failed.length === 0 ? 0 : 1);
