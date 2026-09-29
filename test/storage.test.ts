import { describe, expect, it } from 'vitest';
import {
  addHistoryItem,
  addProvider,
  clearHistory,
  defaultProvider,
  deleteCustomTemplate,
  deleteProvider,
  getActiveProvider,
  getCustomTemplates,
  getHistory,
  getSettings,
  getTemplate,
  getTemplates,
  saveCustomTemplate,
  saveSettings,
  searchHistory,
  setActiveProvider,
  toggleFavorite,
  updateProvider,
} from '../src/lib/storage.js';
import { DEFAULT_TEMPLATE_ID } from '../src/lib/prompt-templates.js';
import type { HistoryItem } from '../src/lib/types.js';

function makeProvider(name: string) {
  return {
    name,
    apiKey: `sk-${name}`,
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
  };
}

describe('settings', () => {
  it('空存储时返回默认值（单个默认服务商）', async () => {
    const settings = await getSettings();
    expect(settings.providers).toHaveLength(1);
    expect(settings.providers[0]!.baseUrl).toBe('https://api.openai.com/v1');
    expect(settings.providers[0]!.model).toBe('gpt-4o');
    expect(settings.activeProviderId).toBe(settings.providers[0]!.id);
    expect(settings.activeTemplateId).toBe(DEFAULT_TEMPLATE_ID);
    expect(settings.defaultLang).toBe('zh');
  });

  it('保存后可完整读回', async () => {
    const settings = await getSettings();
    settings.providers[0]!.apiKey = 'sk-abc';
    settings.providers[0]!.model = 'custom-vision';
    settings.defaultLang = 'en';
    await saveSettings(settings);
    const reloaded = await getSettings();
    expect(reloaded.providers[0]!.apiKey).toBe('sk-abc');
    expect(reloaded.providers[0]!.model).toBe('custom-vision');
    expect(reloaded.defaultLang).toBe('en');
  });

  it('v0.1 扁平设置自动迁移为 Default 服务商', async () => {
    // 直接写入旧格式数据
    const chromeLocal = (
      globalThis as unknown as {
        chrome: { storage: { local: { set: (o: unknown) => Promise<void> } } };
      }
    ).chrome.storage.local;
    await chromeLocal.set({
      'img2prompt.settings': {
        apiKey: 'sk-legacy',
        baseUrl: 'https://legacy.example/v1',
        model: 'legacy-model',
        defaultLang: 'en',
      },
    });
    const settings = await getSettings();
    expect(settings.providers).toHaveLength(1);
    expect(settings.providers[0]!.name).toBe('Default');
    expect(settings.providers[0]!.apiKey).toBe('sk-legacy');
    expect(settings.providers[0]!.baseUrl).toBe('https://legacy.example/v1');
    expect(settings.providers[0]!.model).toBe('legacy-model');
    expect(settings.activeProviderId).toBe(settings.providers[0]!.id);
    expect(settings.defaultLang).toBe('en');
  });

  it('脏数据被清洗为默认值', async () => {
    const settings = await getSettings();
    settings.providers = [
      {
        id: '',
        name: '',
        apiKey: 123 as unknown as string,
        baseUrl: '',
        model: '',
      },
    ];
    settings.defaultLang = 'fr' as unknown as 'zh';
    await saveSettings(settings);
    const reloaded = await getSettings();
    expect(reloaded.providers).toHaveLength(1);
    expect(reloaded.providers[0]!.apiKey).toBe('');
    expect(reloaded.providers[0]!.baseUrl).toBe('https://api.openai.com/v1');
    expect(reloaded.providers[0]!.model).toBe('gpt-4o');
    expect(reloaded.defaultLang).toBe('zh');
  });
});

describe('providers', () => {
  it('增删改查与切换', async () => {
    const created = await addProvider(makeProvider('NVIDIA'));
    expect(created.id).toBeTruthy();
    expect(created.name).toBe('NVIDIA');

    let settings = await getSettings();
    expect(settings.providers).toHaveLength(2);

    await setActiveProvider(created.id);
    settings = await getSettings();
    expect(getActiveProvider(settings).name).toBe('NVIDIA');

    await updateProvider(created.id, { model: 'llama-3.2-11b-vision-instruct' });
    settings = await getSettings();
    expect(getActiveProvider(settings).model).toBe('llama-3.2-11b-vision-instruct');

    await deleteProvider(created.id);
    settings = await getSettings();
    expect(settings.providers).toHaveLength(1);
    // 删除当前启用的自动回退到第一个
    expect(settings.activeProviderId).toBe(settings.providers[0]!.id);
  });

  it('至少保留一个服务商', async () => {
    const settings = await getSettings();
    await deleteProvider(settings.providers[0]!.id);
    const reloaded = await getSettings();
    expect(reloaded.providers).toHaveLength(1);
  });

  it('activeProviderId 指向不存在时回退第一个', async () => {
    const settings = await getSettings();
    settings.activeProviderId = 'non-existent';
    expect(getActiveProvider(settings).id).toBe(settings.providers[0]!.id);
  });

  it('defaultProvider 返回可用默认值', () => {
    const p = defaultProvider();
    expect(p.id).toBeTruthy();
    expect(p.baseUrl).toBe('https://api.openai.com/v1');
  });
});

describe('templates', () => {
  it('内置 7 套模板全部可读', async () => {
    const templates = await getTemplates();
    expect(templates).toHaveLength(7);
    expect(templates.every((t) => t.builtin)).toBe(true);
    expect(templates.map((t) => t.id)).toContain(DEFAULT_TEMPLATE_ID);
  });

  it('未知 id 回退默认模板', async () => {
    const template = await getTemplate('no-such-id');
    expect(template.id).toBe(DEFAULT_TEMPLATE_ID);
  });

  it('自定义模板可增删', async () => {
    const created = await saveCustomTemplate({
      id: '',
      name: 'My Style',
      systemPrompt: 'sys {outputLanguage}',
      userTextZh: '中文',
      userTextEn: 'English',
      outputFormat: 'json',
    });
    expect(created.id.startsWith('custom:')).toBe(true);

    let templates = await getTemplates();
    expect(templates).toHaveLength(8);

    const fetched = await getTemplate(created.id);
    expect(fetched.name).toBe('My Style');
    expect(fetched.outputFormat).toBe('json');

    await deleteCustomTemplate(created.id);
    templates = await getTemplates();
    expect(templates).toHaveLength(7);
  });

  it('删除当前启用模板后回退默认', async () => {
    const created = await saveCustomTemplate({
      id: '',
      name: 'Temp',
      systemPrompt: 'sys',
      userTextZh: 'zh',
      userTextEn: 'en',
      outputFormat: 'text',
    });
    const settings = await getSettings();
    settings.activeTemplateId = created.id;
    await saveSettings(settings);

    await deleteCustomTemplate(created.id);
    const reloaded = await getSettings();
    expect(reloaded.activeTemplateId).toBe(DEFAULT_TEMPLATE_ID);
  });

  it('自定义模板为空数组时 getCustomTemplates 返回 []', async () => {
    await expect(getCustomTemplates()).resolves.toEqual([]);
  });
});

describe('history', () => {
  const makeItem = (n: number): Omit<HistoryItem, 'id' | 'createdAt' | 'favorite'> => ({
    imageUrl: `https://example.com/${n}.png`,
    source: 'context-menu',
    thumbnail: 'data:image/jpeg;base64,thumb',
    prompt: `prompt ${n}`,
    lang: 'zh',
    model: 'gpt-4o',
    providerName: 'Default',
    templateId: DEFAULT_TEMPLATE_ID,
  });

  it('新条目排在最前面', async () => {
    await addHistoryItem(makeItem(1));
    await addHistoryItem(makeItem(2));
    const history = await getHistory();
    expect(history.map((h) => h.prompt)).toEqual(['prompt 2', 'prompt 1']);
  });

  it('超过 50 条时丢弃最旧的非收藏条目', async () => {
    for (let n = 1; n <= 51; n++) {
      await addHistoryItem(makeItem(n));
    }
    const history = await getHistory();
    expect(history).toHaveLength(50);
    expect(history[0]?.prompt).toBe('prompt 51');
    expect(history[49]?.prompt).toBe('prompt 2');
  });

  it('收藏条目优先保留', async () => {
    const first = await addHistoryItem(makeItem(1));
    await toggleFavorite(first.id);
    for (let n = 2; n <= 52; n++) {
      await addHistoryItem(makeItem(n));
    }
    const history = await getHistory();
    expect(history).toHaveLength(50);
    expect(history.some((h) => h.prompt === 'prompt 1')).toBe(true);
  });

  it('清空后为空数组；keepFavorites 保留收藏', async () => {
    const entry = await addHistoryItem(makeItem(1));
    await addHistoryItem(makeItem(2));
    await toggleFavorite(entry.id);
    await clearHistory({ keepFavorites: true });
    const history = await getHistory();
    expect(history).toHaveLength(1);
    expect(history[0]!.prompt).toBe('prompt 1');
    await clearHistory();
    await expect(getHistory()).resolves.toEqual([]);
  });

  it('条目携带 id、createdAt 与新字段', async () => {
    const entry = await addHistoryItem(makeItem(1));
    expect(typeof entry.id).toBe('string');
    expect(entry.id.length).toBeGreaterThan(0);
    expect(typeof entry.createdAt).toBe('number');
    expect(entry.source).toBe('context-menu');
    expect(entry.favorite).toBe(false);
  });

  it('旧数据缺字段时被补齐', async () => {
    const chromeLocal = (
      globalThis as unknown as {
        chrome: { storage: { local: { set: (o: unknown) => Promise<void> } } };
      }
    ).chrome.storage.local;
    await chromeLocal.set({
      'img2prompt.history': [{ id: 'x', prompt: 'old', createdAt: 123 }],
    });
    const history = await getHistory();
    expect(history[0]!.favorite).toBe(false);
    expect(history[0]!.source).toBe('context-menu');
    expect(history[0]!.providerName).toBe('');
  });
});

describe('favorites & search', () => {
  const makeItem = (
    n: number,
    prompt?: string
  ): Omit<HistoryItem, 'id' | 'createdAt' | 'favorite'> => ({
    imageUrl: '',
    source: 'upload',
    thumbnail: 'data:image/jpeg;base64,thumb',
    prompt: prompt ?? `prompt ${n}`,
    lang: 'zh',
    model: 'gpt-4o',
    providerName: 'NVIDIA',
    templateId: DEFAULT_TEMPLATE_ID,
  });

  it('toggleFavorite 翻转状态', async () => {
    const entry = await addHistoryItem(makeItem(1));
    expect(await toggleFavorite(entry.id)).toBe(true);
    expect(await toggleFavorite(entry.id)).toBe(false);
    expect(await toggleFavorite('non-existent')).toBe(false);
  });

  it('按提示词关键词搜索', async () => {
    await addHistoryItem(makeItem(1, 'a red cat in garden'));
    await addHistoryItem(makeItem(2, 'blue ocean wave'));
    const results = await searchHistory('cat');
    expect(results).toHaveLength(1);
    expect(results[0]!.prompt).toContain('cat');
  });

  it('按服务商名搜索', async () => {
    await addHistoryItem(makeItem(1));
    const results = await searchHistory('nvidia');
    expect(results).toHaveLength(1);
  });

  it('空关键词返回全部（可仅看收藏）', async () => {
    const e1 = await addHistoryItem(makeItem(1));
    await addHistoryItem(makeItem(2));
    await toggleFavorite(e1.id);
    expect(await searchHistory('')).toHaveLength(2);
    const favs = await searchHistory('', { favoritesOnly: true });
    expect(favs).toHaveLength(1);
    expect(favs[0]!.prompt).toBe('prompt 1');
  });
});
