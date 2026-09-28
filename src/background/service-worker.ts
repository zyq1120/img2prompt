/**
 * Background service worker：插件的大脑。
 *
 * 链路：
 * 1. 用户在图片上右键 → 上下文菜单点击
 * 2. 向当前 tab 注入 content script，打开悬浮面板（loading）
 * 3. 下载图片并压缩为 dataURL（绕过页面 CORS）
 * 4. 调用用户配置的视觉模型生成提示词
 * 5. 把结果推送到面板，并写入本地历史记录
 *
 * 面板内的「语言切换 / 重试」会复用该 tab 缓存的图片，不重复下载。
 */
import {
  VisionApiError,
  fetchImageAsDataUrl,
  generateImagePrompt,
  makeThumbnail,
} from '../lib/api.js';
import { addHistoryItem, getSettings } from '../lib/storage.js';
import type { ExtensionMessage, PromptLanguage } from '../lib/types.js';

/** 右键菜单项 ID */
const CONTEXT_MENU_ID = 'img2prompt-generate';

/** 每个 tab 最近一次识别的图片上下文（供语言切换/重试复用，避免重复下载） */
interface TabImageContext {
  imageUrl: string;
  imageDataUrl: string;
}

const tabImageCache = new Map<number, TabImageContext>();

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

// tab 关闭时清理图片缓存，避免内存泄漏
chrome.tabs.onRemoved.addListener((tabId) => {
  tabImageCache.delete(tabId);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || tab?.id === undefined || !info.srcUrl) {
    return;
  }
  void handleMenuClick(tab.id, info.srcUrl);
});

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender) => {
  const tabId = sender.tab?.id;
  if (tabId === undefined) {
    return;
  }
  if (message.type === 'IMG2PROMPT_GENERATE') {
    // 面板内的语言切换 / 重试：不写历史，只更新面板
    void runGeneration({ tabId, lang: message.lang, saveHistory: false });
  } else if (message.type === 'IMG2PROMPT_OPEN_OPTIONS') {
    void chrome.runtime.openOptionsPage();
  }
});

/** 右键菜单点击：注入面板 → 开始识别主流程 */
async function handleMenuClick(tabId: number, imageUrl: string): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content-script.js'],
    });
  } catch (error) {
    // chrome://、edge://、Chrome Web Store 等受限页面无法注入
    console.warn('[img2prompt] content script 注入失败，可能是受限页面', error);
    return;
  }
  await sendToTab(tabId, { type: 'IMG2PROMPT_START', imageUrl });
  await runGeneration({ tabId, imageUrl, saveHistory: true });
}

interface RunGenerationOptions {
  tabId: number;
  /** 新图片的 URL（菜单点击时传入；面板重试/切语言时省略，用缓存） */
  imageUrl?: string;
  /** 期望语言（省略时用设置中的默认语言） */
  lang?: PromptLanguage;
  /** 是否写入历史记录（仅首次识别写，切换语言/重试不写） */
  saveHistory: boolean;
}

/** 核心流程：取图 → 调模型 → 推送结果 →（可选）存历史 */
async function runGeneration(options: RunGenerationOptions): Promise<void> {
  const { tabId, saveHistory } = options;
  const settings = await getSettings();
  const targetLang = options.lang ?? settings.defaultLang;

  try {
    let imageUrl = options.imageUrl;
    let imageDataUrl: string | undefined;

    if (!imageUrl) {
      const cached = tabImageCache.get(tabId);
      if (cached) {
        imageUrl = cached.imageUrl;
        imageDataUrl = cached.imageDataUrl;
      }
    }
    if (!imageUrl) {
      throw new VisionApiError('缺少图片信息，请重新在图片上右键再试');
    }

    await sendToTab(tabId, {
      type: 'IMG2PROMPT_PANEL_STATE',
      state: 'loading',
      lang: targetLang,
    });

    if (!imageDataUrl) {
      imageDataUrl = await fetchImageAsDataUrl(imageUrl);
      tabImageCache.set(tabId, { imageUrl, imageDataUrl });
    }

    const prompt = await generateImagePrompt({
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl,
      model: settings.model,
      imageDataUrl,
      lang: targetLang,
    });

    await sendToTab(tabId, {
      type: 'IMG2PROMPT_PANEL_STATE',
      state: 'result',
      text: prompt,
      lang: targetLang,
    });

    if (saveHistory) {
      // 缩略图失败不影响主流程，单独捕获
      try {
        const thumbnail = await makeThumbnail(imageUrl);
        await addHistoryItem({
          imageUrl,
          thumbnail,
          prompt,
          lang: targetLang,
          model: settings.model,
        });
      } catch (historyError) {
        console.warn('[img2prompt] 历史记录保存失败', historyError);
      }
    }
  } catch (error) {
    const message = error instanceof VisionApiError ? error.message : '未知错误，请重试';
    await sendToTab(tabId, {
      type: 'IMG2PROMPT_PANEL_STATE',
      state: 'error',
      error: message,
      lang: targetLang,
    });
  }
}

/** 向指定 tab 的 content script 发消息（tab 已关闭等情况静默忽略） */
async function sendToTab(tabId: number, message: ExtensionMessage): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    console.warn('[img2prompt] 向 tab 发送消息失败', error);
  }
}

export {};
