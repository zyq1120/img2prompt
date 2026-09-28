/**
 * Content script：在页面右下角展示悬浮结果面板。
 *
 * 使用 Shadow DOM 隔离样式，避免被宿主页面 CSS 污染。
 * 只负责 UI 渲染；图片下载与模型调用全部在 background 完成，
 * 通过 chrome.runtime 消息与 background 通信。
 */
import { applyI18n, t } from '../lib/i18n.js';
import type {
  ExtensionMessage,
  GenerateRequestMessage,
  PanelState,
  PromptLanguage,
} from '../lib/types.js';

/** 面板根元素 ID（页面内唯一） */
const PANEL_ROOT_ID = 'img2prompt-panel-root';
/** 复制成功提示的显示时长（毫秒） */
const COPIED_TIP_DURATION_MS = 1500;

let currentLang: PromptLanguage = 'zh';
let currentText = '';
let currentState: PanelState = 'loading';

/** 入口：监听来自 background 的消息 */
chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === 'IMG2PROMPT_START') {
    showPanel();
    setState('loading');
  } else if (message.type === 'IMG2PROMPT_PANEL_STATE') {
    if (message.lang) {
      currentLang = message.lang;
    }
    if (message.state === 'result' && message.text) {
      currentText = message.text;
    }
    setState(message.state, message.text, message.error);
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
    body.innerHTML = `<div class="ip-loading"><span class="ip-spinner"></span><span>${escapeHtml(t('panelLoading'))}</span></div>`;
  } else if (state === 'result') {
    body.innerHTML = `<pre class="ip-result">${escapeHtml(text ?? currentText)}</pre>`;
    const copyBtn = shadow.querySelector<HTMLButtonElement>('.ip-copy');
    if (copyBtn) {
      copyBtn.disabled = false;
    }
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
      ?.addEventListener('click', () => requestGenerate(currentLang));
    shadow.querySelector('.ip-goto-settings')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'IMG2PROMPT_OPEN_OPTIONS' });
    });
  }
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
          requestGenerate(lang);
        }
      }
    });
  });
  shadow.querySelector('.ip-copy')?.addEventListener('click', async (event) => {
    const ok = await copyText(currentText);
    const btn = event.currentTarget as HTMLButtonElement;
    if (ok) {
      const original = btn.textContent;
      btn.textContent = t('panelCopied');
      setTimeout(() => {
        btn.textContent = original;
      }, COPIED_TIP_DURATION_MS);
    }
  });
}

/** 向 background 请求（重新）生成提示词 */
function requestGenerate(lang: PromptLanguage): void {
  setState('loading');
  const message: GenerateRequestMessage = {
    type: 'IMG2PROMPT_GENERATE',
    lang,
  };
  chrome.runtime.sendMessage(message);
}

/** 同步语言切换按钮的高亮状态 */
function syncLangButtons(shadow: ShadowRoot): void {
  shadow.querySelectorAll<HTMLButtonElement>('.ip-lang button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.lang === currentLang);
  });
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

/** 转义 HTML，防止模型返回内容破坏面板结构 */
function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 面板 HTML + CSS 模板（样式全部 scoped 在 shadow 内） */
function panelTemplate(): string {
  return `
  <style>
    :host { all: initial; }
    .ip-panel {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
      width: 360px; max-height: 60vh; display: flex; flex-direction: column;
      background: #ffffff; color: #1f2937; border-radius: 12px;
      box-shadow: 0 12px 40px rgba(0,0,0,.22);
      font-family: -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
      font-size: 13px; overflow: hidden;
    }
    .ip-header {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px; border-bottom: 1px solid #eef0f3;
      background: #f8fafc; font-weight: 600;
    }
    .ip-title { flex: 1; font-size: 13px; }
    .ip-lang { display: flex; border: 1px solid #dbe1e8; border-radius: 8px; overflow: hidden; }
    .ip-lang button {
      border: 0; background: #fff; color: #64748b; font-size: 12px;
      padding: 4px 10px; cursor: pointer;
    }
    .ip-lang button.active { background: #4f46e5; color: #fff; }
    .ip-close {
      border: 0; background: transparent; font-size: 18px; line-height: 1;
      color: #94a3b8; cursor: pointer; padding: 2px 6px;
    }
    .ip-close:hover { color: #334155; }
    .ip-body { padding: 12px; overflow-y: auto; white-space: pre-wrap; }
    .ip-result {
      margin: 0; font-family: inherit; font-size: 13px; line-height: 1.7;
      white-space: pre-wrap; word-break: break-word;
    }
    .ip-loading { display: flex; align-items: center; gap: 10px; color: #64748b; padding: 18px 4px; }
    .ip-spinner {
      width: 16px; height: 16px; border-radius: 50%;
      border: 2px solid #e2e8f0; border-top-color: #4f46e5;
      animation: ip-spin 0.8s linear infinite; flex: none;
    }
    @keyframes ip-spin { to { transform: rotate(360deg); } }
    .ip-error-title { font-weight: 600; color: #dc2626; margin-bottom: 6px; }
    .ip-error-msg { color: #64748b; line-height: 1.6; margin-bottom: 10px; }
    .ip-error-actions { display: flex; gap: 8px; }
    .ip-footer { padding: 10px 12px; border-top: 1px solid #eef0f3; display: flex; justify-content: flex-end; }
    .ip-btn, .ip-copy {
      border: 1px solid #dbe1e8; background: #fff; border-radius: 8px;
      padding: 6px 14px; font-size: 12px; cursor: pointer; color: #334155;
    }
    .ip-copy { background: #4f46e5; border-color: #4f46e5; color: #fff; }
    .ip-copy:disabled { opacity: .45; cursor: default; }
    .ip-btn:hover, .ip-copy:hover:not(:disabled) { filter: brightness(.96); }
  </style>
  <div class="ip-panel">
    <div class="ip-header">
      <span class="ip-title" data-i18n="panelTitle"></span>
      <span style="font-size:12px;color:#94a3b8" data-i18n="panelLangLabel"></span>
      <div class="ip-lang">
        <button data-lang="zh">中文</button>
        <button data-lang="en">EN</button>
      </div>
      <button class="ip-close" data-i18n-title="panelClose">×</button>
    </div>
    <div class="ip-body"></div>
    <div class="ip-footer">
      <button class="ip-copy" data-i18n="panelCopy" disabled></button>
    </div>
  </div>`;
}

export {};
