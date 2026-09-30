/**
 * OpenAI-compatible 视觉模型客户端。
 *
 * 兼容任何实现 `/chat/completions`（含 `image_url`）的接口：
 * OpenAI、OpenRouter、Groq、Ollama、LM Studio、DeepSeek 等。
 * 所有请求均由用户浏览器直接发往其配置的 Base URL，无中间服务器。
 */
import {
  buildTemplateSystemPrompt,
  buildTemplateUserText,
  getBuiltinTemplate,
} from './prompt-templates.js';
import { t } from './i18n.js';
import type { OutputFormat, PromptLanguage, PromptTemplate, StructuredPrompt } from './types.js';

/** 默认请求超时：60 秒（连接测试等轻量请求） */
const DEFAULT_TIMEOUT_MS = 60_000;
/**
 * 生成提示词的默认超时：120 秒。
 * 详细模板 + 高 max_tokens 下完整生成可能超过 60 秒；流式输出时用户可实时
 * 看到进度，超时仅作为兜底（首 token 长时间不来或流中途卡死）。
 */
const DEFAULT_GENERATE_TIMEOUT_MS = 120_000;
/** 发送给模型的最大图片边长（像素），超出则等比压缩 */
export const MAX_IMAGE_EDGE_PX = 1568;
/** 历史记录缩略图的最大边长（像素） */
const THUMBNAIL_EDGE_PX = 160;
/** 压缩为 JPEG 时的质量 */
const JPEG_QUALITY = 0.85;
/** 模型最大输出 token 数（详细提示词需要更大的输出预算） */
const MAX_OUTPUT_TOKENS = 2000;
/**
 * 防复读惩罚参数：实测可消除部分视觉模型（如 llama-3.2-vision）在长输出时
 * 陷入的重复 loop（"夜市的灯光，城市的灯光……"式复读），同时不损伤正常输出质量。
 * 标准 OpenAI 参数，OpenAI / OpenRouter / Groq / Ollama 等兼容接口均支持。
 */
const FREQUENCY_PENALTY = 0.6;
const PRESENCE_PENALTY = 0.3;
/** 图片下载体积上限：30MB，超过直接拒绝，避免 SW 内存尖峰 */
const MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024;

/**
 * 判断 Base URL 是否为"非本地的明文 http"。
 * 此时 API Key 会以明文在网络上传输，调用方应在 UI 层给出警告。
 */
export function isInsecureBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl.trim());
    if (url.protocol !== 'http:') {
      return false;
    }
    const host = url.hostname.toLowerCase();
    return host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]';
  } catch {
    return false;
  }
}

export interface GenerateImagePromptOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** 已压缩的图片 dataURL */
  imageDataUrl: string;
  lang: PromptLanguage;
  /** 提示词模板（省略时用内置"通用"模板） */
  template?: PromptTemplate;
  /** 超时毫秒数，默认 120 秒 */
  timeoutMs?: number;
  /**
   * 流式增量回调：提供时请求自动带上 `stream: true`，收到每个文本增量时
   * 以"当前累计全文"调用。用于面板实时展示生成进度，解决长生成"一直转圈"问题。
   * 若服务端不支持流式（忽略 stream 参数返回普通 JSON），会在拿到完整结果后
   * 调用一次，保证调用方语义一致。
   */
  onToken?: (partialText: string) => void;
  /**
   * 外部取消信号（如用户点击"取消"）。
   * 触发时请求被中止并抛出"已取消"错误，与超时区分处理。
   */
  signal?: AbortSignal;
}

/** 生成结果：文本模式或结构化 JSON 模式 */
export type GenerateResult =
  { format: 'text'; text: string } | { format: 'json'; text: string; structured: StructuredPrompt };

export interface ConnectionTestOptions {
  apiKey: string;
  baseUrl: string;
  /** 测试时实际 ping 的模型，可选 */
  model?: string;
  timeoutMs?: number;
}

/** 携带 HTTP 状态码的业务错误，message 均为用户可读文案 */
export class VisionApiError extends Error {
  readonly status: number | undefined;

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
 * @throws {VisionApiError} 入参缺失、HTTP 错误、超时、用户取消、网络失败、
 *   模型返回为空或 JSON 解析失败时抛出
 */
/**
 * 解析模型服务的 JSON 响应体。
 * 服务端返回 200 但 body 不是合法 JSON（如网关吐的 HTML 错误页）时，
 * 给出明确提示而不是误报"网络请求失败"。
 */
/**
 * 解析 HTTP 200 的响应体为 JSON。
 * 导出以便单测：网关返回 HTML/纯文本时不再误报"网络错误"，
 * 而是明确提示检查 Base URL / 兼容接口。
 */
export async function parseJsonResponse(
  response: Response
): Promise<{ choices?: Array<{ message?: { content?: string } }> }> {
  try {
    return (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  } catch {
    throw new VisionApiError(t('apiResponseUnparseable'));
  }
}

/**
 * 判断响应是否为 SSE 流（服务端接受了 `stream: true`）。
 */
function isSseResponse(response: Response): boolean {
  if (!response.body) {
    return false;
  }
  const contentType = response.headers?.get('content-type') ?? '';
  return contentType.includes('text/event-stream');
}

/**
 * 从单个 SSE 事件块中提取文本增量。
 * 返回 null 表示该事件无有效增量（`[DONE]`、心跳注释、空事件）。
 */
function extractSseDelta(eventBlock: string): string | null {
  let data = '';
  for (const line of eventBlock.split('\n')) {
    const trimmed = line.trim();
    // 以冒号开头的行为注释（如心跳 ": ping"），忽略
    if (trimmed.startsWith('data:')) {
      data += trimmed.slice(5).trim();
    }
  }
  if (!data || data === '[DONE]') {
    return null;
  }
  try {
    const parsed = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: string } }>;
    };
    return parsed.choices?.[0]?.delta?.content ?? '';
  } catch {
    // 某块损坏不致命中断整个流，跳过即可
    return '';
  }
}

/**
 * 读取 OpenAI 兼容的 SSE 流，拼接 `delta.content` 并在每次收到增量时
 * 以累计全文调用 `onToken`。
 *
 * @returns 累计的完整文本
 */
export async function readSseStream(
  response: Response,
  onToken: (partialText: string) => void
): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  const pumpBlock = (block: string): void => {
    const delta = extractSseDelta(block);
    if (!delta) {
      // null（DONE/心跳）或空增量：不推送，避免无意义的重复回调
      return;
    }
    fullText += delta;
    onToken(fullText);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      pumpBlock(block);
    }
  }
  // 尾部不足 `\n\n` 的残余块（如连接直接关闭）也尝试解析
  if (buffer.trim()) {
    pumpBlock(buffer);
  }
  return fullText;
}

export async function generateImagePrompt(
  options: GenerateImagePromptOptions
): Promise<GenerateResult> {
  const { apiKey, baseUrl, model, imageDataUrl, lang } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_GENERATE_TIMEOUT_MS;
  const template = options.template ?? getBuiltinTemplate('builtin:general');
  const outputFormat: OutputFormat = template.outputFormat;
  const onToken = options.onToken;
  const useStream = typeof onToken === 'function';

  if (!apiKey.trim()) {
    throw new VisionApiError('尚未填写 API Key，请先打开设置页完成配置');
  }
  if (!baseUrl.trim()) {
    throw new VisionApiError('尚未填写 Base URL，请先打开设置页完成配置');
  }
  if (options.signal?.aborted) {
    throw new VisionApiError('已取消本次请求');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = (): void => controller.abort();
  options.signal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    const body: Record<string, unknown> = {
      model: model.trim(),
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0.7,
      // 防复读：长输出时抑制"同一短语反复出现"式退化（实测有效）
      frequency_penalty: FREQUENCY_PENALTY,
      presence_penalty: PRESENCE_PENALTY,
      messages: [
        { role: 'system', content: buildTemplateSystemPrompt(template, lang) },
        {
          role: 'user',
          content: [
            { type: 'text', text: buildTemplateUserText(template, lang) },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
    };
    if (useStream) {
      body.stream = true;
    }
    if (outputFormat === 'json') {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch(joinUrl(baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new VisionApiError(friendlyHttpError(response.status), response.status);
    }

    let text: string;
    if (useStream && isSseResponse(response)) {
      // 流式：边收边通过 onToken 推送累计全文，首 token 通常 2 秒内到达
      text = (await readSseStream(response, onToken)).trim();
    } else {
      const data = await parseJsonResponse(response);
      text = data.choices?.[0]?.message?.content?.trim() ?? '';
      if (useStream && text) {
        // 服务端忽略了 stream 参数：一次性回调，保证调用方语义一致
        onToken(text);
      }
    }
    if (!text) {
      throw new VisionApiError('模型返回内容为空，请重试');
    }
    if (outputFormat === 'json') {
      const structured = parseStructuredPrompt(text);
      return { format: 'json', text: structured.prompt, structured };
    }
    return { format: 'text', text };
  } catch (error) {
    if (error instanceof VisionApiError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      if (options.signal?.aborted) {
        throw new VisionApiError('已取消本次请求');
      }
      throw new VisionApiError('请求超时：模型响应太慢，请重试或更换模型');
    }
    throw new VisionApiError('网络请求失败：请检查 Base URL 与网络连接');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * 解析模型返回的结构化 JSON，容忍 markdown 代码围栏与多余字段。
 * 字段缺失时用空值兜底，保证调用方总能拿到可用对象。
 *
 * @throws {VisionApiError} 完全无法解析为 JSON 时抛出
 */
/**
 * 从模型原始输出中提取 JSON 负载。
 * 部分视觉模型（如 llama-3.2-vision）即使要求 json_object 仍会在 JSON
 * 前后附加标题或说明（如 "**AI 绘画提示词**\n\n{...}"），这里做宽容提取：
 * 去 markdown 围栏 → 取首个 { 到末个 } 之间的子串。
 */
function extractJsonPayload(raw: string): string {
  const withoutFences = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return withoutFences.slice(start, end + 1);
  }
  return withoutFences;
}

export function parseStructuredPrompt(raw: string): StructuredPrompt {
  const cleaned = extractJsonPayload(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new VisionApiError('模型返回的不是合法 JSON，请重试或换用文本模板');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new VisionApiError('模型返回的不是合法 JSON，请重试或换用文本模板');
  }
  const obj = parsed as Record<string, unknown>;
  return {
    prompt: typeof obj.prompt === 'string' ? obj.prompt.trim() : '',
    tags: toStringArray(obj.tags),
    style: typeof obj.style === 'string' ? obj.style.trim() : '',
    colors: toStringArray(obj.colors),
    mood: typeof obj.mood === 'string' ? obj.mood.trim() : '',
  };
}

/** 宽容地把未知值转为字符串数组（兼容逗号分隔字符串） */
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((v): v is string => typeof v === 'string')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
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
    throw new VisionApiError(t('apiKeyRequiredForTest'));
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
 * @param options.signal 外部取消信号（图片下载阶段也可被取消）
 * @returns 压缩后的 `data:image/jpeg;base64,...`
 */
export async function fetchImageAsDataUrl(
  imageUrl: string,
  maxEdgePx: number = MAX_IMAGE_EDGE_PX,
  options: { signal?: AbortSignal } = {}
): Promise<string> {
  let blob: Blob;
  try {
    // exactOptionalPropertyTypes 下不能显式传 undefined 的 signal
    const init: RequestInit = {};
    if (options.signal) {
      init.signal = options.signal;
    }
    const response = await fetch(imageUrl, init);
    if (!response.ok) {
      throw new VisionApiError(`图片下载失败（HTTP ${response.status}），可能是防盗链`);
    }
    // headers 可能缺失（如测试 mock）：可选链兜底，缺失时走下载后 blob.size 检查
    const declaredLength = Number(response.headers?.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_DOWNLOAD_BYTES) {
      throw new VisionApiError(t('apiImageTooLarge'));
    }
    blob = await response.blob();
    if (blob.size > MAX_DOWNLOAD_BYTES) {
      throw new VisionApiError(t('apiImageTooLarge'));
    }
  } catch (error) {
    if (error instanceof VisionApiError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new VisionApiError('已取消本次请求');
    }
    throw new VisionApiError('图片下载失败，请检查网络连接后重试');
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new VisionApiError('图片解码失败，可能是图片已损坏或格式不支持');
  }

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

/**
 * 把已有的图片 dataURL 等比压缩到指定长边（service worker 安全：OffscreenCanvas）。
 * 用于选区截图/本地上传场景生成历史缩略图。
 */
export async function downscaleDataUrl(dataUrl: string, maxEdgePx: number): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new VisionApiError('图片数据损坏或格式不支持，请重试');
  }

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
 * 从整页截图 dataURL 中按 CSS 像素选区裁剪（考虑 devicePixelRatio）。
 * service worker 安全。
 */
export async function cropScreenshot(
  screenshotDataUrl: string,
  rect: { x: number; y: number; width: number; height: number },
  devicePixelRatio: number,
  maxEdgePx: number = MAX_IMAGE_EDGE_PX
): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    const response = await fetch(screenshotDataUrl);
    const blob = await response.blob();
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new VisionApiError('截图数据损坏，请重新框选');
  }

  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  const sx = Math.max(0, Math.round(rect.x * dpr));
  const sy = Math.max(0, Math.round(rect.y * dpr));
  const sw = Math.min(bitmap.width - sx, Math.round(rect.width * dpr));
  const sh = Math.min(bitmap.height - sy, Math.round(rect.height * dpr));
  if (sw <= 0 || sh <= 0) {
    throw new VisionApiError('选区无效，请重新框选');
  }

  const scale = Math.min(1, maxEdgePx / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * scale));
  const height = Math.max(1, Math.round(sh * scale));

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new VisionApiError('图片处理失败：当前环境不支持画布');
  }
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
  bitmap.close();

  const outBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
  return blobToDataUrl(outBlob);
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
  if (status === 400) return t('apiHttp400');
  if (status === 401) return 'API Key 无效或已过期（401），请检查设置页中的 Key';
  if (status === 403) return '接口拒绝访问（403），请检查 Key 权限或 Base URL';
  if (status === 404) return '接口地址不存在（404），请检查 Base URL 与模型名称';
  if (status === 413) return t('apiHttp413');
  if (status === 429) return '请求过于频繁（429），请稍后再试';
  if (status >= 500) return `服务端错误（${status}），请稍后重试`;
  return `请求失败（HTTP ${status}），请检查配置后重试`;
}
