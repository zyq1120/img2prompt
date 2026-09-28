import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VisionApiError, generateImagePrompt, joinUrl, testConnection } from '../src/lib/api.js';

const BASE_OPTIONS = {
  apiKey: 'sk-test',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o',
  imageDataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
  lang: 'zh' as const,
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('joinUrl', () => {
  it('容忍 base 末尾多余的斜杠', () => {
    expect(joinUrl('https://api.openai.com/v1/', '/chat/completions')).toBe(
      'https://api.openai.com/v1/chat/completions'
    );
  });

  it('path 缺少前导斜杠时自动补上', () => {
    expect(joinUrl('https://api.openai.com/v1', 'chat/completions')).toBe(
      'https://api.openai.com/v1/chat/completions'
    );
  });
});

describe('generateImagePrompt', () => {
  it('成功时返回去除首尾空白的正文', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: '  a cat, studio light  ' } }] })
    );
    const text = await generateImagePrompt(BASE_OPTIONS);
    expect(text).toBe('a cat, studio light');
  });

  it('请求体包含模型与图片', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: 'prompt' } }] })
    );
    await generateImagePrompt(BASE_OPTIONS);
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      model: string;
      messages: Array<{ content: unknown }>;
    };
    expect(body.model).toBe('gpt-4o');
    expect(JSON.stringify(body.messages)).toContain('image_url');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sk-test' });
  });

  it('缺 API Key 时抛出用户可读错误', async () => {
    await expect(generateImagePrompt({ ...BASE_OPTIONS, apiKey: '  ' })).rejects.toThrow(
      VisionApiError
    );
    await expect(generateImagePrompt({ ...BASE_OPTIONS, apiKey: '' })).rejects.toThrow(/API Key/);
  });

  it('401 映射为 Key 无效提示', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: 'bad key' }, 401));
    await expect(generateImagePrompt(BASE_OPTIONS)).rejects.toThrow(/401/);
  });

  it('429 映射为限流提示', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: 'busy' }, 429));
    const error = await generateImagePrompt(BASE_OPTIONS).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VisionApiError);
    expect((error as VisionApiError).status).toBe(429);
  });

  it('模型返回为空时抛错', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ choices: [] }));
    await expect(generateImagePrompt(BASE_OPTIONS)).rejects.toThrow(/为空/);
  });

  it('网络异常时给出检查网络的提示', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(generateImagePrompt(BASE_OPTIONS)).rejects.toThrow(/网络/);
  });

  it('超时时给出超时提示', async () => {
    vi.mocked(fetch).mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        })
    );
    await expect(generateImagePrompt({ ...BASE_OPTIONS, timeoutMs: 50 })).rejects.toThrow(/超时/);
  });
});

describe('testConnection', () => {
  it('连通时返回 true', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ data: [] }));
    await expect(
      testConnection({ apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1' })
    ).resolves.toBe(true);
  });

  it('缺 Key 时直接抛错不发请求', async () => {
    await expect(testConnection({ apiKey: '', baseUrl: 'https://x' })).rejects.toThrow(
      VisionApiError
    );
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
