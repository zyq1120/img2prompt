/** 通用文本工具 */

/** 超长文本截断并追加省略号 */
export function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}
