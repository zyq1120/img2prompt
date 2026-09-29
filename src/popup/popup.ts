/**
 * Popup：上传识别 + 历史记录（搜索 / 收藏）+ 服务商与模板快捷切换。
 *
 * - 顶部：当前服务商、当前模板下拉切换
 * - 拖拽 / 点击上传图片：popup 内直接压缩并调用模型，结果展示在 popup 中
 * - 历史：关键词搜索、仅看收藏、星标收藏、点击复制
 */
import { applyI18n, t } from '../lib/i18n.js';
import { THUMBNAIL_EDGE_PX, fileToCompressedDataUrl } from '../lib/image.js';
import { truncate } from '../lib/text.js';
import {
  addHistoryItem,
  clearHistory,
  deleteHistoryItem,
  getActiveProvider,
  getHistory,
  getSettings,
  getTemplate,
  getTemplates,
  saveSettings,
  searchHistory,
  setActiveProvider,
  toggleFavorite,
} from '../lib/storage.js';
import { generateImagePrompt, VisionApiError } from '../lib/api.js';
import type { HistoryItem, PromptTemplate } from '../lib/types.js';

/** 列表中提示词摘要的最大字符数 */
const SNIPPET_MAX_CHARS = 80;
/** 复制成功反馈的显示时长（毫秒） */
const COPIED_TIP_MS = 1200;
/** 搜索输入防抖（毫秒） */
const SEARCH_DEBOUNCE_MS = 250;

const listEl = document.getElementById('historyList') as HTMLElement;
const emptyEl = document.getElementById('emptyState') as HTMLElement;
const setupApiBtn = document.getElementById('setupApiBtn') as HTMLButtonElement;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
const optionsBtn = document.getElementById('optionsBtn') as HTMLButtonElement;
const providerSelect = document.getElementById('providerSelect') as HTMLSelectElement;
const templateSelect = document.getElementById('templateSelect') as HTMLSelectElement;
const dropzone = document.getElementById('dropzone') as HTMLElement;
const fileInput = document.getElementById('fileInput') as HTMLInputElement;
const uploadResult = document.getElementById('uploadResult') as HTMLElement;
const uploadThumb = document.getElementById('uploadThumb') as HTMLImageElement;
const uploadText = document.getElementById('uploadText') as HTMLElement;
const uploadCopy = document.getElementById('uploadCopy') as HTMLButtonElement;
const uploadCancel = document.getElementById('uploadCancel') as HTMLButtonElement;
const uploadSpinner = document.getElementById('uploadSpinner') as HTMLElement;
const searchInput = document.getElementById('searchInput') as HTMLInputElement;
const favFilterBtn = document.getElementById('favFilterBtn') as HTMLButtonElement;
const emptyDefaultText = document.getElementById('emptyDefaultText') as HTMLElement;
const emptySearchText = document.getElementById('emptySearchText') as HTMLElement;

let favoritesOnly = false;
let searchTimer: number | undefined;
/** 当前上传任务的取消控制器 */
let uploadAborter: AbortController | null = null;
/** 当前上传结果正文（复制用） */
let uploadPromptText = '';

applyI18n();
void init();

async function init(): Promise<void> {
  await Promise.all([renderProviderSelect(), renderTemplateSelect(), renderHistory()]);
  bindEvents();
}

function bindEvents(): void {
  optionsBtn.addEventListener('click', () => {
    void chrome.runtime.openOptionsPage();
  });

  // options 页改了服务商/模板/历史时，popup 开着也能刷新下拉框与列表
  chrome.storage.onChanged.addListener((changes) => {
    if (changes['img2prompt.settings'] || changes['img2prompt.history']) {
      void renderProviderSelect();
      void renderTemplateSelect();
      void renderHistory();
    }
  });

  setupApiBtn.addEventListener('click', () => {
    void chrome.runtime.openOptionsPage();
  });

  clearBtn.addEventListener('click', async () => {
    // 不可逆操作：先确认，并明确告知作用范围（全部非收藏记录，不只是当前过滤可见的）
    const history = await getHistory();
    const count = history.filter((h) => !h.favorite).length;
    if (count === 0) {
      return;
    }
    if (!window.confirm(t('popupConfirmClearHistory', String(count)))) {
      return;
    }
    await clearHistory({ keepFavorites: true });
    await renderHistory();
  });

  providerSelect.addEventListener('change', async () => {
    if (providerSelect.value) {
      await setActiveProvider(providerSelect.value);
    }
  });

  templateSelect.addEventListener('change', async () => {
    if (templateSelect.value) {
      const settings = await getSettings();
      settings.activeTemplateId = templateSelect.value;
      await saveSettings(settings);
    }
  });

  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) {
      void handleUpload(file);
    }
  });
  for (const eventName of ['dragenter', 'dragover'] as const) {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.add('dragover');
    });
  }
  for (const eventName of ['dragleave', 'drop'] as const) {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.remove('dragover');
    });
  }
  dropzone.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      void handleUpload(file);
    }
  });

  uploadCopy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(uploadPromptText);
      const original = uploadCopy.textContent;
      uploadCopy.textContent = t('popupCopied');
      setTimeout(() => {
        uploadCopy.textContent = original;
      }, COPIED_TIP_MS);
    } catch {
      // 剪贴板不可用时静默忽略
    }
  });
  uploadCancel.addEventListener('click', () => {
    uploadAborter?.abort();
  });

  searchInput.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      void renderHistory();
    }, SEARCH_DEBOUNCE_MS);
  });
  favFilterBtn.addEventListener('click', () => {
    favoritesOnly = !favoritesOnly;
    favFilterBtn.setAttribute('aria-pressed', String(favoritesOnly));
    favFilterBtn.textContent = favoritesOnly ? '★' : '☆';
    void renderHistory();
  });
}

/** 渲染服务商下拉 */
async function renderProviderSelect(): Promise<void> {
  const settings = await getSettings();
  providerSelect.innerHTML = '';
  for (const provider of settings.providers) {
    const option = document.createElement('option');
    option.value = provider.id;
    option.textContent = provider.name;
    providerSelect.appendChild(option);
  }
  providerSelect.value = settings.activeProviderId;
}

/** 渲染模板下拉 */
async function renderTemplateSelect(): Promise<void> {
  const [templates, settings] = await Promise.all([getTemplates(), getSettings()]);
  templateSelect.innerHTML = '';
  for (const template of templates) {
    const option = document.createElement('option');
    option.value = template.id;
    option.textContent =
      template.nameI18nKey && t(template.nameI18nKey) ? t(template.nameI18nKey) : template.name;
    if (template.outputFormat === 'json') {
      option.textContent += ' · JSON';
    }
    templateSelect.appendChild(option);
  }
  templateSelect.value = settings.activeTemplateId;
}

/** 处理图片上传：压缩 → 调模型 → 展示 → 存历史 */
async function handleUpload(file: File): Promise<void> {
  // 取消上一次未完成的上传任务
  uploadAborter?.abort();
  const aborter = new AbortController();
  uploadAborter = aborter;

  uploadResult.hidden = false;
  uploadThumb.removeAttribute('src');
  uploadText.classList.remove('is-error');
  uploadText.textContent = t('popupUploading');
  uploadSpinner.hidden = false;
  uploadCopy.hidden = true;
  uploadCancel.hidden = false;
  uploadPromptText = '';

  try {
    const [imageDataUrl, settings] = await Promise.all([
      fileToCompressedDataUrl(file),
      getSettings(),
    ]);
    if (aborter.signal.aborted) {
      return;
    }
    uploadThumb.src = imageDataUrl;

    const provider = getActiveProvider(settings);
    const template: PromptTemplate = await getTemplate(settings.activeTemplateId);
    const result = await generateImagePrompt({
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      model: provider.model,
      imageDataUrl,
      lang: settings.defaultLang,
      template,
      signal: aborter.signal,
    });

    uploadPromptText = result.text;
    uploadText.textContent = result.text;
    uploadCopy.hidden = false;

    // 存历史（缩略图单独捕获失败不影响）
    try {
      const thumbnail = await fileToCompressedDataUrl(file, THUMBNAIL_EDGE_PX);
      const historyEntry: Parameters<typeof addHistoryItem>[0] = {
        imageUrl: '',
        source: 'upload',
        thumbnail,
        prompt: result.text,
        lang: settings.defaultLang,
        model: provider.model,
        providerName: provider.name,
        templateId: template.id,
      };
      if (result.format === 'json') {
        historyEntry.structured = result.structured;
      }
      await addHistoryItem(historyEntry);
      await renderHistory();
    } catch (historyError) {
      console.warn('[img2prompt] 历史记录保存失败', historyError);
    }
  } catch (error) {
    if (aborter.signal.aborted) {
      // 被取消/被新任务取代：只有仍是当前任务时才复位 UI，
      // 否则新任务的界面会被旧任务的收尾逻辑隐藏
      if (uploadAborter === aborter) {
        uploadResult.hidden = true;
      }
      return;
    }
    uploadText.classList.add('is-error');
    if (error instanceof VisionApiError) {
      uploadText.textContent = error.message;
    } else if (error instanceof Error && error.message === 'file-too-large') {
      uploadText.textContent = t('popupFileTooLarge');
    } else {
      uploadText.textContent = t('popupUploadInvalid');
    }
  } finally {
    // 只有当前任务才能收尾 UI 并释放 uploadAborter；
    // 被取代的旧任务静默退出，避免藏掉新任务的 spinner/取消按钮
    if (uploadAborter === aborter) {
      uploadSpinner.hidden = true;
      uploadCancel.hidden = true;
      uploadAborter = null;
    }
  }
}

/** 拉取（搜索/过滤后的）历史并渲染列表 */
async function renderHistory(): Promise<void> {
  const history = await searchHistory(searchInput.value, { favoritesOnly });
  const settings = await getSettings();
  // 新用户：没有任何服务商填了 Key，空状态给出去配置的入口
  const needsSetup = !settings.providers.some((p) => p.apiKey.trim() !== '');
  listEl.innerHTML = '';
  emptyEl.hidden = history.length > 0;
  setupApiBtn.hidden = history.length > 0 || !needsSetup;
  clearBtn.hidden = history.length === 0;

  // 区分"无历史"与"搜索无匹配"两种空状态，避免用户误以为记录丢失
  const searching = searchInput.value.trim() !== '' || favoritesOnly;
  emptyDefaultText.hidden = searching;
  emptySearchText.hidden = !searching;
  if (searching) {
    emptySearchText.textContent = t('popupSearchNoMatch', searchInput.value.trim() || '★');
    setupApiBtn.hidden = true;
  }

  for (const item of history) {
    listEl.appendChild(createItemElement(item));
  }
}

/** 构建单条历史记录的 DOM */
function createItemElement(item: HistoryItem): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'history-item';

  const button = document.createElement('button');
  button.className = 'history-main';
  button.type = 'button';
  button.style.cssText =
    'all: unset; display: flex; gap: 12px; align-items: flex-start; flex: 1; min-width: 0; cursor: pointer;';

  const thumb = document.createElement('img');
  thumb.className = 'thumb';
  thumb.src = item.thumbnail;
  thumb.alt = '';

  const body = document.createElement('div');
  body.className = 'item-body';

  const snippet = document.createElement('p');
  snippet.className = 'snippet';
  snippet.textContent = truncate(item.prompt, SNIPPET_MAX_CHARS);

  const meta = document.createElement('div');
  meta.className = 'meta';
  const langBadge = document.createElement('span');
  langBadge.className = 'lang-badge';
  langBadge.textContent = item.lang === 'zh' ? '中文' : 'EN';
  const providerBadge = document.createElement('span');
  providerBadge.textContent = item.providerName || item.model;
  const time = document.createElement('time');
  time.textContent = new Date(item.createdAt).toLocaleString();
  meta.append(langBadge, providerBadge, time);

  const tip = document.createElement('span');
  tip.className = 'copied-tip';
  tip.textContent = t('popupCopied');
  tip.hidden = true;

  body.append(snippet, meta);
  button.append(thumb, body, tip);

  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(item.prompt);
      tip.hidden = false;
      setTimeout(() => {
        tip.hidden = true;
      }, COPIED_TIP_MS);
    } catch {
      // 剪贴板不可用时静默忽略（popup 关闭即消失，不打扰用户）
    }
  });

  const favBtn = document.createElement('button');
  favBtn.className = 'fav-btn';
  favBtn.type = 'button';
  favBtn.setAttribute('aria-pressed', String(item.favorite));
  favBtn.setAttribute('data-i18n-title', 'popupFavTitle');
  favBtn.title = t('popupFavTitle');
  favBtn.textContent = item.favorite ? '★' : '☆';
  favBtn.addEventListener('click', async (event) => {
    event.stopPropagation();
    const next = await toggleFavorite(item.id);
    favBtn.setAttribute('aria-pressed', String(next));
    favBtn.textContent = next ? '★' : '☆';
    if (favoritesOnly && !next) {
      await renderHistory();
    }
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-btn';
  deleteBtn.type = 'button';
  deleteBtn.setAttribute('data-i18n-title', 'popupDeleteRecord');
  deleteBtn.title = t('popupDeleteRecord');
  deleteBtn.setAttribute('aria-label', t('popupDeleteRecord'));
  deleteBtn.textContent = '×';
  deleteBtn.addEventListener('click', async (event) => {
    event.stopPropagation();
    if (!window.confirm(t('popupConfirmDeleteRecord'))) {
      return;
    }
    await deleteHistoryItem(item.id);
    await renderHistory();
  });

  wrapper.append(button, favBtn, deleteBtn);
  return wrapper;
}
