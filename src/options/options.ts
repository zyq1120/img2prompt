/**
 * 设置页逻辑：读取 / 保存插件配置，支持一键测试连接。
 * API Key 仅写入 chrome.storage.local，不做任何网络上报。
 */
import { VisionApiError, testConnection } from '../lib/api.js';
import { applyI18n, t } from '../lib/i18n.js';
import { getSettings, saveSettings } from '../lib/storage.js';
import type { PromptLanguage } from '../lib/types.js';

/** 状态提示自动消失时长（毫秒） */
const STATUS_CLEAR_MS = 3000;

const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const baseUrlInput = document.getElementById('baseUrl') as HTMLInputElement;
const modelInput = document.getElementById('model') as HTMLInputElement;
const defaultLangSelect = document.getElementById('defaultLang') as HTMLSelectElement;
const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;
const testBtn = document.getElementById('testBtn') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLSpanElement;

let statusTimer: number | undefined;

applyI18n();
void loadForm();

saveBtn.addEventListener('click', async () => {
  await saveSettings(readForm());
  showStatus(t('optionsSaved'), true);
});

testBtn.addEventListener('click', async () => {
  const form = readForm();
  testBtn.disabled = true;
  showStatus(t('optionsTesting'), true);
  try {
    await testConnection({ apiKey: form.apiKey, baseUrl: form.baseUrl });
    showStatus(t('optionsTestOk'), true);
  } catch (error) {
    const message = error instanceof VisionApiError ? error.message : String(error);
    showStatus(message, false);
  } finally {
    testBtn.disabled = false;
  }
});

/** 从 storage 读取并回填表单 */
async function loadForm(): Promise<void> {
  const settings = await getSettings();
  apiKeyInput.value = settings.apiKey;
  baseUrlInput.value = settings.baseUrl;
  modelInput.value = settings.model;
  defaultLangSelect.value = settings.defaultLang;
}

/** 从表单读取设置对象 */
function readForm() {
  return {
    apiKey: apiKeyInput.value.trim(),
    baseUrl: baseUrlInput.value.trim(),
    model: modelInput.value.trim(),
    defaultLang: defaultLangSelect.value as PromptLanguage,
  };
}

/** 在按钮旁显示短暂的状态提示 */
function showStatus(message: string, ok: boolean): void {
  statusEl.textContent = message;
  statusEl.classList.toggle('ok', ok);
  statusEl.classList.toggle('err', !ok);
  window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    statusEl.textContent = '';
  }, STATUS_CLEAR_MS);
}
