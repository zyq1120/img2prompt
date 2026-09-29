import { describe, expect, it } from 'vitest';
import { renderRichText } from '../src/lib/rich-text.js';

describe('renderRichText', () => {
  it('把 **加粗** 渲染为 <strong>', () => {
    expect(renderRichText('主体：**一只橘猫**，光线柔和')).toBe(
      '主体：<strong>一只橘猫</strong>，光线柔和'
    );
  });

  it('先转义 HTML 再处理加粗，防止注入', () => {
    expect(renderRichText('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
    expect(renderRichText('**<b>x</b>**')).toBe('<strong>&lt;b&gt;x&lt;/b&gt;</strong>');
  });

  it('没有加粗标记时只做转义', () => {
    expect(renderRichText('a,b,c')).toBe('a,b,c');
  });

  it('不成对的 ** 原样保留', () => {
    expect(renderRichText('a ** b')).toBe('a ** b');
  });
});
