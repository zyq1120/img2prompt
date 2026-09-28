/**
 * 全局共享类型定义。
 */

/** 提示词输出语言 */
export type PromptLanguage = 'zh' | 'en';

/** 插件设置（持久化于 chrome.storage.local） */
export interface PluginSettings {
  /** OpenAI-compatible 接口密钥，绝不离开本地 */
  apiKey: string;
  /** OpenAI-compatible base URL，默认 https://api.openai.com/v1 */
  baseUrl: string;
  /** 视觉模型名称，默认 gpt-4o */
  model: string;
  /** 默认输出语言 */
  defaultLang: PromptLanguage;
}

/** 历史记录条目 */
export interface HistoryItem {
  /** 唯一 ID */
  id: string;
  /** 原图 URL（可能随时间失效，仅作来源展示） */
  imageUrl: string;
  /** 缩略图 dataURL，用于历史列表展示 */
  thumbnail: string;
  /** 生成的提示词正文 */
  prompt: string;
  /** 生成时使用的语言 */
  lang: PromptLanguage;
  /** 生成时使用的模型 */
  model: string;
  /** 创建时间戳（毫秒） */
  createdAt: number;
}

/** 悬浮面板状态 */
export type PanelState = 'loading' | 'result' | 'error';

/** background → content script：面板状态推送 */
export interface PanelStateMessage {
  type: 'IMG2PROMPT_PANEL_STATE';
  state: PanelState;
  /** result 状态下的提示词正文 */
  text?: string;
  /** error 状态下的用户可读错误信息 */
  error?: string;
  /** 当前语言 */
  lang?: PromptLanguage;
}

/** content script → background：请求生成提示词 */
export interface GenerateRequestMessage {
  type: 'IMG2PROMPT_GENERATE';
  /**
   * 图片 dataURL（已压缩）。
   * content script 发起重试/切换语言时可省略，background 会使用该 tab 缓存的图片。
   */
  imageDataUrl?: string;
  /** 期望输出语言 */
  lang: PromptLanguage;
}

/** content script → background：打开设置页 */
export interface OpenOptionsMessage {
  type: 'IMG2PROMPT_OPEN_OPTIONS';
}

/** background → content script：开始一次新的识别（携带原图 URL） */
export interface StartMessage {
  type: 'IMG2PROMPT_START';
  imageUrl: string;
}

/** 插件内所有跨上下文消息的联合类型 */
export type ExtensionMessage =
  PanelStateMessage | GenerateRequestMessage | StartMessage | OpenOptionsMessage;
