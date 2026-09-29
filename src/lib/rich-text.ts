/**
 * 文本渲染小工具：HTML 转义 + 模型输出轻排版。
 * 纯函数，可单测。
 */

/** 转义 HTML，防止模型返回内容破坏面板结构 */
export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 文本结果轻排版：先转义 HTML，再把模型常带的 **加粗** 标记渲染为 <strong>。
 * （模板要求 No markdown，但实测模型仍会加，只处理加粗，不做完整 markdown 解析。）
 */
export function renderRichText(raw: string): string {
  return escapeHtml(raw).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}
