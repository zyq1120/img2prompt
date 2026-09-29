// 审计专项 E2E：popup 历史单条删除 / 清空确认 / storage.onChanged 自动刷新
import { chromium } from 'playwright-core';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXT_DIR = path.join(E2E_DIR, '..', 'dist');
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'img2prompt-audit-'));
const E2E_PROXY = process.env.E2E_PROXY || '';
const CHROME_BIN = process.env.E2E_CHROME || '/opt/meta-chromium/chrome';

const report = { steps: [] };
function step(name, ok, detail = '') {
  report.steps.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

const ITEM = (n) => ({
  id: `audit-${n}`,
  createdAt: Date.now() - n * 1000,
  favorite: false,
  imageUrl: `https://example.com/${n}.png`,
  source: 'context-menu',
  thumbnail: 'data:image/png;base64,iVBOR',
  prompt: `审计测试提示词 ${n}`,
  lang: 'zh',
  model: 'gpt-4o',
  providerName: 'Default',
  templateId: 'general',
});

let context, extId;
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
  if (!extId) throw new Error('no ext id');

  const popup = await context.newPage();
  let dialogAction = 'accept';
  popup.on('dialog', (d) => {
    if (dialogAction === 'accept') void d.accept();
    else void d.dismiss();
  });
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);

  // 播种 2 条历史
  await popup.evaluate((items) => chrome.storage.local.set({ 'img2prompt.history': items }), [ITEM(1), ITEM(2)]);
  await popup.waitForTimeout(800);
  let count = await popup.locator('.history-item').count();
  step('storage.onChanged：外部写入后 popup 自动刷新', count === 2, `count=${count}`);

  // 单条删除按钮存在且带确认
  const delBtn = popup.locator('.history-item .delete-btn').first();
  step('单条删除按钮渲染', (await delBtn.count()) === 1);
  await delBtn.click();
  await popup.waitForTimeout(800);
  count = await popup.locator('.history-item').count();
  step('确认后单条删除生效', count === 1, `count=${count}`);

  // 清空：先取消一次，再确认一次
  dialogAction = 'dismiss'; // 第一次：取消
  await popup.locator('#clearBtn').click();
  await popup.waitForTimeout(500);
  count = await popup.locator('.history-item').count();
  step('清空确认框"取消"后记录保留', count === 1, `count=${count}`);

  dialogAction = 'accept'; // 第二次：确认
  await popup.locator('#clearBtn').click();
  await popup.waitForTimeout(800);
  count = await popup.locator('.history-item').count();
  const emptyVisible = await popup.locator('#emptyState').isVisible().catch(() => false);
  step('清空确认后历史为空且显示空状态', count === 0 && emptyVisible, `count=${count}`);

  // 搜索无匹配空状态（与真正无历史区分）
  await popup.evaluate((items) => chrome.storage.local.set({ 'img2prompt.history': items }), [ITEM(1)]);
  await popup.waitForTimeout(600);
  await popup.fill('#searchInput', '不可能匹配的关键字zzz');
  await popup.waitForTimeout(400);
  const searchEmpty = await popup.locator('#emptySearchText').isVisible().catch(() => false);
  step('搜索无匹配显示专用空状态', searchEmpty);

  await popup.close();
  await context.close();
} catch (e) {
  step('脚本异常', false, String(e).slice(0, 200));
  try { await context?.close(); } catch {}
}
const failed = report.steps.filter((s) => !s.ok).length;
console.log(`\n==== 结果：${report.steps.length - failed}/${report.steps.length} 通过 ====`);
process.exit(failed ? 1 : 0);
