/**
 * Content script：在页面右下角展示悬浮结果面板，并承载选区截图 overlay。
 *
 * 使用 Shadow DOM 隔离面板样式，避免被宿主页面 CSS 污染。
 * 只负责 UI 渲染；图片下载与模型调用全部在 background 完成，
 * 通过 chrome.runtime 消息与 background 通信。
 */
import { applyI18n, t } from '../lib/i18n.js';
import { escapeHtml, renderRichText } from '../lib/rich-text.js';
import { getSettings, getTemplates, saveSettings } from '../lib/storage.js';
import type {
  ExtensionMessage,
  PanelState,
  PromptLanguage,
  PromptTemplate,
  StructuredPrompt,
} from '../lib/types.js';
import { startRegionSelect } from './region-selector.js';

/** 面板根元素 ID（页面内唯一） */
const PANEL_ROOT_ID = 'img2prompt-panel-root';
/** 复制成功提示的显示时长（毫秒） */
const COPIED_TIP_DURATION_MS = 1500;

let currentLang: PromptLanguage = 'zh';
let currentText = '';
let currentStructured: StructuredPrompt | undefined;
let currentState: PanelState = 'loading';
let currentTemplateId = '';
/** 用户点击"取消"后等待 background 回执的标记 */
let pendingCancel = false;
/** 上一次成功的结果（取消时恢复用） */
let lastGoodResult: { text: string; structured: StructuredPrompt | undefined } | null = null;

/** 入口：监听来自 background 的消息 */
chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === 'IMG2PROMPT_START') {
    lastGoodResult = null;
    pendingCancel = false;
    showPanel();
    void syncTemplateSelect();
    setState('loading');
  } else if (message.type === 'IMG2PROMPT_PANEL_STATE') {
    if (message.lang) {
      currentLang = message.lang;
    }
    if (message.state === 'result' && message.text) {
      currentText = message.text;
      currentStructured = message.structured;
      lastGoodResult = { text: message.text, structured: message.structured };
    }
    pendingCancel = false;
    setState(message.state, message.text, message.error);
  } else if (message.type === 'IMG2PROMPT_CANCELLED') {
    if (pendingCancel) {
      // 用户主动取消的回执：面板已在点击时本地恢复，这里仅清标记
      pendingCancel = false;
    }
    // 否则是旧请求被新请求取代，其中止回执无需处理
  } else if (message.type === 'IMG2PROMPT_REGION_SELECT') {
    startRegionSelect({
      onDone: (rect, devicePixelRatio) => {
        chrome.runtime.sendMessage({
          type: 'IMG2PROMPT_REGION_DONE',
          rect,
          devicePixelRatio,
        });
      },
      onCancel: () => {
        // Esc / 误触：静默收起，不打扰用户
      },
    });
  }
});

/** 创建（或复用）面板并显示 */
function showPanel(): void {
  if (document.getElementById(PANEL_ROOT_ID)) {
    return;
  }
  const root = document.createElement('div');
  root.id = PANEL_ROOT_ID;
  const shadow = root.attachShadow({ mode: 'open' });
  shadow.innerHTML = panelTemplate();
  applyI18n(shadow);
  bindEvents(shadow);
  document.documentElement.appendChild(root);
  syncLangButtons(shadow);
}

/** 同步模板下拉框的选项与当前值 */
async function syncTemplateSelect(): Promise<void> {
  const shadow = getShadow();
  const select = shadow?.querySelector<HTMLSelectElement>('.ip-template');
  if (!select) {
    return;
  }
  const [templates, settings] = await Promise.all([getTemplates(), getSettings()]);
  currentTemplateId = settings.activeTemplateId;
  select.innerHTML = '';
  for (const template of templates) {
    const option = document.createElement('option');
    option.value = template.id;
    option.textContent = templateDisplayName(template);
    if (template.outputFormat === 'json') {
      option.textContent += ' · JSON';
    }
    select.appendChild(option);
  }
  select.value = currentTemplateId;
}

/** 模板显示名：内置走 i18n，自定义用名称 */
function templateDisplayName(template: PromptTemplate): string {
  if (template.nameI18nKey) {
    const localized = t(template.nameI18nKey);
    if (localized) {
      return localized;
    }
  }
  return template.name;
}

/** 切换面板状态并重渲染 body */
function setState(state: PanelState, text?: string, error?: string): void {
  currentState = state;
  const shadow = getShadow();
  if (!shadow) {
    return;
  }
  const body = shadow.querySelector('.ip-body');
  if (!body) {
    return;
  }
  if (state === 'loading') {
    body.innerHTML = [
      `<div class="ip-loading"><span class="ip-spinner"></span><span>${escapeHtml(t('panelLoading'))}</span></div>`,
      `<div class="ip-loading-actions"><button class="ip-btn ip-cancel">${escapeHtml(t('panelCancel'))}</button></div>`,
    ].join('');
    shadow.querySelector('.ip-cancel')?.addEventListener('click', cancelGeneration);
    setCopyEnabled(shadow, false);
  } else if (state === 'result') {
    body.innerHTML = currentStructured
      ? renderStructured(currentStructured)
      : `<pre class="ip-result">${renderRichText(text ?? currentText)}</pre>`;
    setCopyEnabled(shadow, true);
  } else {
    const goSettings = errorNeedsSettings(error);
    body.innerHTML = [
      `<div class="ip-error-title">${escapeHtml(t('panelErrorTitle'))}</div>`,
      `<div class="ip-error-msg">${escapeHtml(error ?? '')}</div>`,
      `<div class="ip-error-actions">`,
      `<button class="ip-btn ip-retry">${escapeHtml(t('panelRetry'))}</button>`,
      goSettings
        ? `<button class="ip-btn ip-goto-settings">${escapeHtml(t('panelGoSettings'))}</button>`
        : '',
      `</div>`,
    ].join('');
    shadow
      .querySelector('.ip-retry')
      ?.addEventListener('click', () => requestGenerate(currentLang, currentTemplateId));
    shadow.querySelector('.ip-goto-settings')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'IMG2PROMPT_OPEN_OPTIONS' });
    });
    setCopyEnabled(shadow, false);
  }
}

/** 渲染结构化 JSON 结果 */
function renderStructured(structured: StructuredPrompt): string {
  const rows: string[] = [];
  if (structured.style) {
    rows.push(renderKv(t('panelJsonStyle'), structured.style));
  }
  if (structured.mood) {
    rows.push(renderKv(t('panelJsonMood'), structured.mood));
  }
  if (structured.colors.length > 0) {
    rows.push(renderKv(t('panelJsonColors'), structured.colors.join(' · ')));
  }
  const tags =
    structured.tags.length > 0
      ? `<div class="ip-tags">${structured.tags.map((tag) => `<span class="ip-tag">${escapeHtml(tag)}</span>`).join('')}</div>`
      : '';
  return [
    `<pre class="ip-result">${renderRichText(currentText)}</pre>`,
    rows.length > 0 ? `<div class="ip-kv-list">${rows.join('')}</div>` : '',
    tags,
  ].join('');
}

function renderKv(label: string, value: string): string {
  return `<div class="ip-kv"><span class="ip-kv-label">${escapeHtml(label)}</span><span class="ip-kv-value">${escapeHtml(value)}</span></div>`;
}

/** 绑定面板内按钮事件 */
function bindEvents(shadow: ShadowRoot): void {
  shadow.querySelector('.ip-close')?.addEventListener('click', () => {
    document.getElementById(PANEL_ROOT_ID)?.remove();
  });
  shadow.querySelectorAll<HTMLButtonElement>('.ip-lang button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const lang = btn.dataset.lang as PromptLanguage;
      if (lang !== currentLang) {
        currentLang = lang;
        syncLangButtons(shadow);
        // 只有已有结果（或出错）时才重新请求；loading 中切换仅改语言偏好
        if (currentState !== 'loading') {
          requestGenerate(lang, currentTemplateId);
        }
      }
    });
  });
  shadow.querySelector('.ip-template')?.addEventListener('change', (event) => {
    const select = event.currentTarget as HTMLSelectElement;
    const templateId = select.value;
    if (templateId && templateId !== currentTemplateId) {
      currentTemplateId = templateId;
      // 持久化为默认模板，保持与设置页一致
      void (async () => {
        const settings = await getSettings();
        settings.activeTemplateId = templateId;
        await saveSettings(settings);
      })();
      if (currentState !== 'loading') {
        requestGenerate(currentLang, templateId);
      }
    }
  });
  shadow.querySelector('.ip-copy')?.addEventListener('click', (event) => {
    // 注意：必须在 await 之前捕获按钮引用；await 之后 event.currentTarget 已被回收为 null
    const btn = event.currentTarget as HTMLButtonElement | null;
    void (async () => {
      const ok = await copyText(currentText);
      if (ok && btn) {
        const original = btn.textContent;
        btn.textContent = t('panelCopied');
        setTimeout(() => {
          btn.textContent = original;
        }, COPIED_TIP_DURATION_MS);
      }
    })();
  });
}

/** 用户点击取消：本地立即恢复上一次状态，并通知 background 中止请求 */
function cancelGeneration(): void {
  pendingCancel = true;
  chrome.runtime.sendMessage({ type: 'IMG2PROMPT_CANCEL' });
  const shadow = getShadow();
  if (!shadow) {
    return;
  }
  if (lastGoodResult) {
    currentText = lastGoodResult.text;
    currentStructured = lastGoodResult.structured;
    setState('result', currentText);
  } else {
    document.getElementById(PANEL_ROOT_ID)?.remove();
  }
}

/** 向 background 请求（重新）生成提示词 */
function requestGenerate(lang: PromptLanguage, templateId: string): void {
  setState('loading');
  chrome.runtime.sendMessage({
    type: 'IMG2PROMPT_GENERATE',
    lang,
    templateId,
  });
}

/** 同步语言切换按钮的高亮状态 */
function syncLangButtons(shadow: ShadowRoot): void {
  shadow.querySelectorAll<HTMLButtonElement>('.ip-lang button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.lang === currentLang);
  });
}

/** 设置复制按钮可用状态 */
function setCopyEnabled(shadow: ShadowRoot, enabled: boolean): void {
  const copyBtn = shadow.querySelector<HTMLButtonElement>('.ip-copy');
  if (copyBtn) {
    copyBtn.disabled = !enabled;
  }
}

/** 错误信息是否与缺配置相关（需要引导去设置页） */
function errorNeedsSettings(error?: string): boolean {
  return !!error && /API Key|Base URL/.test(error);
}

function getShadow(): ShadowRoot | null {
  const root = document.getElementById(PANEL_ROOT_ID);
  return root?.shadowRoot ?? null;
}

/** 复制文本到剪贴板（优先 Clipboard API，降级 execCommand） */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** 面板 HTML + CSS 模板（样式全部 scoped 在 shadow 内，遵循 Apple Human Interface Guidelines） */
function panelTemplate(): string {
  return `
  <style>
    :host { all: initial; }
    /* —— Apple HIG：Deference（磨砂质感让内容成为主角）、Depth（ layered 阴影）、Clarity（系统字体层级） —— */
    .ip-panel {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
      width: 360px; max-height: 62vh; display: flex; flex-direction: column;
      background: rgba(255, 255, 255, 0.72);
      -webkit-backdrop-filter: blur(24px) saturate(180%);
      backdrop-filter: blur(24px) saturate(180%);
      color: #000; border-radius: 16px; overflow: hidden;
      border: 0.5px solid rgba(0, 0, 0, 0.08);
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.08);
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display",
        "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif;
      font-size: 13px; line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      animation: ip-in 0.28s cubic-bezier(0.32, 0.72, 0.35, 1);
    }
    @keyframes ip-in {
      from { opacity: 0; transform: translateY(10px) scale(0.98); }
      to { opacity: 1; transform: none; }
    }
    .ip-header {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 12px 12px 14px;
      border-bottom: 0.5px solid rgba(60, 60, 67, 0.12);
    }
    .ip-logo {
      width: 24px; height: 24px; flex: none;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 7px;
      background: linear-gradient(135deg, #4da6ff, #007aff);
      box-shadow: 0 2px 6px rgba(10, 132, 255, 0.35);
    }
    .ip-logo svg { width: 14px; height: 14px; fill: #fff; }
    .ip-title { flex: 1; font-size: 14px; font-weight: 600; letter-spacing: -0.01em; }
    .ip-lang-label { font-size: 12px; color: #8e8e93; }
    /* iOS 风格分段控件：灰色轨道 + 滑动白色滑块 */
    .ip-lang {
      position: relative; display: flex; flex: none;
      background: rgba(120, 120, 128, 0.16);
      border-radius: 9px; padding: 2px;
    }
    .ip-lang::before {
      content: ""; position: absolute; top: 2px; bottom: 2px; left: 2px;
      width: calc(50% - 2px);
      background: #fff; border-radius: 7px;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
      transition: transform 0.25s cubic-bezier(0.32, 0.72, 0.35, 1);
    }
    .ip-lang:has(button[data-lang="en"].active)::before { transform: translateX(100%); }
    .ip-lang button {
      position: relative; z-index: 1; flex: 1;
      border: 0; background: transparent; color: #3c3c43;
      font-size: 12px; font-weight: 500; font-family: inherit;
      padding: 4px 12px; cursor: pointer; border-radius: 7px;
      transition: color 0.2s;
    }
    .ip-lang button.active { color: #000; font-weight: 600; }
    .ip-lang button:not(.active):hover { color: #000; }
    .ip-close {
      width: 26px; height: 26px; flex: none;
      display: inline-flex; align-items: center; justify-content: center;
      border: 0; border-radius: 50%; cursor: pointer;
      background: rgba(120, 120, 128, 0.16); color: #3c3c43;
      font-size: 14px; line-height: 1; padding: 0;
      transition: background 0.15s;
    }
    .ip-close:hover { background: rgba(120, 120, 128, 0.28); }
    .ip-body { padding: 14px; overflow-y: auto; }
    .ip-result {
      margin: 0; font-family: inherit; font-size: 13px; line-height: 1.65;
      white-space: pre-wrap; word-break: break-word; color: #1c1c1e;
    }
    .ip-result strong { font-weight: 700; }
    .ip-loading {
      display: flex; align-items: center; gap: 10px;
      color: #8e8e93; padding: 20px 4px 8px; font-size: 13px;
    }
    .ip-loading-actions { display: flex; justify-content: center; padding: 4px 0 12px; }
    .ip-spinner {
      width: 18px; height: 18px; border-radius: 50%; flex: none;
      border: 2px solid rgba(120, 120, 128, 0.2); border-top-color: #007aff;
      animation: ip-spin 0.8s linear infinite;
    }
    @keyframes ip-spin { to { transform: rotate(360deg); } }
    .ip-error-title { font-weight: 600; font-size: 14px; color: #ff3b30; margin-bottom: 6px; }
    .ip-error-msg { color: #3c3c43; line-height: 1.6; margin-bottom: 12px; font-size: 13px; }
    .ip-error-actions { display: flex; gap: 8px; }
    .ip-kv-list { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
    .ip-kv {
      display: flex; gap: 8px; font-size: 12px; line-height: 1.5;
      background: rgba(120, 120, 128, 0.1); border-radius: 8px; padding: 6px 10px;
    }
    .ip-kv-label { flex: none; color: #8e8e93; }
    .ip-kv-value { color: #1c1c1e; word-break: break-word; }
    .ip-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .ip-tag {
      font-size: 12px; color: #007aff;
      background: rgba(0, 122, 255, 0.1); border-radius: 20px; padding: 3px 10px;
      word-break: break-word;
    }
    .ip-footer {
      padding: 10px 12px;
      border-top: 0.5px solid rgba(60, 60, 67, 0.12);
      display: flex; align-items: center; gap: 8px;
    }
    .ip-template {
      flex: 1; min-width: 0;
      font-family: inherit; font-size: 12px; color: #3c3c43;
      background: rgba(120, 120, 128, 0.12);
      border: 0; border-radius: 8px; padding: 7px 8px; cursor: pointer;
      text-overflow: ellipsis;
    }
    .ip-template:focus-visible { outline: 2px solid #007aff; outline-offset: -2px; }
    .ip-btn, .ip-copy {
      border: 0; border-radius: 10px; cursor: pointer; font-family: inherit;
      padding: 7px 16px; font-size: 13px; font-weight: 600;
      transition: filter 0.15s, transform 0.1s;
    }
    .ip-btn:active, .ip-copy:active:not(:disabled) { transform: scale(0.97); }
    .ip-btn { background: rgba(120, 120, 128, 0.16); color: #007aff; }
    .ip-btn:hover { filter: brightness(0.96); }
    .ip-copy { background: #007aff; color: #fff; box-shadow: 0 2px 8px rgba(0, 122, 255, 0.35); flex: none; }
    .ip-copy:hover:not(:disabled) { filter: brightness(1.06); }
    .ip-copy:disabled { opacity: 0.45; cursor: default; box-shadow: none; }
    /* 深色模式：Apple HIG 强调的完整 dark appearance */
    @media (prefers-color-scheme: dark) {
      .ip-panel {
        background: rgba(28, 28, 30, 0.72);
        color: #fff;
        border-color: rgba(255, 255, 255, 0.12);
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.3);
      }
      .ip-header { border-bottom-color: rgba(84, 84, 88, 0.6); }
      .ip-lang { background: rgba(255, 255, 255, 0.14); }
      .ip-lang::before { background: #636366; }
      .ip-lang button { color: #ebebf5; }
      .ip-lang button.active { color: #fff; }
      .ip-lang button:not(.active):hover { color: #fff; }
      .ip-close { background: rgba(255, 255, 255, 0.14); color: #ebebf5; }
      .ip-close:hover { background: rgba(255, 255, 255, 0.24); }
      .ip-result { color: #f2f2f7; }
      .ip-error-msg { color: #ebebf5; }
      .ip-kv { background: rgba(255, 255, 255, 0.08); }
      .ip-kv-label { color: #98989f; }
      .ip-kv-value { color: #f2f2f7; }
      .ip-tag { color: #0a84ff; background: rgba(10, 132, 255, 0.16); }
      .ip-template { background: rgba(255, 255, 255, 0.12); color: #ebebf5; }
      .ip-template option { color: #000; }
      .ip-footer { border-top-color: rgba(84, 84, 88, 0.6); }
      .ip-btn { background: rgba(255, 255, 255, 0.14); color: #0a84ff; }
      .ip-copy { background: #0a84ff; }
    }
    @media (prefers-reduced-motion: reduce) {
      .ip-panel { animation: none; }
      .ip-spinner { animation-duration: 1.6s; }
      .ip-lang::before { transition: none; }
    }
  </style>
  <div class="ip-panel">
    <div class="ip-header">
      <span class="ip-logo" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M12 2c.7 4.9 3.3 7.5 8.2 8.2-4.9.7-7.5 3.3-8.2 8.2-.7-4.9-3.3-7.5-8.2-8.2 4.9-.7 7.5-3.3 8.2-8.2z"/><path d="M19 2.5c.3 2 1.3 3 3.3 3.3-2 .3-3 1.3-3.3 3.3-.3-2-1.3-3-3.3-3.3 2-.3 3-1.3 3.3-3.3z" opacity=".85"/></svg>
      </span>
      <span class="ip-title" data-i18n="panelTitle"></span>
      <span class="ip-lang-label" data-i18n="panelLangLabel"></span>
      <div class="ip-lang">
        <button data-lang="zh">中文</button>
        <button data-lang="en">EN</button>
      </div>
      <button class="ip-close" data-i18n-title="panelClose">×</button>
    </div>
    <div class="ip-body"></div>
    <div class="ip-footer">
      <select class="ip-template" data-i18n-title="panelTemplateTitle"></select>
      <button class="ip-copy" data-i18n="panelCopy" disabled></button>
    </div>
  </div>`;
}

export {};
