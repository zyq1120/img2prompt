/**
 * Background service worker.
 *
 * 职责：插件安装时注册图片右键菜单；接收菜单点击后调度后续链路
 * （注入悬浮面板 → 下载图片 → 调用视觉模型 → 回传结果）。
 * 完整链路在后续 commit 中接入。
 */

/** 右键菜单项 ID */
const CONTEXT_MENU_ID = 'img2prompt-generate';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    contexts: ['image'],
    id: CONTEXT_MENU_ID,
    title: chrome.i18n.getMessage('contextMenuTitle'),
  });
});

// 兜底：如果菜单因 service worker 重启丢失，在启动时重建
chrome.runtime.onStartup.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      contexts: ['image'],
      id: CONTEXT_MENU_ID,
      title: chrome.i18n.getMessage('contextMenuTitle'),
    });
  });
});

export {};
