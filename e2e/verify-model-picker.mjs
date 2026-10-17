// E2E：设置页「获取模型列表」功能验证（拦截 /models 请求，不发真实网络请求）
// 场景 1：拉取成功 → 下拉出现全部模型（去重后）→ 选择即填入模型框 → 保存后列表行显示所选模型
// 场景 2：接口 403 → 显示友好错误，下拉保持隐藏
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
  const anchor =
    process.env.E2E_PLAYWRIGHT_ANCHOR || '/home/hatch/workspace/skills/design-card/package.json';
  playwright = createRequire(anchor)('playwright-core');
}
const { chromium } = playwright;

const EXT_DIR = process.env.E2E_EXT_DIR || path.join(E2E_DIR, '..', 'dist');
const SHOTS = process.env.E2E_SHOTS || path.join(E2E_DIR, 'shots');
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'img2prompt-picker-'));
function findChrome() {
  if (process.env.E2E_CHROME) return process.env.E2E_CHROME;
  const candidates = [
    '/opt/meta-chromium/chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ];
  return candidates.find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}
const CHROME_BIN = findChrome();
if (!CHROME_BIN) throw new Error('找不到 Chromium 可执行文件：请设置 E2E_CHROME 环境变量');
fs.mkdirSync(SHOTS, { recursive: true });

const report = { steps: [] };
function step(name, ok, detail = '') {
  report.steps.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

const FAKE_MODELS = {
  data: [
    { id: 'meta/llama-3.2-90b-vision-instruct' },
    { id: 'meta/llama-3.2-11b-vision-instruct' },
    { id: 'meta/llama-3.2-11b-vision-instruct' }, // 重复项，应被去重
    { id: 'google/gemma-3-27b-it' },
  ],
};

let context;
try {
  context = await chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME_BIN,
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--ignore-certificate-errors',
      `--load-extension=${EXT_DIR}`,
    ],
  });

  let extId;
  for (let i = 0; i < 30 && !extId; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const prefs = JSON.parse(fs.readFileSync(`${PROFILE}/Default/Preferences`, 'utf8'));
      const settings = prefs.extensions?.settings || {};
      for (const [id, v] of Object.entries(settings)) {
        if (JSON.stringify(v).includes('img2prompt/dist')) {
          extId = id;
          break;
        }
      }
    } catch {}
  }
  step('扩展已安装并拿到 ID', !!extId, extId || '');
  if (!extId) throw new Error('no extension id');

  const page = await context.newPage();
  let failMode = false;
  await page.route('**/models', async (route) => {
    if (failMode) {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ error: { message: 'Authorization failed' } }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(FAKE_MODELS),
      });
    }
  });

  await page.goto(`chrome-extension://${extId}/options/options.html`);
  await page.waitForTimeout(800);

  // 打开新增服务商编辑器并填写
  await page.click('#addProviderBtn');
  await page.waitForTimeout(300);
  await page.fill('#providerName', 'Picker E2E');
  await page.fill('#providerKey', 'sk-e2e-fake-key');

  // 场景 1：拉取成功
  await page.click('#fetchModelsBtn');
  await page.waitForSelector('#providerModelSelect:not([hidden])', { timeout: 10000 });
  const optionCount = await page.locator('#providerModelSelect option').count();
  const countText = (await page.textContent('#modelFetchStatus')) || '';
  step(
    '拉取后下拉出现且计数正确',
    optionCount === 4 && countText.includes('3'),
    `options=${optionCount} status=${countText.trim()}`
  );

  await page.selectOption('#providerModelSelect', 'meta/llama-3.2-11b-vision-instruct');
  const modelValue = await page.inputValue('#providerModel');
  step('选择模型即填入输入框', modelValue === 'meta/llama-3.2-11b-vision-instruct', modelValue);
  await page.screenshot({ path: path.join(SHOTS, 'model-picker.png') });

  await page.click('#saveProviderBtn');
  await page.waitForTimeout(500);
  const rowMeta = await page
    .locator('.provider-row', { hasText: 'Picker E2E' })
    .locator('.provider-meta')
    .textContent();
  step(
    '保存后服务商列表显示所选模型',
    (rowMeta || '').includes('meta/llama-3.2-11b-vision-instruct'),
    (rowMeta || '').trim()
  );

  // 场景 2：403 错误路径（重新打开编辑器，切到失败模式再拉）
  // 行内按钮顺序固定为 测试/编辑/删除（文案随浏览器语言变化，按位置取编辑按钮）
  await page
    .locator('.provider-row', { hasText: 'Picker E2E' })
    .locator('.row-actions button')
    .nth(1)
    .click();
  await page.waitForTimeout(300);
  failMode = true;
  await page.click('#fetchModelsBtn');
  await page.waitForTimeout(800);
  const selectHidden = await page.locator('#providerModelSelect').isHidden();
  const statusText = (await page.textContent('#status')) || '';
  step(
    '403 时报错且下拉保持隐藏',
    selectHidden && statusText.includes('403'),
    `hidden=${selectHidden} status=${statusText.trim().slice(0, 60)}`
  );

  await page.close();
} finally {
  if (context) await context.close().catch(() => {});
  fs.rmSync(PROFILE, { recursive: true, force: true });
}

const failed = report.steps.filter((s) => !s.ok);
console.log(
  failed.length === 0
    ? `MODEL PICKER E2E ALL PASS (${report.steps.length} steps)`
    : `MODEL PICKER E2E FAILED: ${failed.map((s) => s.name).join('; ')}`
);
process.exit(failed.length === 0 ? 0 : 1);
