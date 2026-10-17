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
/** loading 分阶段文案的推进时刻（毫秒）：让等待过程有"人味" */
const LOADING_STAGE_DELAYS_MS = [4000, 9000];

let currentLang: PromptLanguage = 'zh';
let currentText = '';
let currentStructured: StructuredPrompt | undefined;
let currentState: PanelState = 'loading';
let currentTemplateId = '';
/** loading 分阶段文案的定时器，进其他状态时清理 */
let loadingStageTimers: ReturnType<typeof setTimeout>[] = [];
/** 用户点击"取消"后等待 background 回执的标记 */
let pendingCancel = false;
/** 上一次成功的结果（取消时恢复用） */
let lastGoodResult: { text: string; structured: StructuredPrompt | undefined } | null = null;

declare global {
  var __img2promptContentScriptInjected: boolean | undefined;
}

/** 来自 background 的消息入口（具名函数，配合底部注入去重守卫） */
function handleExtensionMessage(message: ExtensionMessage): void {
  if (message.type === 'IMG2PROMPT_START') {
    lastGoodResult = null;
    pendingCancel = false;
    showPanel();
    void syncTemplateSelect();
    setState('loading');
  } else if (message.type === 'IMG2PROMPT_PANEL_STATE') {
    if (message.lang) {
      currentLang = message.lang;
      // 分段控件高亮与实际语言保持同步
      const shadow = getShadow();
      if (shadow) {
        syncLangButtons(shadow);
      }
    }
    if (message.state === 'result') {
      if (!message.text) {
        // 防御：空正文的结果不渲染，避免"旧结构化数据 + 空正文"
        return;
      }
      currentText = message.text;
      currentStructured = message.structured;
      lastGoodResult = { text: message.text, structured: message.structured };
    } else if (message.state === 'streaming') {
      if (!message.text) {
        // 空增量不重渲染，避免闪烁
        return;
      }
      // 未完成的结果不写入 lastGoodResult（取消时不应恢复半成品）
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
}

/**
 * 注入去重：background 每次右键/快捷键都会 executeScript，
 * 重复执行整个模块会累积顶层 onMessage 监听器。用全局标记保证只注册一次。
 */
if (!globalThis.__img2promptContentScriptInjected) {
  globalThis.__img2promptContentScriptInjected = true;
  chrome.runtime.onMessage.addListener(handleExtensionMessage);
}

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
  clearLoadingStageTimers();
  const shadow = getShadow();
  if (!shadow) {
    return;
  }
  const body = shadow.querySelector('.ip-hero');
  if (!body) {
    return;
  }
  body.classList.toggle('error', state === 'error');
  if (state === 'loading') {
    shadow.querySelector('.ip-meta')?.remove();
    body.innerHTML = [
      `<div class="ip-loading" role="status"><span class="ip-spinner" aria-hidden="true"></span><span class="ip-loading-text">${escapeHtml(t('panelLoading'))}</span></div>`,
      `<div class="ip-loading-actions"><button class="ip-btn ip-cancel">${escapeHtml(t('panelCancel'))}</button></div>`,
    ].join('');
    shadow.querySelector('.ip-cancel')?.addEventListener('click', cancelGeneration);
    // 分阶段推进文案：分析图片 → 组织细节 → 润色，减少"卡住"的焦虑感
    const stages = [t('panelLoadingStage2'), t('panelLoadingStage3')];
    LOADING_STAGE_DELAYS_MS.forEach((delay, i) => {
      loadingStageTimers.push(
        setTimeout(() => {
          const el = getShadow()?.querySelector('.ip-loading-text');
          if (el && currentState === 'loading') {
            el.textContent = stages[i] ?? '';
          }
        }, delay)
      );
    });
    const refreshBtn = shadow.querySelector('.ip-refresh');
    refreshBtn?.classList.add('spinning');
    setActionsEnabled(shadow, false);
  } else if (state === 'streaming') {
    // 流式增量：直接渲染累计文本 + 生成中指示，操作按钮保持禁用直到完成
    currentText = text ?? '';
    currentStructured = undefined;
    body.innerHTML = [
      `<pre class="ip-result">${renderRichText(text ?? '')}<span class="ip-caret" aria-hidden="true"></span></pre>`,
      `<div class="ip-streaming-bar" role="status"><span>${escapeHtml(t('panelStreaming'))}</span><button class="ip-btn ip-cancel">${escapeHtml(t('panelCancel'))}</button></div>`,
    ].join('');
    shadow.querySelector('.ip-cancel')?.addEventListener('click', cancelGeneration);
    shadow.querySelector('.ip-refresh')?.classList.add('spinning');
    setActionsEnabled(shadow, false);
  } else if (state === 'result') {
    body.innerHTML = currentStructured
      ? renderStructured(currentStructured)
      : `<pre class="ip-result">${renderRichText(text ?? currentText)}</pre>`;
    ensureMeta(shadow);
    shadow.querySelector('.ip-refresh')?.classList.remove('spinning');
    setActionsEnabled(shadow, true);
    void renderResultMeta(shadow);
  } else {
    shadow.querySelector('.ip-meta')?.remove();
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
    shadow.querySelector('.ip-refresh')?.classList.remove('spinning');
    setActionsEnabled(shadow, false);
  }
}

/** 确保 body 下有 meta caption 元素（结果态用），其余状态清空 */
function ensureMeta(shadow: ShadowRoot): void {
  const container = shadow.querySelector('.ip-body');
  if (!container) {
    return;
  }
  let meta = shadow.querySelector('.ip-meta');
  if (!meta) {
    meta = document.createElement('div');
    meta.className = 'ip-meta';
    container.appendChild(meta);
  }
  meta.textContent = '';
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
      // 持久化为默认模板，保持与设置页一致；存储失败时把下拉框同步回持久化值
      void (async () => {
        try {
          const settings = await getSettings();
          settings.activeTemplateId = templateId;
          await saveSettings(settings);
        } catch {
          await syncTemplateSelect();
        }
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
  // 刷新提示词：用相同语言/模板重新生成（模型随机性带来措辞变化）
  shadow.querySelector('.ip-refresh')?.addEventListener('click', (event) => {
    const btn = event.currentTarget as HTMLButtonElement | null;
    if (btn?.disabled) {
      return;
    }
    requestGenerate(currentLang, currentTemplateId);
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
    const active = btn.dataset.lang === currentLang;
    btn.classList.toggle('active', active);
    // 读屏用户也能感知当前选中的语言
    btn.setAttribute('aria-pressed', String(active));
  });
}

/** 设置底部操作按钮（复制 / 刷新）可用状态：仅结果态可用 */
function setActionsEnabled(shadow: ShadowRoot, enabled: boolean): void {
  const copyBtn = shadow.querySelector<HTMLButtonElement>('.ip-copy');
  if (copyBtn) {
    copyBtn.disabled = !enabled;
  }
  const refreshBtn = shadow.querySelector<HTMLButtonElement>('.ip-refresh');
  if (refreshBtn) {
    refreshBtn.disabled = !enabled;
  }
}

/** 清理 loading 分阶段文案的定时器 */
function clearLoadingStageTimers(): void {
  for (const timer of loadingStageTimers) {
    clearTimeout(timer);
  }
  loadingStageTimers = [];
}

/** 渲染结果元信息：模板名 · 字数（Apple HIG caption 样式，次要信息弱化） */
async function renderResultMeta(shadow: ShadowRoot): Promise<void> {
  const meta = shadow.querySelector('.ip-meta');
  if (!meta) {
    return;
  }
  const templates = await getTemplates();
  const template = templates.find((tpl) => tpl.id === currentTemplateId);
  const name = template ? templateDisplayName(template) : '';
  const count = currentText.length;
  const unit = t('panelCharsUnit');
  meta.textContent = name ? `${name} · ${count} ${unit}` : `${count} ${unit}`;
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
    /* —— 液态玻璃：半透明材质 + 背景模糊饱和 + 顶部高光边 + 大圆角 —— */
    .ip-panel {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
      width: 380px; max-height: 66vh; display: flex; flex-direction: column;
      background: rgba(255, 255, 255, 0.62); color: #1d1d1f;
      -webkit-backdrop-filter: blur(24px) saturate(180%);
      backdrop-filter: blur(24px) saturate(180%);
      border: 1px solid rgba(255, 255, 255, 0.55); border-radius: 26px; overflow: hidden;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.75), inset 0 -0.5px 0 rgba(255, 255, 255, 0.25),
        0 16px 48px rgba(31, 56, 88, 0.20), 0 4px 16px rgba(31, 56, 88, 0.10);
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display",
        "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif;
      font-size: 14px; line-height: 1.6;
      -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
    }
    /* 顶栏：× 左，语言切换居中 */
    .ip-header {
      display: flex; align-items: center;
      padding: 12px 14px 10px;
    }
    .ip-close {
      width: 30px; height: 30px; flex: none;
      display: inline-flex; align-items: center; justify-content: center;
      border: 1px solid rgba(255, 255, 255, 0.5); border-radius: 50%; cursor: pointer;
      background: rgba(255, 255, 255, 0.35); color: rgba(60, 60, 67, 0.72);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
      font-size: 18px; line-height: 1; padding: 0;
    }
    .ip-close:hover { background: rgba(255, 255, 255, 0.6); color: #1d1d1f; }
    .ip-lang-wrap { flex: 1; display: flex; justify-content: center; }
    /* 语言切换：分段控件，选中片为实心玻璃 */
    .ip-lang {
      display: flex; align-items: center; gap: 2px;
      background: rgba(120, 120, 128, 0.14); border-radius: 999px; padding: 3px;
      box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.06);
    }
    .ip-lang svg { width: 14px; height: 14px; stroke: #007aff; flex: none; }
    .ip-lang button {
      border: 0; background: transparent; color: rgba(60, 60, 67, 0.72);
      font-size: 13px; font-weight: 500; font-family: inherit;
      padding: 5px 14px; cursor: pointer; border-radius: 999px;
      transition: background 0.15s, color 0.15s;
    }
    .ip-lang button.active { background: rgba(255, 255, 255, 0.9); color: #1d1d1f; font-weight: 600;
      box-shadow: 0 3px 10px rgba(31, 56, 88, 0.16), inset 0 1px 0 #fff; }
    .ip-body { padding: 2px 14px 0; overflow-y: auto; }
    /* 结果 hero：内层玻璃 */
    .ip-hero {
      background: rgba(255, 255, 255, 0.45); border: 1px solid rgba(255, 255, 255, 0.5);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
      border-radius: 18px; padding: 16px;
    }
    .ip-hero.error { background: rgba(255, 59, 48, 0.07); border-color: rgba(255, 59, 48, 0.14); }
    .ip-result {
      margin: 0; font-family: inherit; font-size: 14.5px; line-height: 1.75; letter-spacing: 0.005em;
      white-space: pre-wrap; word-break: break-word; color: #1d1d1f;
    }
    .ip-result strong { font-weight: 700; }
    .ip-loading {
      display: flex; align-items: center; justify-content: center; gap: 10px;
      color: rgba(60, 60, 67, 0.72); padding: 26px 8px; font-size: 14px;
    }
    .ip-loading-actions { display: flex; justify-content: center; padding: 0 0 14px; }
    /* 流式输出：实时文本 + 底部"生成中"条 + 闪烁光标 */
    .ip-streaming-bar {
      display: flex; align-items: center; justify-content: center; gap: 10px;
      padding: 10px 0 14px; color: rgba(60, 60, 67, 0.72); font-size: 13px;
    }
    .ip-caret {
      display: inline-block; width: 8px; height: 1.05em; margin-left: 2px;
      vertical-align: text-bottom; background: #007aff; border-radius: 3px;
      animation: ip-blink 1s steps(2, start) infinite;
    }
    @keyframes ip-blink { to { visibility: hidden; } }
    .ip-spinner {
      width: 20px; height: 20px; border-radius: 50%; flex: none;
      border: 2.5px solid rgba(0, 122, 255, 0.2); border-top-color: #007aff;
      animation: ip-spin 0.8s linear infinite;
    }
    @keyframes ip-spin { to { transform: rotate(360deg); } }
    .ip-error-title { font-weight: 700; font-size: 15px; color: #ff3b30; margin-bottom: 6px; }
    .ip-error-msg { color: #3c3c43; line-height: 1.65; margin-bottom: 12px; font-size: 13px; }
    .ip-error-actions { display: flex; gap: 8px; }
    .ip-kv-list { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
    .ip-kv {
      display: flex; gap: 8px; font-size: 13px; line-height: 1.55;
      background: rgba(255, 255, 255, 0.55); border: 1px solid rgba(255, 255, 255, 0.5);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
      border-radius: 12px; padding: 8px 12px;
    }
    .ip-kv-label { flex: none; color: rgba(60, 60, 67, 0.55); }
    .ip-kv-value { color: #1d1d1f; word-break: break-word; }
    .ip-tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .ip-tag {
      font-size: 12px; color: #007aff; font-weight: 500;
      background: rgba(255, 255, 255, 0.55); border: 1px solid rgba(255, 255, 255, 0.5);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
      border-radius: 999px; padding: 4px 12px;
      word-break: break-word;
    }
    /* 元信息 caption */
    .ip-meta {
      margin: 10px 4px 0; font-size: 12px; color: rgba(60, 60, 67, 0.48);
      text-align: right; font-variant-numeric: tabular-nums;
    }
    /* 底部操作条：模板选择 + 刷新 + 大复制按钮 */
    .ip-footer {
      padding: 12px 14px 14px;
      display: flex; align-items: center; gap: 10px;
    }
    .ip-template {
      width: 108px; flex: none;
      font-family: inherit; font-size: 13px; color: #3c3c43;
      background: rgba(255, 255, 255, 0.5); border: 1px solid rgba(255, 255, 255, 0.55);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
      border-radius: 999px; padding: 10px 12px; cursor: pointer;
      text-overflow: ellipsis;
    }
    .ip-template:focus-visible { outline: 2px solid #007aff; outline-offset: 2px; }
    .ip-btn:focus-visible, .ip-copy:focus-visible, .ip-refresh:focus-visible,
    .ip-close:focus-visible, .ip-lang button:focus-visible {
      outline: 2px solid #007aff; outline-offset: 2px;
    }
    .ip-btn {
      border: 1px solid rgba(255, 255, 255, 0.5); border-radius: 999px; cursor: pointer; font-family: inherit;
      padding: 9px 18px; font-size: 14px; font-weight: 600;
      background: rgba(255, 255, 255, 0.55); color: #007aff;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6), 0 4px 14px rgba(31, 56, 88, 0.10);
    }
    .ip-btn:hover { background: rgba(255, 255, 255, 0.8); }
    /* 大复制按钮：品牌蓝 + 顶部高光 */
    .ip-copy {
      flex: 1; border: 1px solid rgba(255, 255, 255, 0.35); border-radius: 999px; cursor: pointer; font-family: inherit;
      padding: 11px 16px; font-size: 15px; font-weight: 600; color: #fff;
      background: linear-gradient(180deg, #2b93ff, #007aff);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45), 0 6px 18px rgba(0, 122, 255, 0.35);
    }
    .ip-copy:hover:not(:disabled) { filter: brightness(1.06); }
    .ip-copy:disabled { opacity: 0.45; cursor: default; box-shadow: none; }
    .ip-refresh {
      width: 44px; height: 44px; flex: none;
      display: inline-flex; align-items: center; justify-content: center;
      border: 1px solid rgba(255, 255, 255, 0.5); border-radius: 50%; cursor: pointer; padding: 0;
      background: rgba(255, 255, 255, 0.5);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6), 0 4px 14px rgba(31, 56, 88, 0.10);
    }
    .ip-refresh svg { width: 19px; height: 19px; fill: #007aff; }
    .ip-refresh:hover:not(:disabled) { background: rgba(255, 255, 255, 0.8); }
    .ip-refresh:disabled { opacity: 0.35; cursor: default; }
    .ip-refresh.spinning svg { animation: ip-spin 0.9s linear infinite; }
    /* 深色模式：深色玻璃 */
    @media (prefers-color-scheme: dark) {
      .ip-panel {
        background: rgba(28, 28, 30, 0.62); color: #f5f5f7;
        border-color: rgba(255, 255, 255, 0.22);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22), 0 16px 48px rgba(0, 0, 0, 0.5);
      }
      .ip-close { background: rgba(255, 255, 255, 0.10); border-color: rgba(255, 255, 255, 0.18); color: #98989f; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18); }
      .ip-close:hover { background: rgba(255, 255, 255, 0.18); color: #fff; }
      .ip-lang { background: rgba(120, 120, 128, 0.24); box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.25); }
      .ip-lang svg { stroke: #4fb3ff; }
      .ip-lang button { color: #98989f; }
      .ip-lang button.active { background: rgba(255, 255, 255, 0.85); color: #1d1d1f; box-shadow: 0 3px 10px rgba(0, 0, 0, 0.35); }
      .ip-hero { background: rgba(255, 255, 255, 0.08); border-color: rgba(255, 255, 255, 0.14); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14); }
      .ip-hero.error { background: rgba(255, 69, 58, 0.12); border-color: rgba(255, 69, 58, 0.22); }
      .ip-result { color: #f5f5f7; }
      .ip-loading { color: #98989f; }
      .ip-streaming-bar { color: #98989f; }
      .ip-caret { background: #4fb3ff; }
      .ip-spinner { border-color: rgba(79, 179, 255, 0.2); border-top-color: #4fb3ff; }
      .ip-error-msg { color: #ebebf5; }
      .ip-kv { background: rgba(255, 255, 255, 0.08); border-color: rgba(255, 255, 255, 0.12); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12); }
      .ip-kv-label { color: #98989f; }
      .ip-kv-value { color: #f5f5f7; }
      .ip-tag { color: #4fb3ff; background: rgba(255, 255, 255, 0.08); border-color: rgba(255, 255, 255, 0.12); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12); }
      .ip-meta { color: #636366; }
      .ip-template { background: rgba(255, 255, 255, 0.10); border-color: rgba(255, 255, 255, 0.16); color: #ebebf5; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14); }
      .ip-template option { color: #000; }
      .ip-btn { background: rgba(255, 255, 255, 0.10); border-color: rgba(255, 255, 255, 0.16); color: #4fb3ff; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14); }
      .ip-btn:hover { background: rgba(255, 255, 255, 0.18); }
      .ip-copy { background: linear-gradient(180deg, #2b93ff, #0a84ff); }
      .ip-refresh { background: rgba(255, 255, 255, 0.10); border-color: rgba(255, 255, 255, 0.16); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14); }
      .ip-refresh svg { fill: #4fb3ff; }
      .ip-refresh:hover:not(:disabled) { background: rgba(255, 255, 255, 0.18); }
      .ip-btn:focus-visible, .ip-copy:focus-visible, .ip-refresh:focus-visible,
      .ip-close:focus-visible, .ip-lang button:focus-visible {
        outline-color: #4fb3ff;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .ip-spinner { animation-duration: 1.6s; }
      .ip-caret { animation: none; }
      .ip-refresh.spinning svg { animation: none; }
      .ip-lang button { transition: none; }
    }
  </style>
  <div class="ip-panel">
    <div class="ip-header">
      <button class="ip-close" data-i18n-title="panelClose" data-i18n-aria-label="panelClose">×</button>
      <div class="ip-lang-wrap">
        <div class="ip-lang" role="group" data-i18n-aria-label="panelLangLabel">
          <button data-lang="zh">中文</button>
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 8h11l-3-3M17 16H6l3 3"/></svg>
          <button data-lang="en">EN</button>
        </div>
      </div>
    </div>
    <div class="ip-body"><div class="ip-hero" aria-live="polite"></div></div>
    <div class="ip-footer">
      <select class="ip-template" data-i18n-title="panelTemplateTitle"></select>
      <button class="ip-refresh" data-i18n-title="panelRegenerate" data-i18n-aria-label="panelRegenerate" disabled>
        <svg viewBox="0 0 24 24"><path d="M12 5V1.8L6.8 7 12 12.2V9c3.3 0 6 2.7 6 6s-2.7 6-6 6-6-2.7-6-6H4c0 4.4 3.6 8 8 8s8-3.6 8-8-3.6-8-8-8z"/></svg>
      </button>
      <button class="ip-copy" data-i18n="panelCopy" disabled></button>
    </div>
  </div>`;
}

export {};
