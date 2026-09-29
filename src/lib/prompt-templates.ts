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
  'Output ONLY a JSON object with exactly these fields, no markdown fences, no extra text.',
  'Start your response with { and end it with }. No title, no heading, no preamble, no explanation.',
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
    '- Be exhaustive: describe the image in rich detail across ALL of these dimensions,',
    '  skipping none:',
    '  1) main subject: identity, appearance, pose, expression, clothing, distinctive features;',
    '  2) composition: framing, rule of thirds, foreground / midground / background,',
    '     balance, negative space, leading lines;',
    '  3) camera and perspective: angle, focal-length feel, depth of field, vantage point;',
    '  4) lighting: light-source direction, quality (soft / hard), color temperature,',
    '     shadows and highlights, reflections;',
    '  5) color palette: dominant hues, saturation, contrast, color-grading mood;',
    '  6) materials and textures: surface finish, fabric, grain, fine tactile detail;',
    '  7) art style and medium: photographic / painted / digital cues, era and genre signals;',
    '  8) mood and atmosphere: emotional tone and the story the image hints at;',
    '  9) at least five concrete visual details a viewer would notice on a second look.',
    '- Style: comma-separated descriptive tags blended with two or three',
    '  natural-language sentences. No markdown, no quotation marks, no preamble,',
    '  no explanations, no meta-commentary.',
    '- Length: about {lengthHint}. Prefer completeness over brevity;',
    '  a longer precise prompt is better than a short vague one.',
    '- Output ONLY the prompt text, nothing else.',
  ];
}

/** 各模板通用的详细度强化尾巴：具体、穷尽、拒绝泛泛而谈 */
function detailFooter(): string[] {
  return [
    '- Go deep on specifics: name exact colors, textures, light directions and',
    '  spatial relations instead of generic adjectives.',
    '- Include at least five concrete visual details a viewer would notice on a second look.',
    '- Style: comma-separated descriptive tags blended with two or three',
    '  natural-language sentences. No markdown, no quotation marks, no preamble,',
    '  no explanations, no meta-commentary.',
    '- Length: about {lengthHint}. Prefer completeness over brevity;',
    '  a longer precise prompt is better than a short vague one.',
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
      '- Cover exhaustively: subject identity cues (age impression, facial features,',
      '  expression nuance, pose, gaze direction, hair style and texture),',
      '  framing (headshot / half-body / full-body) and focal-length feel, camera angle,',
      '  depth of field and bokeh character, lighting setup (key / fill / rim,',
      '  natural vs studio, light direction and softness), skin tone rendering and retouching feel,',
      '  wardrobe fabric and styling details, jewelry and accessories,',
      '  background treatment (blurred / environmental / studio), color grading,',
      '  overall mood and the story the portrait tells.',
      ...detailFooter(),
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
      '- Cover exhaustively: location and scene type, spatial layout, leading lines',
      '  and visual flow, vantage point and lens feel (wide / telephoto compression),',
      '  time of day, weather and sky character, natural vs artificial lighting,',
      '  shadows and glow, color palette and atmospheric perspective,',
      '  textures and materials (stone, foliage, water, glass, metal),',
      '  scale cues (people, vegetation, structures), tiny lively details,',
      '  mood and atmosphere, sense of place.',
      ...detailFooter(),
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
      '- Cover exhaustively: product identity, silhouette and key features,',
      '  hero angle and framing, studio lighting setup (softbox placement, rim light,',
      '  reflections and specular highlights), surface and backdrop (color, texture, gradient),',
      '  props, styling and compositional balance, materials and surface finish',
      '  (matte / glossy / metallic / glass), color palette and accent colors,',
      '  sharpness, depth of field and focus point, micro-details (labels, seams, droplets),',
      '  premium commercial mood.',
      ...detailFooter(),
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
      '- Cover exhaustively: central concept and narrative hook,',
      '  character / creature / environment design cues (silhouette, anatomy, armor,',
      '  costume, architecture, vegetation), dramatic composition and dynamic camera angle,',
      '  cinematic lighting (volumetric light, glow, rim), rich color palette and contrast,',
      '  surface detail density (weathering, ornament, texture work), rendered style',
      '  (e.g. cyberpunk, sci-fi, dark fantasy), scale and epicness cues,',
      '  epic mood and atmosphere.',
      ...detailFooter(),
    ].join('\n'),
    userTextZh: '请仔细观察这张图片，为它生成可用于 AI 绘画的概念艺术提示词。',
    userTextEn: 'Look carefully at this image and generate an AI concept-art prompt for it.',
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
      '- Cover exhaustively: illustration medium and technique (watercolor, gouache,',
      '  ink, colored pencil, digital), linework quality (loose / precise, line weight),',
      '  brushstroke character, paper texture and grain, washes and gradients,',
      '  whimsical or refined composition, soft lighting and gentle shadows,',
      '  harmonious color palette, charming miniature details, character expressions,',
      '  storybook or editorial mood.',
      ...detailFooter(),
    ].join('\n'),
    userTextZh: '请仔细观察这张图片，为它生成可用于 AI 绘画的插画风格提示词。',
    userTextEn: 'Look carefully at this image and generate an AI illustration-style prompt for it.',
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
      '- The "prompt" field holds ONE reusable image-generation prompt covering in depth:',
      '  main subject (appearance, pose, expression, clothing, distinctive features),',
      '  composition (framing, foreground / midground / background, balance),',
      '  camera perspective, lighting (direction, quality, color temperature),',
      '  color palette, materials and textures, art style and medium,',
      '  mood and atmosphere, plus at least five concrete visual details.',
      '- Prefer completeness over brevity in every field.',
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
  const found =
    BUILTIN_TEMPLATES.find((t) => t.id === id) ??
    BUILTIN_TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE_ID);
  if (!found) {
    // 防御性分支：BUILTIN_TEMPLATES 为非空常量，不可达
    throw new Error('[img2prompt] builtin templates missing');
  }
  return found;
}

/** 输出语言名称（拼入 system prompt） */
function outputLanguageName(lang: PromptLanguage): string {
  return lang === 'zh' ? 'Simplified Chinese' : 'English';
}

/** 输出长度提示（拼入 system prompt） */
function lengthHint(lang: PromptLanguage): string {
  return lang === 'zh' ? '150-350 个汉字' : '120-250 English words';
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
