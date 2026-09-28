/**
 * Popup：展示最近 20 条生成历史，点击条目复制完整提示词。
 */
import { applyI18n, t } from '../lib/i18n.js';
import { clearHistory, getHistory } from '../lib/storage.js';
import type { HistoryItem } from '../lib/types.js';

/** 列表中提示词摘要的最大字符数 */
const SNIPPET_MAX_CHARS = 80;
/** 复制成功反馈的显示时长（毫秒） */
const COPIED_TIP_MS = 1200;

const listEl = document.getElementById('historyList') as HTMLElement;
const emptyEl = document.getElementById('emptyState') as HTMLElement;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
const optionsBtn = document.getElementById('optionsBtn') as HTMLButtonElement;

applyI18n();
void render();

optionsBtn.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

clearBtn.addEventListener('click', async () => {
  await clearHistory();
  await render();
});

/** 拉取历史并渲染列表 */
async function render(): Promise<void> {
  const history = await getHistory();
  listEl.innerHTML = '';
  emptyEl.hidden = history.length > 0;
  clearBtn.hidden = history.length === 0;

  for (const item of history) {
    listEl.appendChild(createItemElement(item));
  }
}

/** 构建单条历史记录的 DOM */
function createItemElement(item: HistoryItem): HTMLElement {
  const button = document.createElement('button');
  button.className = 'history-item';
  button.type = 'button';

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
  const time = document.createElement('time');
  time.textContent = new Date(item.createdAt).toLocaleString();
  meta.append(langBadge, time);

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

  return button;
}

/** 超长文本截断并追加省略号 */
function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}
