/**
 * chrome.storage.local 的类型化封装。
 * API Key 仅保存在用户本地浏览器中，绝不上传、绝不进仓库。
 */
import type { HistoryItem, PluginSettings } from './types.js';

/** 默认 Base URL */
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
/** 默认视觉模型 */
const DEFAULT_MODEL = 'gpt-4o';
/** 历史记录上限条数 */
const MAX_HISTORY_ITEMS = 20;

const STORAGE_KEYS = {
  settings: 'img2prompt.settings',
  history: 'img2prompt.history',
} as const;

/** 默认设置（新用户首次打开时使用） */
export function defaultSettings(): PluginSettings {
  return {
    apiKey: '',
    baseUrl: DEFAULT_BASE_URL,
    model: DEFAULT_MODEL,
    defaultLang: 'zh',
  };
}

/** 读取设置，与默认值合并（兼容旧版本缺字段的情况） */
export async function getSettings(): Promise<PluginSettings> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
  const raw = stored[STORAGE_KEYS.settings] as Partial<PluginSettings> | undefined;
  return { ...defaultSettings(), ...sanitizeSettings(raw) };
}

/** 保存设置（写入前做清洗，避免脏数据） */
export async function saveSettings(settings: PluginSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: sanitizeSettings(settings) });
}

/** 读取历史记录（按时间倒序） */
export async function getHistory(): Promise<HistoryItem[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.history);
  const raw = stored[STORAGE_KEYS.history];
  return Array.isArray(raw) ? (raw as HistoryItem[]) : [];
}

/**
 * 追加一条历史记录，超出上限时丢弃最旧的。
 *
 * @returns 落盘后的完整条目（含 id 与 createdAt）
 */
export async function addHistoryItem(
  item: Omit<HistoryItem, 'id' | 'createdAt'>,
): Promise<HistoryItem> {
  const entry: HistoryItem = {
    ...item,
    id: generateId(),
    createdAt: Date.now(),
  };
  const history = await getHistory();
  history.unshift(entry);
  await chrome.storage.local.set({
    [STORAGE_KEYS.history]: history.slice(0, MAX_HISTORY_ITEMS),
  });
  return entry;
}

/** 清空历史记录 */
export async function clearHistory(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.history);
}

/** 清洗设置对象：只保留已知字段并做类型兜底 */
function sanitizeSettings(raw: Partial<PluginSettings> | undefined): PluginSettings {
  const defaults = defaultSettings();
  if (!raw || typeof raw !== 'object') {
    return defaults;
  }
  return {
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : defaults.apiKey,
    baseUrl: typeof raw.baseUrl === 'string' && raw.baseUrl ? raw.baseUrl : defaults.baseUrl,
    model: typeof raw.model === 'string' && raw.model ? raw.model : defaults.model,
    defaultLang: raw.defaultLang === 'en' ? 'en' : 'zh',
  };
}

/** 生成唯一 ID（优先 crypto.randomUUID，降级为时间戳+随机数） */
function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
