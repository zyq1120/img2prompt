/**
 * 图片压缩工具（DOM 环境：popup / options）。
 * service worker 场景请使用 `src/lib/api.ts` 中的 OffscreenCanvas 版本。
 */

/** 发送给模型的最大图片边长（像素） */
export const MAX_IMAGE_EDGE_PX = 1568;
/** 历史缩略图的最大边长（像素） */
export const THUMBNAIL_EDGE_PX = 160;
/** 压缩为 JPEG 时的质量 */
export const JPEG_QUALITY = 0.85;

/**
 * 把图片文件（拖拽/选择上传）读取并压缩为 JPEG dataURL。
 *
 * @param file 图片 Blob（拖拽文件或 <input type=file> 结果）
 * @param maxEdgePx 长边上限，默认 1568
 * @throws 非图片类型或读取失败时抛出 Error（调用方转为用户可读文案）
 */
export async function fileToCompressedDataUrl(
  file: Blob,
  maxEdgePx: number = MAX_IMAGE_EDGE_PX
): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('not-an-image');
  }
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxEdgePx / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('no-canvas');
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
    );
    if (!blob) {
      throw new Error('encode-failed');
    }
    return await blobToDataUrl(blob);
  } finally {
    bitmap.close();
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('read-failed'));
    reader.readAsDataURL(blob);
  });
}
