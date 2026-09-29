/**
 * 设置页逻辑：多服务商管理、提示词模板管理、通用设置。
 * API Key 仅写入 chrome.storage.local，不做任何网络上报。
 */
import { VisionApiError, isInsecureBaseUrl, testConnection } from '../lib/api.js';
import { applyI18n, t } from '../lib/i18n.js';
import {
  addProvider,
  cleanApiKey,
  deleteCustomTemplate,
  deleteProvider,
  getActiveProvider,
  getSettings,
  getTemplates,
  saveCustomTemplate,
  saveSettings,
  setActiveProvider,
  updateProvider,
} from '../lib/storage.js';
import { truncate } from '../lib/text.js';
import type {
  OutputFormat,
  PluginSettings,
  PromptLanguage,
  PromptTemplate,
  ProviderConfig,
} from '../lib/types.js';

/** 状态提示自动消失时长（毫秒） */
const STATUS_CLEAR_MS = 3000;

const providerList = document.getElementById('providerList') as HTMLElement;
const addProviderBtn = document.getElementById('addProviderBtn') as HTMLButtonElement;
const providerEditor = document.getElementById('providerEditor') as HTMLElement;
const providerNameInput = document.getElementById('providerName') as HTMLInputElement;
const providerKeyInput = document.getElementById('providerKey') as HTMLInputElement;
const providerBaseUrlInput = document.getElementById('providerBaseUrl') as HTMLInputElement;
const providerModelInput = document.getElementById('providerModel') as HTMLInputElement;
const saveProviderBtn = document.getElementById('saveProviderBtn') as HTMLButtonElement;
const cancelProviderBtn = document.getElementById('cancelProviderBtn') as HTMLButtonElement;
const testDraftBtn = document.getElementById('testDraftBtn') as HTMLButtonElement;
const toggleKeyBtn = document.getElementById('toggleKeyBtn') as HTMLButtonElement;

/** 打开编辑器时重置 Key 为隐藏状态，避免上次的明文残留 */
function resetKeyVisibility(): void {
  providerKeyInput.type = 'password';
  toggleKeyBtn.textContent = t('optionsShowKey');
}

toggleKeyBtn.addEventListener('click', () => {
  const showing = providerKeyInput.type === 'text';
  providerKeyInput.type = showing ? 'password' : 'text';
  toggleKeyBtn.textContent = t(showing ? 'optionsShowKey' : 'optionsHideKey');
});

const templateList = document.getElementById('templateList') as HTMLElement;
const addTemplateBtn = document.getElementById('addTemplateBtn') as HTMLButtonElement;
const templateEditor = document.getElementById('templateEditor') as HTMLElement;
const templateNameInput = document.getElementById('templateName') as HTMLInputElement;
const templateFormatSelect = document.getElementById('templateFormat') as HTMLSelectElement;
const templateSystemInput = document.getElementById('templateSystem') as HTMLTextAreaElement;
const templateUserZhInput = document.getElementById('templateUserZh') as HTMLTextAreaElement;
const templateUserEnInput = document.getElementById('templateUserEn') as HTMLTextAreaElement;
const saveTemplateBtn = document.getElementById('saveTemplateBtn') as HTMLButtonElement;
const cancelTemplateBtn = document.getElementById('cancelTemplateBtn') as HTMLButtonElement;

const defaultLangSelect = document.getElementById('defaultLang') as HTMLSelectElement;
const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;
const testBtn = document.getElementById('testBtn') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLSpanElement;

let statusTimer: number | undefined;
/** 正在编辑的服务商 id；null 表示新增 */
let editingProviderId: string | null = null;
/** 正在编辑的模板 id；null 表示新增 */
let editingTemplateId: string | null = null;

applyI18n();
void refreshAll();

/* ————— 顶层事件 ————— */

saveBtn.addEventListener('click', async () => {
  const settings = await getSettings();
  settings.defaultLang = defaultLangSelect.value as PromptLanguage;
  await saveSettings(settings);
  showStatus(t('optionsSaved'), true);
});

testBtn.addEventListener('click', async () => {
  const settings = await getSettings();
  const provider = getActiveProvider(settings);
  testBtn.disabled = true;
  showStatus(t('optionsTesting'), true);
  try {
    await testConnection({ apiKey: provider.apiKey, baseUrl: provider.baseUrl });
    showStatus(t('optionsTestOk'), true);
  } catch (error) {
    showStatus(error instanceof VisionApiError ? error.message : String(error), false);
  } finally {
    testBtn.disabled = false;
  }
});

/* ————— 服务商管理 ————— */

addProviderBtn.addEventListener('click', () => {
  editingProviderId = null;
  providerNameInput.value = '';
  providerKeyInput.value = '';
  resetKeyVisibility();
  providerBaseUrlInput.value = 'https://api.openai.com/v1';
  providerModelInput.value = 'gpt-4o';
  providerEditor.hidden = false;
  providerNameInput.focus();
});

cancelProviderBtn.addEventListener('click', () => {
  providerEditor.hidden = true;
  editingProviderId = null;
});

/** 编辑器内测试：用表单里的值直接测，不用先保存 */
testDraftBtn.addEventListener('click', () => {
  const draft: ProviderConfig = {
    id: editingProviderId ?? 'draft',
    name: providerNameInput.value.trim() || t('optionsDraftProvider'),
    apiKey: cleanApiKey(providerKeyInput.value),
    baseUrl: providerBaseUrlInput.value.trim(),
    model: providerModelInput.value.trim(),
  };
  void testProvider(draft, testDraftBtn);
});

/** 校验服务商表单：名称/Base URL/模型均必填，Base URL 需合法 */
function validateProviderForm(draft: {
  name: string;
  baseUrl: string;
  model: string;
}): string | null {
  if (!draft.name.trim()) {
    return t('optionsProviderNameRequired');
  }
  if (!draft.baseUrl.trim()) {
    return t('optionsProviderBaseUrlRequired');
  }
  try {
    const url = new URL(draft.baseUrl.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return t('optionsProviderBaseUrlInvalid');
    }
  } catch {
    return t('optionsProviderBaseUrlInvalid');
  }
  if (!draft.model.trim()) {
    return t('optionsProviderModelRequired');
  }
  return null;
}

saveProviderBtn.addEventListener('click', async () => {
  const draft = {
    name: providerNameInput.value,
    apiKey: providerKeyInput.value,
    baseUrl: providerBaseUrlInput.value,
    model: providerModelInput.value,
  };
  const formError = validateProviderForm(draft);
  if (formError) {
    showStatus(formError, false);
    return;
  }
  if (editingProviderId) {
    await updateProvider(editingProviderId, draft);
  } else {
    await addProvider(draft);
  }
  providerEditor.hidden = true;
  editingProviderId = null;
  await refreshAll();
  showStatus(t('optionsSaved'), true);
});

/* ————— 模板管理 ————— */

addTemplateBtn.addEventListener('click', () => {
  editingTemplateId = null;
  templateNameInput.value = '';
  templateFormatSelect.value = 'text';
  templateSystemInput.value = '';
  templateUserZhInput.value = '';
  templateUserEnInput.value = '';
  templateEditor.hidden = false;
  templateNameInput.focus();
});

cancelTemplateBtn.addEventListener('click', () => {
  templateEditor.hidden = true;
  editingTemplateId = null;
});

saveTemplateBtn.addEventListener('click', async () => {
  if (!templateNameInput.value.trim()) {
    showStatus(t('optionsTemplateNameRequired'), false);
    return;
  }
  if (!templateSystemInput.value.trim()) {
    showStatus(t('optionsTemplateSystemRequired'), false);
    return;
  }
  await saveCustomTemplate({
    id: editingTemplateId ?? '',
    name: templateNameInput.value.trim(),
    systemPrompt: templateSystemInput.value,
    userTextZh: templateUserZhInput.value,
    userTextEn: templateUserEnInput.value,
    outputFormat: templateFormatSelect.value as OutputFormat,
  });
  templateEditor.hidden = true;
  editingTemplateId = null;
  await refreshAll();
  showStatus(t('optionsSaved'), true);
});

/* ————— 渲染 ————— */

async function refreshAll(): Promise<void> {
  const [settings, templates] = await Promise.all([getSettings(), getTemplates()]);
  defaultLangSelect.value = settings.defaultLang;
  renderProviderList(settings);
  renderTemplateList(settings, templates);
}

function renderProviderList(settings: PluginSettings): void {
  providerList.innerHTML = '';
  for (const provider of settings.providers) {
    providerList.appendChild(createProviderRow(provider, settings));
  }
}

function createProviderRow(provider: ProviderConfig, settings: PluginSettings): HTMLElement {
  const row = document.createElement('div');
  row.className = 'provider-row';

  const info = document.createElement('div');
  info.className = 'provider-info';
  const name = document.createElement('div');
  name.className = 'provider-name';
  name.textContent = provider.name;
  if (provider.id === settings.activeProviderId) {
    const badge = document.createElement('span');
    badge.className = 'badge active';
    badge.textContent = t('optionsBadgeActive');
    name.appendChild(badge);
  }
  const meta = document.createElement('div');
  meta.className = 'provider-meta';
  meta.textContent = `${provider.model} · ${provider.baseUrl}`;
  info.append(name, meta);

  const radioLabel = document.createElement('label');
  radioLabel.className = 'radio-label';
  const radio = document.createElement('input');
  radio.type = 'radio';
  radio.name = 'activeProvider';
  radio.checked = provider.id === settings.activeProviderId;
  radio.addEventListener('change', async () => {
    await setActiveProvider(provider.id);
    await refreshAll();
  });
  const radioText = document.createElement('span');
  radioText.textContent = t('optionsSetActive');
  radioLabel.append(radio, radioText);

  const actions = document.createElement('div');
  actions.className = 'row-actions';

  const rowTestBtn = document.createElement('button');
  rowTestBtn.className = 'text-btn';
  rowTestBtn.textContent = t('optionsTest');
  rowTestBtn.addEventListener('click', () => void testProvider(provider, rowTestBtn));

  const editBtn = document.createElement('button');
  editBtn.className = 'text-btn';
  editBtn.textContent = t('optionsEdit');
  editBtn.addEventListener('click', () => {
    editingProviderId = provider.id;
    providerNameInput.value = provider.name;
    providerKeyInput.value = provider.apiKey;
    resetKeyVisibility();
    providerBaseUrlInput.value = provider.baseUrl;
    providerModelInput.value = provider.model;
    providerEditor.hidden = false;
    providerEditor.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'text-btn danger';
  deleteBtn.textContent = t('optionsDelete');
  deleteBtn.disabled = settings.providers.length <= 1;
  deleteBtn.title = t('optionsDeleteProviderHint');
  deleteBtn.addEventListener('click', async () => {
    // 不可逆操作（API Key 一并丢失）：先确认
    if (!window.confirm(t('optionsConfirmDeleteProvider', provider.name))) {
      return;
    }
    await deleteProvider(provider.id);
    await refreshAll();
    showStatus(t('optionsDeleted'), true);
  });

  actions.append(rowTestBtn, editBtn, deleteBtn);
  row.append(info, radioLabel, actions);
  return row;
}

async function testProvider(provider: ProviderConfig, btn: HTMLButtonElement): Promise<void> {
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = t('optionsTesting');
  try {
    await testConnection({ apiKey: provider.apiKey, baseUrl: provider.baseUrl });
    let status = `${provider.name}: ${t('optionsTestOk')}`;
    // 明文 http + 非本地：连接虽通，但 Key 会裸奔，明确提醒
    if (isInsecureBaseUrl(provider.baseUrl)) {
      status += `（${t('optionsInsecureHttpWarning')}）`;
    }
    showStatus(status, true);
  } catch (error) {
    showStatus(
      `${provider.name}: ${error instanceof VisionApiError ? error.message : String(error)}`,
      false
    );
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function renderTemplateList(settings: PluginSettings, templates: PromptTemplate[]): void {
  templateList.innerHTML = '';
  for (const template of templates) {
    templateList.appendChild(createTemplateRow(template, settings));
  }
}

function createTemplateRow(template: PromptTemplate, settings: PluginSettings): HTMLElement {
  const row = document.createElement('div');
  row.className = 'template-row';

  const info = document.createElement('div');
  info.className = 'template-info';
  const name = document.createElement('div');
  name.className = 'template-name';
  name.textContent =
    template.nameI18nKey && t(template.nameI18nKey) ? t(template.nameI18nKey) : template.name;
  if (template.id === settings.activeTemplateId) {
    const badge = document.createElement('span');
    badge.className = 'badge active';
    badge.textContent = t('optionsBadgeActive');
    name.appendChild(badge);
  }
  if (template.outputFormat === 'json') {
    const jsonBadge = document.createElement('span');
    jsonBadge.className = 'badge json';
    jsonBadge.textContent = 'JSON';
    name.appendChild(jsonBadge);
  }
  const meta = document.createElement('div');
  meta.className = 'template-meta';
  meta.textContent = template.builtin
    ? t('optionsTemplateBuiltin')
    : truncate(template.systemPrompt.replace(/\s+/g, ' '), 90);
  info.append(name, meta);

  const radioLabel = document.createElement('label');
  radioLabel.className = 'radio-label';
  const radio = document.createElement('input');
  radio.type = 'radio';
  radio.name = 'activeTemplate';
  radio.checked = template.id === settings.activeTemplateId;
  radio.addEventListener('change', async () => {
    const next = await getSettings();
    next.activeTemplateId = template.id;
    await saveSettings(next);
    await refreshAll();
  });
  const radioText = document.createElement('span');
  radioText.textContent = t('optionsSetActive');
  radioLabel.append(radio, radioText);

  const actions = document.createElement('div');
  actions.className = 'row-actions';

  if (!template.builtin) {
    const editBtn = document.createElement('button');
    editBtn.className = 'text-btn';
    editBtn.textContent = t('optionsEdit');
    editBtn.addEventListener('click', () => {
      editingTemplateId = template.id;
      templateNameInput.value = template.name;
      templateFormatSelect.value = template.outputFormat;
      templateSystemInput.value = template.systemPrompt;
      templateUserZhInput.value = template.userTextZh;
      templateUserEnInput.value = template.userTextEn;
      templateEditor.hidden = false;
      templateEditor.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'text-btn danger';
    deleteBtn.textContent = t('optionsDelete');
    deleteBtn.addEventListener('click', async () => {
      // 不可逆操作（精心编写的 system prompt 永久丢失）：先确认
      if (!window.confirm(t('optionsConfirmDeleteTemplate', template.name))) {
        return;
      }
      await deleteCustomTemplate(template.id);
      await refreshAll();
      showStatus(t('optionsDeleted'), true);
    });
    actions.append(editBtn, deleteBtn);
  }

  row.append(info, radioLabel, actions);
  return row;
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

/** 超长文本截断并追加省略号 */
