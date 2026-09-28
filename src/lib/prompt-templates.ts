/**
 * 中英提示词模板：构造发给视觉模型的 system / user 文本。
 *
 * 设计目标：让模型输出可直接用于 Midjourney / Stable Diffusion /
 * FLUX / DALL-E 类工具的提示词 —— 英文逗号分隔 tag 与一句自然语言
 * 描述的混合风格；中文输出则为等效的中文描述词串。
 */
import type { PromptLanguage } from './types.js';

/**
 * 构建 system prompt，约束模型的输出语言、内容维度和格式。
 *
 * @param lang 期望的提示词输出语言
 * @returns 可直接放入 chat completions messages 的 system 文本
 */
export function buildSystemPrompt(lang: PromptLanguage): string {
  const outputLanguage = lang === 'zh' ? 'Simplified Chinese' : 'English';
  const lengthHint =
    lang === 'zh' ? '80-200 个汉字' : '60-150 English words';

  return [
    'You are an expert prompt engineer for AI image generation tools',
    '(Midjourney, Stable Diffusion, FLUX, DALL-E).',
    `Analyze the image the user provides and write ONE reusable image-generation prompt in ${outputLanguage}.`,
    'Requirements:',
    '- Cover these dimensions: main subject, composition, camera perspective,',
    '  lighting, color palette, materials and textures, art style, mood and atmosphere,',
    '  plus any striking details.',
    '- Style: comma-separated descriptive tags blended with one concise',
    '  natural-language sentence. No markdown, no quotation marks, no preamble,',
    '  no explanations.',
    `- Length: about ${lengthHint}.`,
    '- Output ONLY the prompt text, nothing else.',
  ].join('\n');
}

/**
 * 构建 user 文本（与图片一同发送，给模型一个明确的动作指令）。
 *
 * @param lang 期望的提示词输出语言
 */
export function buildUserText(lang: PromptLanguage): string {
  return lang === 'zh'
    ? '请仔细观察这张图片，为它生成可用于 AI 绘画的提示词。'
    : 'Look carefully at this image and generate an AI image-generation prompt for it.';
}
