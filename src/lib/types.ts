/**
 * 全局共享类型定义。
 */

/** 提示词输出语言 */
export type PromptLanguage = 'zh' | 'en';

/** 模型输出格式 */
export type OutputFormat = 'text' | 'json';

/** 服务商配置（OpenAI-compatible 接入点） */
export interface ProviderConfig {
  /** 唯一 ID */
  id: string;
  /** 显示名称，如 "NVIDIA"、"OpenRouter" */
  name: string;
  /** OpenAI-compatible base URL */
  baseUrl: string;
  /** 接口密钥，绝不离开本地 */
  apiKey: string;
  /** 视觉模型名称 */
  model: string;
}

/** 提示词模板 */
export interface PromptTemplate {
  /** 唯一 ID；内置模板为 "builtin:<slug>" */
  id: string;
  /** 显示名称 */
  name: string;
  /** 内置模板的 i18n key（自定义模板为空） */
  nameI18nKey?: string;
  /**
   * 发给模型的 system 文本，支持占位符：
   * `{outputLanguage}` → Simplified Chinese / English
   * `{lengthHint}` → 80-200 个汉字 / 60-150 English words
   */
  systemPrompt: string;
  /** 中文场景下发给模型的 user 文本（与图片一同发送） */
  userTextZh: string;
  /** 英文场景下发给模型的 user 文本 */
  userTextEn: string;
  /** 输出格式 */
  outputFormat: OutputFormat;
  /** 是否为内置模板（不可删除） */
  builtin?: boolean;
}

/** 结构化 JSON 输出 */
export interface StructuredPrompt {
  /** 可直接使用的提示词正文 */
  prompt: string;
  /** 描述性标签 */
  tags: string[];
  /** 艺术风格 */
  style: string;
  /** 色彩 */
  colors: string[];
  /** 氛围情绪 */
  mood: string;
}

/** 插件设置（持久化于 chrome.storage.local） */
export interface PluginSettings {
  /** 已配置的服务商列表 */
  providers: ProviderConfig[];
  /** 当前启用的服务商 ID */
  activeProviderId: string;
  /** 当前启用的提示词模板 ID */
  activeTemplateId: string;
  /** 默认输出语言 */
  defaultLang: PromptLanguage;
}

/** 历史记录条目 */
export interface HistoryItem {
  /** 唯一 ID */
  id: string;
  /** 原图 URL（可能随时间失效，仅作来源展示；截图/上传场景为空） */
  imageUrl: string;
  /** 图片来源：右键菜单 / 选区截图 / 本地上传 */
  source: 'context-menu' | 'region' | 'upload';
  /** 缩略图 dataURL，用于历史列表展示 */
  thumbnail: string;
  /** 生成的提示词正文 */
  prompt: string;
  /** 结构化输出（JSON 模式时） */
  structured?: StructuredPrompt;
  /** 生成时使用的语言 */
  lang: PromptLanguage;
  /** 生成时使用的模型 */
  model: string;
  /** 生成时使用的服务商名称 */
  providerName: string;
  /** 生成时使用的模板 ID */
  templateId: string;
  /** 是否收藏 */
  favorite: boolean;
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
  /** result 状态下 JSON 模板的结构化输出 */
  structured?: StructuredPrompt;
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
  /** 使用的模板 ID（省略时用设置中的当前模板） */
  templateId?: string;
}

/** content script → background：打开设置页 */
export interface OpenOptionsMessage {
  type: 'IMG2PROMPT_OPEN_OPTIONS';
}

/** content script → background：取消当前 tab 正在进行的生成请求 */
export interface CancelRequestMessage {
  type: 'IMG2PROMPT_CANCEL';
}

/** background → content script：在当前页启动选区截图 */
export interface RegionSelectMessage {
  type: 'IMG2PROMPT_REGION_SELECT';
}

/** content script → background：用户完成选区 */
export interface RegionDoneMessage {
  type: 'IMG2PROMPT_REGION_DONE';
  /** CSS 像素坐标的选区 */
  rect: { x: number; y: number; width: number; height: number };
  /** 选区时的 devicePixelRatio，用于裁剪截图 */
  devicePixelRatio: number;
}

/** background → content script：开始一次新的识别（携带原图 URL） */
export interface StartMessage {
  type: 'IMG2PROMPT_START';
  imageUrl: string;
}

/** 插件内所有跨上下文消息的联合类型 */
export type ExtensionMessage =
  | PanelStateMessage
  | GenerateRequestMessage
  | CancelRequestMessage
  | RegionSelectMessage
  | RegionDoneMessage
  | StartMessage
  | OpenOptionsMessage;
