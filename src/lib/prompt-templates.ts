/**
 * 提示词模板：构造发给视觉模型的 system / user 文本。
 *
 * 包含 7 套内置预设模板（通用 / 人像 / 风景建筑 / 产品静物 /
 * 概念艺术 / 插画水彩 / 结构化 JSON），用户也可在设置页创建自定义模板。
 * 模板的 system 文本支持 `{outputLanguage}` 与 `{lengthHint}` 占位符，
 * 在调用时按目标语言替换。
 */
import type { OutputFormat, PromptLanguage, PromptTemplate } from './types.js';

/** 默认模板 ID（通用） */
export const DEFAULT_TEMPLATE_ID = 'builtin:general';

/** JSON 结构化输出的字段说明（拼入 system prompt） */
const JSON_SCHEMA_HINT = [
  'Output ONLY a JSON object with exactly these fields, no markdown fences, no extra text:',
  '{',
  '  "prompt": "the reusable image-generation prompt text",',
  '  "tags": ["comma", "separated", "descriptive", "tags"],',
  '  "style": "art style in a few words",',
  '  "colors": ["dominant", "colors"],',
  '  "mood": "mood and atmosphere in a few words"',
  '}',
].join('\n');

function baseRequirements(): string[] {
  return [
    'Requirements:',
    '- Cover these dimensions: main subject, composition, camera perspective,',
    '  lighting, color palette, materials and textures, art style, mood and atmosphere,',
    '  plus any striking details.',
    '- Style: comma-separated descriptive tags blended with one concise',
    '  natural-language sentence. No markdown, no quotation marks, no preamble,',
    '  no explanations.',
    '- Length: about {lengthHint}.',
    '- Output ONLY the prompt text, nothing else.',
  ];
}

/** 7 套内置模板 */
export const BUILTIN_TEMPLATES: PromptTemplate[] = [
  {
    id: 'builtin:general',
    name: '通用',
    nameI18nKey: 'templateNameGeneral',
    systemPrompt: [
      'You are an expert prompt engineer for AI image generation tools',
      '(Midjourney, Stable Diffusion, FLUX, DALL-E).',
      'Analyze the image the user provides and write ONE reusable image-generation prompt in {outputLanguage}.',
      ...baseRequirements(),
    ].join('\n'),
    userTextZh: '请仔细观察这张图片，为它生成可用于 AI 绘画的提示词。',
    userTextEn: 'Look carefully at this image and generate an AI image-generation prompt for it.',
    outputFormat: 'text',
    builtin: true,
  },
  {
    id: 'builtin:portrait',
    name: '人像摄影',
    nameI18nKey: 'templateNamePortrait',
    systemPrompt: [
      'You are an expert portrait-photography prompt engineer for AI image generation tools',
      '(Midjourney, Stable Diffusion, FLUX, DALL-E).',
      'Analyze the portrait the user provides and write ONE reusable image-generation prompt in {outputLanguage}.',
      'Requirements:',
      '- Cover: subject identity cues (age impression, expression, pose, gaze),',
      '  framing and focal length feel, camera angle, depth of field,',
      '  lighting setup (key/fill/rim, natural vs studio), skin tone rendering,',
      '  wardrobe and styling, background treatment, color grading, mood.',
      '- Style: comma-separated descriptive tags blended with one concise',
      '  natural-language sentence. No markdown, no quotation marks, no preamble,',
      '  no explanations.',
      '- Length: about {lengthHint}.',
      '- Output ONLY the prompt text, nothing else.',
    ].join('\n'),
    userTextZh: '请仔细观察这张人像照片，为它生成可用于 AI 绘画的人像摄影提示词。',
    userTextEn:
      'Look carefully at this portrait and generate an AI portrait-photography prompt for it.',
    outputFormat: 'text',
    builtin: true,
  },
  {
    id: 'builtin:landscape',
    name: '风景建筑',
    nameI18nKey: 'templateNameLandscape',
    systemPrompt: [
      'You are an expert landscape and architecture prompt engineer for AI image generation tools',
      '(Midjourney, Stable Diffusion, FLUX, DALL-E).',
      'Analyze the scenery or architecture image the user provides and write ONE reusable',
      'image-generation prompt in {outputLanguage}.',
      'Requirements:',
      '- Cover: location/scene type, spatial layout and leading lines, vantage point',
      '  and lens feel, time of day and weather, natural vs artificial lighting,',
      '  color palette and atmospheric perspective, textures and materials,',
      '  scale cues (people, vegetation, structures), mood and atmosphere.',
      '- Style: comma-separated descriptive tags blended with one concise',
      '  natural-language sentence. No markdown, no quotation marks, no preamble,',
      '  no explanations.',
      '- Length: about {lengthHint}.',
      '- Output ONLY the prompt text, nothing else.',
    ].join('\n'),
    userTextZh: '请仔细观察这张风景/建筑图片，为它生成可用于 AI 绘画的提示词。',
    userTextEn:
      'Look carefully at this landscape/architecture image and generate an AI image-generation prompt for it.',
    outputFormat: 'text',
    builtin: true,
  },
  {
    id: 'builtin:product',
    name: '产品静物',
    nameI18nKey: 'templateNameProduct',
    systemPrompt: [
      'You are an expert commercial product-photography prompt engineer for AI image generation tools',
      '(Midjourney, Stable Diffusion, FLUX, DALL-E).',
      'Analyze the product or still-life image the user provides and write ONE reusable',
      'image-generation prompt in {outputLanguage}.',
      'Requirements:',
      '- Cover: product identity and key features, hero angle and framing,',
      '  studio lighting setup (softbox, rim light, reflections), surface and backdrop,',
      '  props and composition, materials and surface finish, color palette,',
      '  sharpness and depth of field, premium commercial mood.',
      '- Style: comma-separated descriptive tags blended with one concise',
      '  natural-language sentence. No markdown, no quotation marks, no preamble,',
      '  no explanations.',
      '- Length: about {lengthHint}.',
      '- Output ONLY the prompt text, nothing else.',
    ].join('\n'),
    userTextZh: '请仔细观察这张产品/静物图片，为它生成可用于 AI 绘画的商业摄影提示词。',
    userTextEn:
      'Look carefully at this product/still-life image and generate an AI commercial-photography prompt for it.',
    outputFormat: 'text',
    builtin: true,
  },
  {
    id: 'builtin:concept',
    name: '概念艺术',
    nameI18nKey: 'templateNameConcept',
    systemPrompt: [
      'You are an expert concept-art prompt engineer for AI image generation tools',
      '(Midjourney, Stable Diffusion, FLUX, DALL-E).',
      'Analyze the image the user provides and write ONE reusable image-generation prompt in {outputLanguage}.',
      'Requirements:',
      '- Cover: central concept and narrative hook, character/creature/environment design cues,',
      '  dramatic composition and dynamic camera angle, cinematic lighting,',
      '  rich color palette, surface detail density, rendered style',
      '  (e.g. cyberpunk, sci-fi, dark fantasy), epic mood and atmosphere.',
      '- Style: comma-separated descriptive tags blended with one concise',
      '  natural-language sentence. No markdown, no quotation marks, no preamble,',
      '  no explanations.',
      '- Length: about {lengthHint}.',
      '- Output ONLY the prompt text, nothing else.',
    ].join('\n'),
    userTextZh: '请仔细观察这张图片，为它生成可用于 AI 绘画的概念艺术提示词。',
    userTextEn:
      'Look carefully at this image and generate an AI concept-art prompt for it.',
    outputFormat: 'text',
    builtin: true,
  },
  {
    id: 'builtin:illustration',
    name: '插画水彩',
    nameI18nKey: 'templateNameIllustration',
    systemPrompt: [
      'You are an expert illustration prompt engineer for AI image generation tools',
      '(Midjourney, Stable Diffusion, FLUX, DALL-E).',
      'Analyze the image the user provides and write ONE reusable image-generation prompt in {outputLanguage}.',
      'Requirements:',
      '- Cover: illustration medium and technique (watercolor, gouache, ink, digital),',
      '  linework quality, brushstroke and paper texture, whimsical or refined composition,',
      '  soft lighting, harmonious color palette, charming details,',
      '  storybook or editorial mood.',
      '- Style: comma-separated descriptive tags blended with one concise',
      '  natural-language sentence. No markdown, no quotation marks, no preamble,',
      '  no explanations.',
      '- Length: about {lengthHint}.',
      '- Output ONLY the prompt text, nothing else.',
    ].join('\n'),
    userTextZh: '请仔细观察这张图片，为它生成可用于 AI 绘画的插画风格提示词。',
    userTextEn:
      'Look carefully at this image and generate an AI illustration-style prompt for it.',
    outputFormat: 'text',
    builtin: true,
  },
  {
    id: 'builtin:json',
    name: '结构化 JSON',
    nameI18nKey: 'templateNameJson',
    systemPrompt: [
      'You are an expert prompt engineer for AI image generation tools',
      '(Midjourney, Stable Diffusion, FLUX, DALL-E).',
      'Analyze the image the user provides and describe it as structured data in {outputLanguage}.',
      'Requirements:',
      '- The "prompt" field holds ONE reusable image-generation prompt covering:',
      '  main subject, composition, camera perspective, lighting, color palette,',
      '  materials and textures, art style, mood and atmosphere, plus striking details.',
      '- The "tags" field holds comma-style descriptive tags.',
      '- Length of "prompt": about {lengthHint}.',
      JSON_SCHEMA_HINT,
    ].join('\n'),
    userTextZh: '请仔细观察这张图片，用 JSON 结构化描述它的 AI 绘画提示词。',
    userTextEn:
      'Look carefully at this image and describe its AI image-generation prompt as structured JSON.',
    outputFormat: 'json',
    builtin: true,
  },
];

/** 按 id 取内置模板；找不到时回退默认模板 */
export function getBuiltinTemplate(id: string): PromptTemplate {
  return (
    BUILTIN_TEMPLATES.find((t) => t.id === id) ??
    BUILTIN_TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE_ID) ??
    BUILTIN_TEMPLATES[0]
  );
}

/** 输出语言名称（拼入 system prompt） */
function outputLanguageName(lang: PromptLanguage): string {
  return lang === 'zh' ? 'Simplified Chinese' : 'English';
}

/** 输出长度提示（拼入 system prompt） */
function lengthHint(lang: PromptLanguage): string {
  return lang === 'zh' ? '80-200 个汉字' : '60-150 English words';
}

/**
 * 构建模板的 system prompt（替换占位符）。
 */
export function buildTemplateSystemPrompt(template: PromptTemplate, lang: PromptLanguage): string {
  return template.systemPrompt
    .replaceAll('{outputLanguage}', outputLanguageName(lang))
    .replaceAll('{lengthHint}', lengthHint(lang));
}

/** 构建模板的 user 文本（按语言取对应版本） */
export function buildTemplateUserText(template: PromptTemplate, lang: PromptLanguage): string {
  return lang === 'zh' ? template.userTextZh : template.userTextEn;
}

/** 模板输出格式是否为 JSON */
export function isJsonTemplate(template: PromptTemplate): boolean {
  return template.outputFormat === 'json';
}

/** 输出格式（供 options 表单等使用） */
export function formatOutputFormat(format: OutputFormat): string {
  return format === 'json' ? 'JSON' : 'Text';
}

/**
 * 构建 system prompt，约束模型的输出语言、内容维度和格式。
 *（兼容旧 API，等价于默认"通用"模板的中文/英文输出）
 */
export function buildSystemPrompt(lang: PromptLanguage): string {
  const general = BUILTIN_TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE_ID);
  if (general) {
    return buildTemplateSystemPrompt(general, lang);
  }
  return '';
}

/**
 * 构建 user 文本（与图片一同发送，给模型一个明确的动作指令）。
 *（兼容旧 API）
 */
export function buildUserText(lang: PromptLanguage): string {
  const general = BUILTIN_TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE_ID);
  if (!general) {
    return '';
  }
  return buildTemplateUserText(general, lang);
}
