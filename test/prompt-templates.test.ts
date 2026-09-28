import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, buildUserText } from '../src/lib/prompt-templates.js';

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
