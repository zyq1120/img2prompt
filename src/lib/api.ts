/**
 * OpenAI-compatible 视觉模型客户端。
 *
 * 兼容任何实现 `/chat/completions`（含 `image_url`）的接口：
 * OpenAI、OpenRouter、Groq、Ollama、LM Studio、DeepSeek 等。
 * 所有请求均由用户浏览器直接发往其配置的 Base URL，无中间服务器。
 */
import { buildSystemPrompt, buildUserText } from './prompt-templates.js';
import type { PromptLanguage } from './types.js';

/** 默认请求超时：60 秒 */
const DEFAULT_TIMEOUT_MS = 60_000;
/** 发送给模型的最大图片边长（像素），超出则等比压缩 */
const MAX_IMAGE_EDGE_PX = 1568;
/** 历史记录缩略图的最大边长（像素） */
const THUMBNAIL_EDGE_PX = 160;
/** 压缩为 JPEG 时的质量 */
const JPEG_QUALITY = 0.85;
/** 模型最大输出 token 数 */
const MAX_OUTPUT_TOKENS = 800;

export interface GenerateImagePromptOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** 已压缩的图片 dataURL */
  imageDataUrl: string;
  lang: PromptLanguage;
  /** 超时毫秒数，默认 60 秒 */
  timeoutMs?: number;
}

export interface ConnectionTestOptions {
  apiKey: string;
  baseUrl: string;
  /** 测试时实际 ping 的模型，可选 */
  model?: string;
  timeoutMs?: number;
}

/** 携带 HTTP 状态码的业务错误，message 均为用户可读文案 */
export class VisionApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'VisionApiError';
    this.status = status;
  }
}

/**
 * 拼接 base URL 与路径，容忍 base 末尾多余的斜杠。
 *
 * @example joinUrl('https://api.openai.com/v1/', '/chat/completions')
 * // => 'https://api.openai.com/v1/chat/completions'
 */
export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * 调用视觉模型，根据图片生成绘画提示词。
 *
 * @throws {VisionApiError} 入参缺失、HTTP 错误、超时、网络失败或模型返回为空时抛出
 */
export async function generateImagePrompt(
  options: GenerateImagePromptOptions,
): Promise<string> {
  const { apiKey, baseUrl, model, imageDataUrl, lang } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (!apiKey.trim()) {
    throw new VisionApiError('尚未填写 API Key，请先打开设置页完成配置');
  }
  if (!baseUrl.trim()) {
    throw new VisionApiError('尚未填写 Base URL，请先打开设置页完成配置');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(joinUrl(baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: model.trim(),
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0.7,
        messages: [
          { role: 'system', content: buildSystemPrompt(lang) },
          {
            role: 'user',
            content: [
              { type: 'text', text: buildUserText(lang) },
              { type: 'image_url', image_url: { url: imageDataUrl } },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new VisionApiError(friendlyHttpError(response.status), response.status);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new VisionApiError('模型返回内容为空，请重试');
    }
    return text;
  } catch (error) {
    if (error instanceof VisionApiError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new VisionApiError('请求超时：模型响应太慢，请重试或更换模型');
    }
    throw new VisionApiError('网络请求失败：请检查 Base URL 与网络连接');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 测试连接：用 `/models` 轻量验证 Key 与 Base URL 是否可用。
 *
 * @returns 成功时返回 true；失败时抛出用户可读的 VisionApiError
 */
export async function testConnection(options: ConnectionTestOptions): Promise<true> {
  const { apiKey, baseUrl } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (!apiKey.trim() || !baseUrl.trim()) {
    throw new VisionApiError('请先填写 API Key 与 Base URL 再测试');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(joinUrl(baseUrl, '/models'), {
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new VisionApiError(friendlyHttpError(response.status), response.status);
    }
    return true;
  } catch (error) {
    if (error instanceof VisionApiError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new VisionApiError('请求超时：请检查 Base URL 是否可达');
    }
    throw new VisionApiError('网络请求失败：请检查 Base URL 与网络连接');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 下载图片并压缩为 JPEG dataURL（等比缩放，长边不超过 maxEdgePx）。
 * 在 MV3 service worker 中可用：fetch + createImageBitmap + OffscreenCanvas。
 *
 * @param imageUrl 图片地址
 * @param maxEdgePx 长边上限，默认 1568
 * @returns 压缩后的 `data:image/jpeg;base64,...`
 */
export async function fetchImageAsDataUrl(
  imageUrl: string,
  maxEdgePx: number = MAX_IMAGE_EDGE_PX,
): Promise<string> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new VisionApiError(`图片下载失败（HTTP ${response.status}），可能是防盗链`);
  }
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const scale = Math.min(1, maxEdgePx / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new VisionApiError('图片处理失败：当前环境不支持画布');
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const outBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
  return blobToDataUrl(outBlob);
}

/**
 * 生成缩略图 dataURL（长边 160px），用于历史记录列表展示。
 */
export function makeThumbnail(imageUrl: string): Promise<string> {
  return fetchImageAsDataUrl(imageUrl, THUMBNAIL_EDGE_PX);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new VisionApiError('图片读取失败，请重试'));
    reader.readAsDataURL(blob);
  });
}

/** 把 HTTP 状态码翻译成用户可读的中文提示 */
function friendlyHttpError(status: number): string {
  if (status === 401) return 'API Key 无效或已过期（401），请检查设置页中的 Key';
  if (status === 403) return '接口拒绝访问（403），请检查 Key 权限或 Base URL';
  if (status === 404) return '接口地址不存在（404），请检查 Base URL 与模型名称';
  if (status === 429) return '请求过于频繁（429），请稍后再试';
  if (status >= 500) return `服务端错误（${status}），请稍后重试`;
  return `请求失败（HTTP ${status}），请检查配置后重试`;
}
