import { describe, expect, it } from 'vitest';
import enMessages from '../_locales/en/messages.json';
import zhMessages from '../_locales/zh_CN/messages.json';

type MessagesFile = Record<string, { message: string; description?: string }>;

describe('_locales', () => {
  const zh = zhMessages as MessagesFile;
  const en = enMessages as MessagesFile;

  it('中英 key 集合完全一致', () => {
    const zhKeys = Object.keys(zh).sort();
    const enKeys = Object.keys(en).sort();
    expect(enKeys).toEqual(zhKeys);
  });

  it('所有 message 非空', () => {
    for (const [locale, messages] of [
      ['zh_CN', zh],
      ['en', en],
    ] as const) {
      for (const [key, entry] of Object.entries(messages)) {
        expect(entry.message.length, `${locale}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('包含插件必需的 key', () => {
    for (const key of ['appName', 'appDescription', 'contextMenuTitle']) {
      expect(zh[key], `zh_CN.${key}`).toBeDefined();
      expect(en[key], `en.${key}`).toBeDefined();
    }
  });
});
