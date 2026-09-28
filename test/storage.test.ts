import { describe, expect, it } from 'vitest';
import {
  addHistoryItem,
  clearHistory,
  defaultSettings,
  getHistory,
  getSettings,
  saveSettings,
} from '../src/lib/storage.js';

describe('settings', () => {
  it('空存储时返回默认值', async () => {
    const settings = await getSettings();
    expect(settings).toEqual(defaultSettings());
    expect(settings.baseUrl).toBe('https://api.openai.com/v1');
    expect(settings.model).toBe('gpt-4o');
    expect(settings.defaultLang).toBe('zh');
  });

  it('保存后可完整读回', async () => {
    await saveSettings({
      apiKey: 'sk-abc',
      baseUrl: 'https://custom.example/v1',
      model: 'custom-vision',
      defaultLang: 'en',
    });
    const settings = await getSettings();
    expect(settings.apiKey).toBe('sk-abc');
    expect(settings.baseUrl).toBe('https://custom.example/v1');
    expect(settings.model).toBe('custom-vision');
    expect(settings.defaultLang).toBe('en');
  });

  it('脏数据被清洗为默认值', async () => {
    await saveSettings({
      apiKey: 123 as unknown as string,
      baseUrl: '',
      model: '',
      defaultLang: 'fr' as unknown as 'en',
    });
    const settings = await getSettings();
    expect(settings.apiKey).toBe('');
    expect(settings.baseUrl).toBe('https://api.openai.com/v1');
    expect(settings.model).toBe('gpt-4o');
    expect(settings.defaultLang).toBe('zh');
  });
});

describe('history', () => {
  const makeItem = (n: number) => ({
    imageUrl: `https://example.com/${n}.png`,
    thumbnail: 'data:image/jpeg;base64,thumb',
    prompt: `prompt ${n}`,
    lang: 'zh' as const,
    model: 'gpt-4o',
  });

  it('新条目排在最前面', async () => {
    await addHistoryItem(makeItem(1));
    await addHistoryItem(makeItem(2));
    const history = await getHistory();
    expect(history.map((h) => h.prompt)).toEqual(['prompt 2', 'prompt 1']);
  });

  it('超过 20 条时丢弃最旧的', async () => {
    for (let n = 1; n <= 21; n++) {
      await addHistoryItem(makeItem(n));
    }
    const history = await getHistory();
    expect(history).toHaveLength(20);
    expect(history[0]?.prompt).toBe('prompt 21');
    expect(history[19]?.prompt).toBe('prompt 2');
  });

  it('清空后为空数组', async () => {
    await addHistoryItem(makeItem(1));
    await clearHistory();
    await expect(getHistory()).resolves.toEqual([]);
  });

  it('条目携带 id 与 createdAt', async () => {
    const entry = await addHistoryItem(makeItem(1));
    expect(typeof entry.id).toBe('string');
    expect(entry.id.length).toBeGreaterThan(0);
    expect(typeof entry.createdAt).toBe('number');
  });
});
