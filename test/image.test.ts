/**
 * image.ts 上传大小上限：只测前置守卫（不触达 DOM / createImageBitmap，
 * node 环境下用最小的 Blob 替身即可）。
 */
import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, fileToCompressedDataUrl } from '../src/lib/image.js';

describe('fileToCompressedDataUrl 大小上限', () => {
  it('超过 20MB 的文件直接拒绝，不解码', async () => {
    const oversized = { type: 'image/png', size: MAX_UPLOAD_BYTES + 1 } as Blob;
    await expect(fileToCompressedDataUrl(oversized)).rejects.toThrow('file-too-large');
  });

  it('恰好等于上限的文件通过大小检查（继续走解码流程）', async () => {
    // node 环境无 createImageBitmap：能走到解码步骤即证明大小检查已通过
    const atLimit = { type: 'image/png', size: MAX_UPLOAD_BYTES } as Blob;
    await expect(fileToCompressedDataUrl(atLimit)).rejects.toThrow(/createImageBitmap/);
  });

  it('非图片类型先于大小检查报错', async () => {
    const notImage = { type: 'text/plain', size: MAX_UPLOAD_BYTES + 1 } as Blob;
    await expect(fileToCompressedDataUrl(notImage)).rejects.toThrow('not-an-image');
  });
});
