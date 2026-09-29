import { describe, expect, it } from 'vitest';
import {
  BUILTIN_TEMPLATES,
  DEFAULT_TEMPLATE_ID,
  buildSystemPrompt,
  buildTemplateSystemPrompt,
  buildTemplateUserText,
  buildUserText,
  getBuiltinTemplate,
} from '../src/lib/prompt-templates.js';

describe('buildSystemPrompt', () => {
  it('中文模板要求简体中文输出', () => {
    const prompt = buildSystemPrompt('zh');
    expect(prompt).toContain('Simplified Chinese');
    expect(prompt).not.toContain('```');
  });

  it('英文模板要求英文输出', () => {
    const prompt = buildSystemPrompt('en');
    expect(prompt).toContain('English');
    expect(prompt).not.toContain('Simplified Chinese');
  });

  it('覆盖主体/构图/光线/色彩/风格等维度', () => {
    const prompt = buildSystemPrompt('en').toLowerCase();
    for (const keyword of ['subject', 'composition', 'lighting', 'color', 'style', 'mood']) {
      expect(prompt).toContain(keyword);
    }
  });

  it('约束只输出提示词正文', () => {
    const prompt = buildSystemPrompt('zh');
    expect(prompt).toContain('Output ONLY the prompt text');
  });
});

describe('buildUserText', () => {
  it('中英返回不同的动作指令', () => {
    const zh = buildUserText('zh');
    const en = buildUserText('en');
    expect(zh.length).toBeGreaterThan(0);
    expect(en.length).toBeGreaterThan(0);
    expect(zh).not.toBe(en);
  });
});

describe('BUILTIN_TEMPLATES', () => {
  it('共 7 套内置模板，id 唯一且均为 builtin', () => {
    expect(BUILTIN_TEMPLATES).toHaveLength(7);
    const ids = BUILTIN_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(BUILTIN_TEMPLATES.every((t) => t.builtin)).toBe(true);
  });

  it('包含一个 JSON 输出模板', () => {
    const jsonTemplates = BUILTIN_TEMPLATES.filter((t) => t.outputFormat === 'json');
    expect(jsonTemplates).toHaveLength(1);
    expect(jsonTemplates[0]!.systemPrompt).toContain('"prompt"');
  });

  it('占位符被正确替换且无残留', () => {
    for (const template of BUILTIN_TEMPLATES) {
      const zh = buildTemplateSystemPrompt(template, 'zh');
      const en = buildTemplateSystemPrompt(template, 'en');
      expect(zh).toContain('Simplified Chinese');
      expect(en).not.toContain('Simplified Chinese');
      expect(zh).not.toContain('{outputLanguage}');
      expect(zh).not.toContain('{lengthHint}');
      expect(en).not.toContain('{outputLanguage}');
    }
  });

  it('v0.3.0：所有文本模板要求穷尽式细节（拒绝泛泛而谈）', () => {
    for (const template of BUILTIN_TEMPLATES) {
      if (template.outputFormat !== 'text') {
        continue;
      }
      const zh = buildTemplateSystemPrompt(template, 'zh');
      expect(zh).toContain('five concrete visual details');
      expect(zh).toContain('Prefer completeness over brevity');
      expect(zh).toContain('Output ONLY the prompt text, nothing else.');
    }
  });

  it('v0.3.0：长度提示已加长（中文 150-350 字）', () => {
    const zh = buildTemplateSystemPrompt(getBuiltinTemplate(DEFAULT_TEMPLATE_ID), 'zh');
    const en = buildTemplateSystemPrompt(getBuiltinTemplate(DEFAULT_TEMPLATE_ID), 'en');
    expect(zh).toContain('150-350 个汉字');
    expect(en).toContain('120-250 English words');
  });

  it('v0.3.0：JSON 模板的 prompt 字段同样要求详细', () => {
    const json = BUILTIN_TEMPLATES.find((t) => t.outputFormat === 'json');
    const zh = buildTemplateSystemPrompt(json!, 'zh');
    expect(zh).toContain('five concrete visual details');
    expect(zh).toContain('Prefer completeness over brevity');
  });

  it('中英 user 文本不同且非空', () => {
    for (const template of BUILTIN_TEMPLATES) {
      const zh = buildTemplateUserText(template, 'zh');
      const en = buildTemplateUserText(template, 'en');
      expect(zh.length).toBeGreaterThan(0);
      expect(en.length).toBeGreaterThan(0);
      expect(zh).not.toBe(en);
    }
  });
});

describe('getBuiltinTemplate', () => {
  it('按 id 取到模板', () => {
    expect(getBuiltinTemplate(DEFAULT_TEMPLATE_ID).id).toBe(DEFAULT_TEMPLATE_ID);
  });

  it('未知 id 回退默认模板', () => {
    expect(getBuiltinTemplate('nope').id).toBe(DEFAULT_TEMPLATE_ID);
  });
});
