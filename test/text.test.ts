import { describe, expect, it } from 'vitest';
import { truncate } from '../src/lib/text.js';

describe('truncate', () => {
  it('短文本原样返回', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('超长文本截断并追加省略号', () => {
    expect(truncate('hello world', 5)).toBe('hello…');
  });

  it('恰好等于上限时不截断', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('空字符串', () => {
    expect(truncate('', 5)).toBe('');
  });
});
