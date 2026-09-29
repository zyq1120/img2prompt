/**
 * Background service worker：插件的大脑。
 *
 * 链路：
 * 1. 用户在图片上右键 → 上下文菜单点击 → 下载压缩 → 调模型 → 推送面板 → 存历史
 * 2. 用户在页面上右键"框选截图" → 选区 overlay → captureVisibleTab 裁剪 → 同上链路
 * 3. 面板内的语言切换 / 模板切换 / 重试：复用 tab 缓存图片，不重复下载
 * 4. 面板内的"取消"：中止该 tab 正在进行的模型请求
 *
 * 多服务商：每次生成按设置中的当前服务商解析；面板/popup 可切换。
 */
import {
  VisionApiError,
  cropScreenshot,
  downscaleDataUrl,
  fetchImageAsDataUrl,
  generateImagePrompt,
  makeThumbnail,
} from '../lib/api.js';
import { addHistoryItem, getActiveProvider, getSettings, getTemplate } from '../lib/storage.js';
import type {
  ExtensionMessage,
  HistoryItem,
  PanelStateMessage,
  PromptLanguage,
  PromptTemplate,
} from '../lib/types.js';

/** 右键菜单项 ID：图片识别 */
const CONTEXT_MENU_IMAGE_ID = 'img2prompt-generate';
/** 右键菜单项 ID：框选截图识别 */
const CONTEXT_MENU_REGION_ID = 'img2prompt-region';
/** 快捷键命令 ID：框选截图识别（与右键菜单同一链路） */
const COMMAND_REGION_SELECT_ID = 'region-select';
/** 历史缩略图长边（选区/上传场景） */
const THUMBNAIL_EDGE_PX = 160;

/** 每个 tab 最近一次识别的图片上下文（供语言切换/重试复用，避免重复下载） */
interface TabImageContext {
  imageUrl: string;
  imageDataUrl: string;
  source: HistoryItem['source'];
}

const tabImageCache = new Map<number, TabImageContext>();
/** 每个 tab 正在进行的生成请求的取消控制器 */
const tabAbortControllers = new Map<number, AbortController>();

chrome.runtime.onInstalled.addListener(() => {
  createContextMenus();
});

// 兜底：如果菜单因 service worker 重启丢失，在启动时重建
chrome.runtime.onStartup.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    createContextMenus();
  });
});

function createContextMenus(): void {
  chrome.contextMenus.create({
    contexts: ['image'],
    id: CONTEXT_MENU_IMAGE_ID,
    title: chrome.i18n.getMessage('contextMenuTitle'),
  });
  chrome.contextMenus.create({
    contexts: ['page'],
    id: CONTEXT_MENU_REGION_ID,
    title: chrome.i18n.getMessage('contextMenuRegionTitle'),
  });
}

// tab 关闭时清理缓存与控制器，避免内存泄漏
chrome.tabs.onRemoved.addListener((tabId) => {
  tabImageCache.delete(tabId);
  tabAbortControllers.get(tabId)?.abort();
  tabAbortControllers.delete(tabId);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (tab?.id === undefined) {
    return;
  }
  if (info.menuItemId === CONTEXT_MENU_IMAGE_ID && info.srcUrl) {
    void handleMenuClick(tab.id, info.srcUrl);
  } else if (info.menuItemId === CONTEXT_MENU_REGION_ID) {
    void startRegionSelect(tab.id);
  }
});

// 快捷键（manifest commands）：按下时浏览器会授予当前 tab 的 activeTab
chrome.commands.onCommand.addListener((command) => {
  if (command === COMMAND_REGION_SELECT_ID) {
    void triggerRegionSelectCommand();
  }
});

/**
 * 快捷键触发框选识别：取当前活动 tab，走与右键"框选截图并识别"
 * 完全相同的 startRegionSelect 链路。
 */
async function triggerRegionSelectCommand(): Promise<void> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (tabId === undefined) {
    return;
  }
  await startRegionSelect(tabId);
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender) => {
  const tabId = sender.tab?.id;
  if (tabId === undefined) {
    return;
  }
  if (message.type === 'IMG2PROMPT_GENERATE') {
    // 面板内的语言/模板切换 / 重试：不写历史，只更新面板
    void runGeneration({
      tabId,
      lang: message.lang,
      templateId: message.templateId,
      saveHistory: false,
    });
  } else if (message.type === 'IMG2PROMPT_CANCEL') {
    cancelGeneration(tabId);
  } else if (message.type === 'IMG2PROMPT_REGION_DONE') {
    void handleRegionDone(tabId, message.rect, message.devicePixelRatio);
  } else if (message.type === 'IMG2PROMPT_OPEN_OPTIONS') {
    void chrome.runtime.openOptionsPage();
  }
});

/** 右键菜单点击：注入面板 → 开始识别主流程 */
async function handleMenuClick(tabId: number, imageUrl: string): Promise<void> {
  const injected = await ensureContentScript(tabId);
  if (!injected) {
    return;
  }
  await sendToTab(tabId, { type: 'IMG2PROMPT_START', imageUrl });
  await runGeneration({ tabId, imageUrl, source: 'context-menu', saveHistory: true });
}

/** 框选截图：注入 content script 并让它展示选区 overlay */
async function startRegionSelect(tabId: number): Promise<void> {
  const injected = await ensureContentScript(tabId);
  if (!injected) {
    return;
  }
  await sendToTab(tabId, { type: 'IMG2PROMPT_REGION_SELECT' });
}

/** 选区完成：截取可见区域 → 走截图处理链路 */
async function handleRegionDone(
  tabId: number,
  rect: { x: number; y: number; width: number; height: number },
  devicePixelRatio: number
): Promise<void> {
  try {
    if (rect.width < 4 || rect.height < 4) {
      throw new VisionApiError('选区太小，请重新框选');
    }
    // 需要 activeTab（用户点击右键菜单时授予）或 <all_urls> 权限
    const screenshotDataUrl = await chrome.tabs.captureVisibleTab({
      format: 'png',
    });
    await handleRegionShot(tabId, rect, devicePixelRatio, screenshotDataUrl);
  } catch (error) {
    const message = error instanceof VisionApiError ? error.message : '截图失败，请重试';
    await sendToTab(tabId, {
      type: 'IMG2PROMPT_PANEL_STATE',
      state: 'error',
      error: message,
    });
  }
}

/**
 * 选区截图已拿到：裁剪 → 走标准生成链路。
 * 与 handleRegionDone 分离，便于 E2E 在 headless 下经 CDP 截图注入验证
 * （headless 无法产生授予 activeTab 的真实菜单点击）。
 */
async function handleRegionShot(
  tabId: number,
  rect: { x: number; y: number; width: number; height: number },
  devicePixelRatio: number,
  screenshotDataUrl: string
): Promise<void> {
  const imageDataUrl = await cropScreenshot(screenshotDataUrl, rect, devicePixelRatio);
  await sendToTab(tabId, { type: 'IMG2PROMPT_START', imageUrl: '' });
  await runGeneration({
    tabId,
    imageDataUrl,
    source: 'region',
    saveHistory: true,
  });
}

/** 取消指定 tab 正在进行的生成请求 */
function cancelGeneration(tabId: number): void {
  tabAbortControllers.get(tabId)?.abort();
}

interface RunGenerationOptions {
  tabId: number;
  /** 新图片的 URL（菜单点击时传入；面板重试/切语言时省略，用缓存） */
  imageUrl?: string;
  /** 直接传入已压缩的图片 dataURL（选区截图场景） */
  imageDataUrl?: string;
  /** 图片来源，用于历史记录 */
  source?: HistoryItem['source'];
  /** 期望语言（省略时用设置中的默认语言） */
  lang?: PromptLanguage;
  /** 使用的模板 ID（省略时用设置中的当前模板） */
  templateId?: string | undefined;
  /** 是否写入历史记录（仅首次识别写，切换语言/重试不写） */
  saveHistory: boolean;
}

/** 核心流程：取图 → 调模型 → 推送结果 →（可选）存历史 */
async function runGeneration(options: RunGenerationOptions): Promise<void> {
  const { tabId, saveHistory } = options;
  const settings = await getSettings();
  const provider = getActiveProvider(settings);
  const template: PromptTemplate = await getTemplate(
    options.templateId ?? settings.activeTemplateId
  );
  const targetLang = options.lang ?? settings.defaultLang;

  // 同一 tab 同一时间只允许一个生成请求：先取消旧的
  tabAbortControllers.get(tabId)?.abort();
  const abortController = new AbortController();
  tabAbortControllers.set(tabId, abortController);

  try {
    let imageUrl = options.imageUrl ?? '';
    let imageDataUrl = options.imageDataUrl;
    let source: HistoryItem['source'] = options.source ?? 'context-menu';

    if (!imageDataUrl) {
      const cached = tabImageCache.get(tabId);
      if (cached) {
        imageUrl = cached.imageUrl;
        imageDataUrl = cached.imageDataUrl;
        source = cached.source;
      }
    }

    await sendToTab(tabId, {
      type: 'IMG2PROMPT_PANEL_STATE',
      state: 'loading',
      lang: targetLang,
    });

    if (!imageDataUrl && imageUrl) {
      imageDataUrl = await fetchImageAsDataUrl(imageUrl);
      tabImageCache.set(tabId, { imageUrl, imageDataUrl, source });
    } else if (imageDataUrl) {
      tabImageCache.set(tabId, { imageUrl, imageDataUrl, source });
    }
    if (!imageDataUrl) {
      throw new VisionApiError('缺少图片信息，请重新在图片上右键再试');
    }

    const result = await generateImagePrompt({
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      model: provider.model,
      imageDataUrl,
      lang: targetLang,
      template,
      signal: abortController.signal,
    });

    const resultMessage: PanelStateMessage = {
      type: 'IMG2PROMPT_PANEL_STATE',
      state: 'result',
      text: result.text,
      lang: targetLang,
    };
    if (result.format === 'json') {
      resultMessage.structured = result.structured;
    }
    await sendToTab(tabId, resultMessage);

    if (saveHistory) {
      // 缩略图失败不影响主流程，单独捕获
      try {
        const thumbnail = imageUrl
          ? await makeThumbnail(imageUrl)
          : await downscaleDataUrl(imageDataUrl, THUMBNAIL_EDGE_PX);
        const historyEntry: Parameters<typeof addHistoryItem>[0] = {
          imageUrl,
          source,
          thumbnail,
          prompt: result.text,
          lang: targetLang,
          model: provider.model,
          providerName: provider.name,
          templateId: template.id,
        };
        if (result.format === 'json') {
          historyEntry.structured = result.structured;
        }
        await addHistoryItem(historyEntry);
      } catch (historyError) {
        console.warn('[img2prompt] 历史记录保存失败', historyError);
      }
    }
  } catch (error) {
    if (abortController.signal.aborted && error instanceof VisionApiError) {
      // 用户主动取消：通知面板恢复之前状态，而非展示红色错误
      tabAbortControllers.delete(tabId);
      await sendToTab(tabId, { type: 'IMG2PROMPT_CANCELLED' });
      return;
    }
    const message = error instanceof VisionApiError ? error.message : '未知错误，请重试';
    await sendToTab(tabId, {
      type: 'IMG2PROMPT_PANEL_STATE',
      state: 'error',
      error: message,
      lang: targetLang,
    });
  } finally {
    if (tabAbortControllers.get(tabId) === abortController) {
      tabAbortControllers.delete(tabId);
    }
  }
}

/** 注入 content script（失败时返回 false，如 chrome:// 等受限页面） */
async function ensureContentScript(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content-script.js'],
    });
    return true;
  } catch (error) {
    // chrome://、edge://、Chrome Web Store 等受限页面无法注入
    console.warn('[img2prompt] content script 注入失败，可能是受限页面', error);
    return false;
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

/**
 * E2E 验证钩子：自动化测试通过它触发与右键菜单点击完全相同的链路
 * （handleMenuClick → 注入面板 → 下载压缩 → 调模型 → 推送状态）。
 * 生产环境中右键菜单是唯一调用方；该钩子不改变任何生产行为。
 */
(globalThis as unknown as { __img2promptE2E?: unknown }).__img2promptE2E = {
  handleMenuClick: (tabId: number, imageUrl: string) => handleMenuClick(tabId, imageUrl),
  handleRegionDone: (
    tabId: number,
    rect: { x: number; y: number; width: number; height: number },
    devicePixelRatio: number
  ) => handleRegionDone(tabId, rect, devicePixelRatio),
  /** E2E 专用：跳过 captureVisibleTab（headless 无手势），直接走裁剪→生成链路 */
  handleRegionShot: (
    tabId: number,
    rect: { x: number; y: number; width: number; height: number },
    devicePixelRatio: number,
    screenshotDataUrl: string
  ) => handleRegionShot(tabId, rect, devicePixelRatio, screenshotDataUrl),
  cancelGeneration: (tabId: number) => cancelGeneration(tabId),
  /** E2E 专用：触发与快捷键完全相同的处理函数（headless 无法合成系统级按键） */
  triggerRegionSelectCommand: () => triggerRegionSelectCommand(),
};

export {};
