/**
 * Vitest 全局 setup：mock 浏览器扩展 API（chrome.*），
 * 让 lib 层的纯逻辑单测可以在 Node 环境运行。
 */
import { beforeEach, vi } from 'vitest';

/** 模拟 chrome.storage.local 的内存后端 */
const memoryStore = new Map<string, unknown>();

const storageLocalMock = {
  get: vi.fn(async (key: string | string[]) => {
    const keys = Array.isArray(key) ? key : [key];
    const result: Record<string, unknown> = {};
    for (const k of keys) {
      if (memoryStore.has(k)) {
        result[k] = memoryStore.get(k);
      }
    }
    return result;
  }),
  set: vi.fn(async (items: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(items)) {
      memoryStore.set(k, v);
    }
  }),
  remove: vi.fn(async (key: string | string[]) => {
    const keys = Array.isArray(key) ? key : [key];
    for (const k of keys) {
      memoryStore.delete(k);
    }
  }),
};

beforeEach(() => {
  memoryStore.clear();
  vi.clearAllMocks();
});

vi.stubGlobal('chrome', {
  i18n: {
    getMessage: vi.fn((messageName: string) => messageName),
  },
  runtime: {
    openOptionsPage: vi.fn(),
    sendMessage: vi.fn(),
  },
  storage: {
    local: storageLocalMock,
  },
});
