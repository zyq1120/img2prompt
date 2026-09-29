/**
 * chrome.i18n 的轻量封装。
 * 插件 UI 字符串全部走 _locales，默认语言 zh_CN。
 */

/**
 * 取本地化文案。
 *
 * @param messageName _locales/messages.json 中的 key
 * @param substitutions 占位符替换值
 */
export function t(messageName: string, substitutions?: string | string[]): string {
  return chrome.i18n.getMessage(messageName, substitutions);
}

/**
 * 扫描容器内所有带 data-i18n 系列属性的元素并填充文案：
 * - `data-i18n="key"` → textContent
 * - `data-i18n-ph="key"` → placeholder
 * - `data-i18n-title="key"` → title
 * - `data-i18n-aria-label="key"` → aria-label（无障碍名称，优先级高于 title）
 */
export function applyI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) {
      el.textContent = t(key);
    }
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-ph]').forEach((el) => {
    const key = el.getAttribute('data-i18n-ph');
    if (key) {
      el.setAttribute('placeholder', t(key));
    }
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (key) {
      el.setAttribute('title', t(key));
    }
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]').forEach((el) => {
    const key = el.getAttribute('data-i18n-aria-label');
    if (key) {
      el.setAttribute('aria-label', t(key));
    }
  });
}
