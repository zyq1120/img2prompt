/**
 * chrome.storage.local 的类型化封装。
 * API Key 仅保存在用户本地浏览器中，绝不上传、绝不进仓库。
 */
import { BUILTIN_TEMPLATES, DEFAULT_TEMPLATE_ID } from './prompt-templates.js';
import type {
  HistoryItem,
  PluginSettings,
  PromptLanguage,
  PromptTemplate,
  ProviderConfig,
} from './types.js';

/** 历史记录上限条数 */
const MAX_HISTORY_ITEMS = 50;
/** 搜索返回上限 */
const MAX_SEARCH_RESULTS = 50;

const STORAGE_KEYS = {
  settings: 'img2prompt.settings',
  history: 'img2prompt.history',
  customTemplates: 'img2prompt.customTemplates',
} as const;

/** 旧版扁平设置（v0.1，用于迁移） */
interface LegacySettings {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  defaultLang?: PromptLanguage;
}

/** 默认设置（新用户首次打开时使用） */
export function defaultSettings(): PluginSettings {
  const provider = defaultProvider();
  return {
    providers: [provider],
    activeProviderId: provider.id,
    activeTemplateId: DEFAULT_TEMPLATE_ID,
    defaultLang: 'zh',
  };
}

/** 默认服务商配置 */
export function defaultProvider(): ProviderConfig {
  return {
    id: generateId(),
    name: 'Default',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o',
  };
}

/** 读取设置，与默认值合并（兼容旧版本缺字段的情况，并做 v0.1 扁平结构迁移） */
export async function getSettings(): Promise<PluginSettings> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
  const raw = stored[STORAGE_KEYS.settings] as Partial<PluginSettings> | undefined;
  return { ...defaultSettings(), ...sanitizeSettings(raw) };
}

/** 保存设置（写入前做清洗，避免脏数据） */
export async function saveSettings(settings: PluginSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: sanitizeSettings(settings) });
}

/** 取当前启用的服务商；数据异常时回退到第一个可用配置 */
export function getActiveProvider(settings: PluginSettings): ProviderConfig {
  const found = settings.providers.find((p) => p.id === settings.activeProviderId);
  if (found) {
    return found;
  }
  return settings.providers[0] ?? defaultProvider();
}

/** 新增服务商 */
export async function addProvider(provider: Omit<ProviderConfig, 'id'>): Promise<ProviderConfig> {
  const settings = await getSettings();
  const entry: ProviderConfig = { ...sanitizeProvider(provider), id: generateId() };
  settings.providers.push(entry);
  await saveSettings(settings);
  return entry;
}

/** 更新服务商（id 不可变） */
export async function updateProvider(
  id: string,
  patch: Partial<Omit<ProviderConfig, 'id'>>
): Promise<void> {
  const settings = await getSettings();
  const target = settings.providers.find((p) => p.id === id);
  if (!target) {
    return;
  }
  Object.assign(target, sanitizeProvider({ ...target, ...patch }));
  await saveSettings(settings);
}

/** 删除服务商；至少保留一个，删除当前启用的自动切换到第一个 */
export async function deleteProvider(id: string): Promise<void> {
  const settings = await getSettings();
  if (settings.providers.length <= 1) {
    return;
  }
  settings.providers = settings.providers.filter((p) => p.id !== id);
  if (settings.activeProviderId === id) {
    settings.activeProviderId = settings.providers[0].id;
  }
  await saveSettings(settings);
}

/** 切换当前启用的服务商 */
export async function setActiveProvider(id: string): Promise<void> {
  const settings = await getSettings();
  if (settings.providers.some((p) => p.id === id)) {
    settings.activeProviderId = id;
    await saveSettings(settings);
  }
}

/** 读取全部模板：内置 + 自定义（自定义覆盖同 id 的内置项） */
export async function getTemplates(): Promise<PromptTemplate[]> {
  const customs = await getCustomTemplates();
  const overrideIds = new Set(customs.map((t) => t.id));
  return [
    ...BUILTIN_TEMPLATES.filter((t) => !overrideIds.has(t.id)),
    ...customs,
  ];
}

/** 按 id 取模板（含内置与自定义），找不到时回退默认模板 */
export async function getTemplate(id: string): Promise<PromptTemplate> {
  const templates = await getTemplates();
  return templates.find((t) => t.id === id) ?? getBuiltinTemplate(DEFAULT_TEMPLATE_ID);
}

/** 取内置模板（同步，供 background 等无需 storage 的场景） */
export function getBuiltinTemplate(id: string): PromptTemplate {
  return (
    BUILTIN_TEMPLATES.find((t) => t.id === id) ??
    BUILTIN_TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE_ID) ??
    BUILTIN_TEMPLATES[0]
  );
}

/** 读取自定义模板 */
export async function getCustomTemplates(): Promise<PromptTemplate[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.customTemplates);
  const raw = stored[STORAGE_KEYS.customTemplates];
  if (!Array.isArray(raw)) {
    return [];
  }
  return (raw as PromptTemplate[]).map(sanitizeTemplate).filter((t) => t.id && !t.builtin);
}

/** 新增或更新自定义模板（按 id 覆盖） */
export async function saveCustomTemplate(
  template: Omit<PromptTemplate, 'builtin'>
): Promise<PromptTemplate> {
  const customs = await getCustomTemplates();
  const entry: PromptTemplate = sanitizeTemplate({ ...template, builtin: false });
  if (!entry.id) {
    entry.id = `custom:${generateId()}`;
  }
  const index = customs.findIndex((t) => t.id === entry.id);
  if (index >= 0) {
    customs[index] = entry;
  } else {
    customs.push(entry);
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.customTemplates]: customs });
  return entry;
}

/** 删除自定义模板；若为当前启用模板则回退到默认模板 */
export async function deleteCustomTemplate(id: string): Promise<void> {
  const customs = (await getCustomTemplates()).filter((t) => t.id !== id);
  await chrome.storage.local.set({ [STORAGE_KEYS.customTemplates]: customs });
  const settings = await getSettings();
  if (settings.activeTemplateId === id) {
    settings.activeTemplateId = DEFAULT_TEMPLATE_ID;
    await saveSettings(settings);
  }
}

/** 读取历史记录（按时间倒序） */
export async function getHistory(): Promise<HistoryItem[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.history);
  const raw = stored[STORAGE_KEYS.history];
  if (!Array.isArray(raw)) {
    return [];
  }
  return (raw as HistoryItem[]).map(sanitizeHistoryItem);
}

/**
 * 追加一条历史记录，超出上限时丢弃最旧的（收藏条目优先保留）。
 *
 * @returns 落盘后的完整条目（含 id 与 createdAt）
 */
export async function addHistoryItem(
  item: Omit<HistoryItem, 'id' | 'createdAt' | 'favorite'>
): Promise<HistoryItem> {
  const entry: HistoryItem = {
    ...item,
    favorite: false,
    id: generateId(),
    createdAt: Date.now(),
  };
  const history = await getHistory();
  history.unshift(entry);
  // 收藏条目优先保留：先排收藏，再按时间
  const favorites = history.filter((h) => h.favorite);
  const rest = history.filter((h) => !h.favorite);
  const merged = [...favorites, ...rest].slice(0, MAX_HISTORY_ITEMS);
  // 恢复时间倒序展示
  merged.sort((a, b) => b.createdAt - a.createdAt);
  await chrome.storage.local.set({ [STORAGE_KEYS.history]: merged });
  return entry;
}

/** 切换收藏状态，返回切换后的值 */
export async function toggleFavorite(id: string): Promise<boolean> {
  const history = await getHistory();
  const target = history.find((h) => h.id === id);
  if (!target) {
    return false;
  }
  target.favorite = !target.favorite;
  await chrome.storage.local.set({ [STORAGE_KEYS.history]: history });
  return target.favorite;
}

/** 按关键词搜索历史（匹配提示词正文、模型、服务商名），可仅看收藏 */
export async function searchHistory(
  query: string,
  options: { favoritesOnly?: boolean } = {}
): Promise<HistoryItem[]> {
  const keyword = query.trim().toLowerCase();
  const history = await getHistory();
  const filtered = history.filter((h) => {
    if (options.favoritesOnly && !h.favorite) {
      return false;
    }
    if (!keyword) {
      return true;
    }
    return (
      h.prompt.toLowerCase().includes(keyword) ||
      h.model.toLowerCase().includes(keyword) ||
      h.providerName.toLowerCase().includes(keyword)
    );
  });
  return filtered.slice(0, MAX_SEARCH_RESULTS);
}

/** 清空历史记录（收藏条目可选保留） */
export async function clearHistory(options: { keepFavorites?: boolean } = {}): Promise<void> {
  if (!options.keepFavorites) {
    await chrome.storage.local.remove(STORAGE_KEYS.history);
    return;
  }
  const favorites = (await getHistory()).filter((h) => h.favorite);
  await chrome.storage.local.set({ [STORAGE_KEYS.history]: favorites });
}

/** 清洗设置对象：只保留已知字段并做类型兜底，兼容 v0.1 扁平结构 */
function sanitizeSettings(raw: Partial<PluginSettings> | undefined): PluginSettings {
  const defaults = defaultSettings();
  if (!raw || typeof raw !== 'object') {
    return defaults;
  }
  // v0.1 迁移：扁平 apiKey/baseUrl/model → 单个 Default 服务商
  const legacy = raw as Partial<PluginSettings> & LegacySettings;
  let providers: ProviderConfig[];
  if (Array.isArray(legacy.providers) && legacy.providers.length > 0) {
    providers = legacy.providers.map(sanitizeProvider);
  } else if (legacy.apiKey || legacy.baseUrl || legacy.model) {
    providers = [
      sanitizeProvider({
        id: generateId(),
        name: 'Default',
        apiKey: typeof legacy.apiKey === 'string' ? legacy.apiKey : '',
        baseUrl: typeof legacy.baseUrl === 'string' ? legacy.baseUrl : defaultProvider().baseUrl,
        model: typeof legacy.model === 'string' ? legacy.model : defaultProvider().model,
      }),
    ];
  } else {
    providers = defaults.providers;
  }

  const activeProviderId =
    typeof legacy.activeProviderId === 'string' &&
    providers.some((p) => p.id === legacy.activeProviderId)
      ? legacy.activeProviderId
      : providers[0].id;

  return {
    providers,
    activeProviderId,
    activeTemplateId:
      typeof legacy.activeTemplateId === 'string' && legacy.activeTemplateId
        ? legacy.activeTemplateId
        : defaults.activeTemplateId,
    defaultLang: legacy.defaultLang === 'en' ? 'en' : 'zh',
  };
}

/** 清洗单个服务商配置 */
function sanitizeProvider(raw: Partial<ProviderConfig>): ProviderConfig {
  const defaults = defaultProvider();
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : generateId(),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : defaults.name,
    baseUrl:
      typeof raw.baseUrl === 'string' && raw.baseUrl.trim()
        ? raw.baseUrl.trim().replace(/\/+$/, '')
        : defaults.baseUrl,
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
    model:
      typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : defaults.model,
  };
}

/** 清洗单个模板 */
function sanitizeTemplate(raw: Partial<PromptTemplate>): PromptTemplate {
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Untitled',
    nameI18nKey: typeof raw.nameI18nKey === 'string' ? raw.nameI18nKey : undefined,
    systemPrompt: typeof raw.systemPrompt === 'string' ? raw.systemPrompt : '',
    userTextZh: typeof raw.userTextZh === 'string' ? raw.userTextZh : '',
    userTextEn: typeof raw.userTextEn === 'string' ? raw.userTextEn : '',
    outputFormat: raw.outputFormat === 'json' ? 'json' : 'text',
    builtin: raw.builtin === true,
  };
}

/** 清洗历史条目：补齐新字段，兼容旧数据 */
function sanitizeHistoryItem(raw: HistoryItem): HistoryItem {
  return {
    id: typeof raw.id === 'string' ? raw.id : generateId(),
    imageUrl: typeof raw.imageUrl === 'string' ? raw.imageUrl : '',
    source: raw.source === 'region' || raw.source === 'upload' ? raw.source : 'context-menu',
    thumbnail: typeof raw.thumbnail === 'string' ? raw.thumbnail : '',
    prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
    structured:
      raw.structured && typeof raw.structured.prompt === 'string' ? raw.structured : undefined,
    lang: raw.lang === 'en' ? 'en' : 'zh',
    model: typeof raw.model === 'string' ? raw.model : '',
    providerName: typeof raw.providerName === 'string' ? raw.providerName : '',
    templateId: typeof raw.templateId === 'string' ? raw.templateId : DEFAULT_TEMPLATE_ID,
    favorite: raw.favorite === true,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
  };
}

/** 生成唯一 ID（优先 crypto.randomUUID，降级为时间戳+随机数） */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
