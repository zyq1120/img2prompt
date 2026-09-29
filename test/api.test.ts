import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  VisionApiError,
  fetchImageAsDataUrl,
  generateImagePrompt,
  isInsecureBaseUrl,
  joinUrl,
  parseJsonResponse,
  parseStructuredPrompt,
  testConnection,
} from '../src/lib/api.js';
import { getBuiltinTemplate } from '../src/lib/prompt-templates.js';

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
    const result = await generateImagePrompt(BASE_OPTIONS);
    expect(result.format).toBe('text');
    expect(result.text).toBe('a cat, studio light');
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

  it('外部 signal 取消时抛出"已取消"而非超时', async () => {
    vi.mocked(fetch).mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        })
    );
    const controller = new AbortController();
    const pending = generateImagePrompt({ ...BASE_OPTIONS, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow(/已取消/);
  });

  it('已取消的 signal 直接抛错不发请求', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      generateImagePrompt({ ...BASE_OPTIONS, signal: controller.signal })
    ).rejects.toThrow(/已取消/);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('JSON 模板发送 response_format 并解析结构化结果', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                prompt: 'a cat, studio light',
                tags: ['cat', 'studio'],
                style: 'photorealistic',
                colors: ['warm gray'],
                mood: 'calm',
              }),
            },
          },
        ],
      })
    );
    const result = await generateImagePrompt({
      ...BASE_OPTIONS,
      template: getBuiltinTemplate('builtin:json'),
    });
    expect(result.format).toBe('json');
    if (result.format === 'json') {
      expect(result.text).toBe('a cat, studio light');
      expect(result.structured.tags).toEqual(['cat', 'studio']);
      expect(result.structured.style).toBe('photorealistic');
    }
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { response_format?: { type: string } };
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('JSON 模板返回非法 JSON 时抛错', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: 'not json at all' } }] })
    );
    await expect(
      generateImagePrompt({ ...BASE_OPTIONS, template: getBuiltinTemplate('builtin:json') })
    ).rejects.toThrow(/JSON/);
  });
});

describe('parseStructuredPrompt', () => {
  it('正常解析全部字段', () => {
    const result = parseStructuredPrompt(
      JSON.stringify({
        prompt: 'a cat',
        tags: ['cat', 'cute'],
        style: 'photo',
        colors: ['white'],
        mood: 'calm',
      })
    );
    expect(result).toEqual({
      prompt: 'a cat',
      tags: ['cat', 'cute'],
      style: 'photo',
      colors: ['white'],
      mood: 'calm',
    });
  });

  it('容忍 markdown 代码围栏', () => {
    const result = parseStructuredPrompt('```json\n{"prompt": "a cat"}\n```');
    expect(result.prompt).toBe('a cat');
    expect(result.tags).toEqual([]);
  });

  it('缺失字段用空值兜底', () => {
    const result = parseStructuredPrompt('{"prompt": "a cat"}');
    expect(result.style).toBe('');
    expect(result.colors).toEqual([]);
  });

  it('逗号分隔字符串转为数组', () => {
    const result = parseStructuredPrompt('{"prompt": "x", "tags": "a, b，c"}');
    expect(result.tags).toEqual(['a', 'b', 'c']);
  });

  it('非法 JSON 抛出用户可读错误', () => {
    expect(() => parseStructuredPrompt('{oops')).toThrow(VisionApiError);
    expect(() => parseStructuredPrompt('[1,2]')).toThrow(/JSON/);
  });

  it('容忍模型在 JSON 前附加的标题文本', () => {
    const raw =
      '**AI 绘画提示词**\n\n{ "prompt": "a cat", "tags": ["cat"], "style": "realistic", "colors": ["white"], "mood": "calm" }';
    const result = parseStructuredPrompt(raw);
    expect(result.prompt).toBe('a cat');
    expect(result.tags).toEqual(['cat']);
    expect(result.style).toBe('realistic');
  });

  it('容忍 JSON 后的多余说明文本', () => {
    const raw = '{"prompt": "a dog"}\n希望这个描述对你有帮助！';
    const result = parseStructuredPrompt(raw);
    expect(result.prompt).toBe('a dog');
  });

  it('围栏 + 前缀混合情况仍可提取', () => {
    const raw = 'Here you go:\n```json\n{"prompt": "a bird"}\n```';
    const result = parseStructuredPrompt(raw);
    expect(result.prompt).toBe('a bird');
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

describe('fetchImageAsDataUrl', () => {
  it('网络异常时抛出用户可读的 VisionApiError', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('fetch failed'));
    await expect(fetchImageAsDataUrl('https://example.com/a.jpg')).rejects.toThrow(VisionApiError);
    await expect(fetchImageAsDataUrl('https://example.com/a.jpg')).rejects.toThrow(/图片下载失败/);
  });

  it('HTTP 错误状态抛出防盗链提示', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 403 } as Response);
    await expect(fetchImageAsDataUrl('https://example.com/a.jpg')).rejects.toThrow(/防盗链/);
  });

  it('图片解码失败时抛出用户可读错误', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, blob: async () => new Blob() } as Response);
    // 直接挂到 globalThis，finally 里删掉；不碰 vi.unstubAllGlobals（会清掉 setup 的 chrome stub）
    (globalThis as Record<string, unknown>).createImageBitmap = vi
      .fn()
      .mockRejectedValue(new Error('decode fail'));
    try {
      await expect(fetchImageAsDataUrl('https://example.com/a.jpg')).rejects.toThrow(/解码失败/);
    } finally {
      delete (globalThis as Record<string, unknown>).createImageBitmap;
    }
  });
});

describe('parseJsonResponse', () => {
  it('合法 JSON 正常解析', async () => {
    const response = {
      ok: true,
      status: 200,
      json: async () => ({ choices: [] }),
      text: async () => '{"choices":[]}',
    } as Response;
    await expect(parseJsonResponse(response)).resolves.toEqual({ choices: [] });
  });

  it('HTTP 200 但非 JSON 时提示检查 Base URL 而非报网络错误', async () => {
    const response = {
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
      text: async () => '<html>not json</html>',
    } as unknown as Response;
    // i18n mock 返回 key 名本身
    await expect(parseJsonResponse(response)).rejects.toThrow(/apiResponseUnparseable/);
  });

  it('HTTP 错误状态的 ok 检查在调用方（generateImagePrompt），本函数只处理 200 解析', async () => {
    // parseJsonResponse 的前置条件是 response.ok；非 ok 由调用方先抛 friendlyHttpError
    const response = {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'hi' } }] }),
      text: async () => '',
    } as Response;
    const data = await parseJsonResponse(response);
    expect(data.choices?.[0]?.message?.content).toBe('hi');
  });
});

describe('isInsecureBaseUrl', () => {
  it('非本地 http 判定为不安全', () => {
    expect(isInsecureBaseUrl('http://api.example.com/v1')).toBe(true);
  });
  it('https 判定为安全', () => {
    expect(isInsecureBaseUrl('https://api.example.com/v1')).toBe(false);
  });
  it('本地 http 不告警', () => {
    expect(isInsecureBaseUrl('http://localhost:11434/v1')).toBe(false);
    expect(isInsecureBaseUrl('http://127.0.0.1:11434/v1')).toBe(false);
  });
  it('非法 URL 返回 false（交给表单校验处理）', () => {
    expect(isInsecureBaseUrl('not-a-url')).toBe(false);
  });
});

describe('fetchImageAsDataUrl 大小与取消', () => {
  const MB = 1024 * 1024;

  it('声明 Content-Length 超 30MB 时直接拒绝', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-length': String(31 * MB) }),
      blob: async () => new Blob(),
    } as Response);
    await expect(fetchImageAsDataUrl('https://example.com/big.jpg')).rejects.toThrow(
      /apiImageTooLarge/
    );
    // blob() 不应被调用：省一次大下载
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('实际 blob 体积超 30MB 时拒绝', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      headers: new Headers(),
      blob: async () => ({ size: 31 * MB }) as Blob,
    } as Response);
    await expect(fetchImageAsDataUrl('https://example.com/big.jpg')).rejects.toThrow(
      /apiImageTooLarge/
    );
  });

  it('下载中被取消时抛出"已取消"而非网络错误', async () => {
    vi.mocked(fetch).mockRejectedValue(new DOMException('aborted', 'AbortError'));
    const controller = new AbortController();
    await expect(
      fetchImageAsDataUrl('https://example.com/a.jpg', 1568, { signal: controller.signal })
    ).rejects.toThrow(/已取消/);
  });

  it('传入的 signal 会透传给 fetch', async () => {
    let capturedInit: RequestInit | undefined;
    vi.mocked(fetch).mockImplementation(async (_url: unknown, init?: RequestInit) => {
      capturedInit = init;
      return { ok: false, status: 404 } as Response;
    });
    const controller = new AbortController();
    await expect(
      fetchImageAsDataUrl('https://example.com/a.jpg', 1568, { signal: controller.signal })
    ).rejects.toThrow();
    expect(capturedInit?.signal).toBe(controller.signal);
  });
});

describe('testConnection HTTP 状态文案', () => {
  it('400 提示检查模型配置', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 400 } as Response);
    await expect(
      testConnection({ apiKey: 'sk-test', baseUrl: 'https://api.example.com/v1' })
    ).rejects.toThrow(/apiHttp400/);
  });

  it('413 提示图片过大', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 413 } as Response);
    await expect(
      testConnection({ apiKey: 'sk-test', baseUrl: 'https://api.example.com/v1' })
    ).rejects.toThrow(/apiHttp413/);
  });
});
