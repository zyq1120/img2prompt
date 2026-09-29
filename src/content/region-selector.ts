/**
 * 选区截图 overlay：在页面上展示全屏遮罩，用户拖拽框选识别区域。
 *
 * 纯 DOM 实现（浅色 DOM + 内联样式，保证在任何页面上层级最高且样式自包含）。
 * Esc 或过小的选区视为取消。
 */

export interface RegionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RegionSelectCallbacks {
  onDone: (rect: RegionRect, devicePixelRatio: number) => void;
  onCancel: () => void;
}

/** overlay 根元素 ID（页面内唯一） */
const OVERLAY_ID = 'img2prompt-region-overlay';
/** 小于该尺寸（CSS 像素）的选区视为误触，直接取消 */
const MIN_SELECT_SIZE_PX = 4;

/**
 * 启动选区，返回清理函数。
 * 同一时间只允许一个选区实例：重复调用会先清理旧实例。
 */
export function startRegionSelect(callbacks: RegionSelectCallbacks): () => void {
  removeOverlay();

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.setAttribute(
    'style',
    [
      'position: fixed',
      'inset: 0',
      'z-index: 2147483646',
      'cursor: crosshair',
      'background: rgba(0, 0, 0, 0.35)',
      'user-select: none',
      '-webkit-user-select: none',
      // Pointer Events 统一处理鼠标/触屏/触控笔；none 禁止触屏拖动时页面滚动
      'touch-action: none',
    ].join(';')
  );

  const hint = document.createElement('div');
  hint.setAttribute(
    'style',
    [
      'position: fixed',
      'top: 16px',
      'left: 50%',
      'transform: translateX(-50%)',
      'background: rgba(28, 28, 30, 0.85)',
      'color: #fff',
      'font-size: 13px',
      'font-family: -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
      'padding: 8px 16px',
      'border-radius: 20px',
      'pointer-events: none',
      'white-space: nowrap',
      'z-index: 1',
    ].join(';')
  );
  hint.textContent = chrome.i18n.getMessage('regionHint');

  const box = document.createElement('div');
  box.setAttribute(
    'style',
    [
      'position: fixed',
      'display: none',
      'border: 2px solid #007aff',
      'background: rgba(0, 122, 255, 0.12)',
      'box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.35)',
      'pointer-events: none',
      'z-index: 2',
    ].join(';')
  );

  overlay.append(hint, box);
  document.documentElement.appendChild(overlay);

  let startX = 0;
  let startY = 0;
  let selecting = false;
  /** 正在跟踪的 pointerId（多指触控时只跟第一指） */
  let activePointerId: number | null = null;

  const updateBox = (clientX: number, clientY: number): void => {
    const x = Math.min(startX, clientX);
    const y = Math.min(startY, clientY);
    const width = Math.abs(clientX - startX);
    const height = Math.abs(clientY - startY);
    box.style.display = 'block';
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;
  };

  const finishSelect = (clientX: number, clientY: number): void => {
    selecting = false;
    activePointerId = null;
    const x = Math.min(startX, clientX);
    const y = Math.min(startY, clientY);
    const width = Math.abs(clientX - startX);
    const height = Math.abs(clientY - startY);
    removeOverlay();
    if (width < MIN_SELECT_SIZE_PX || height < MIN_SELECT_SIZE_PX) {
      callbacks.onCancel();
      return;
    }
    callbacks.onDone({ x, y, width, height }, window.devicePixelRatio || 1);
  };

  // Pointer Events 统一处理鼠标/触屏/触控笔；setPointerCapture 保证
  // 手指/鼠标拖出窗口再松开也能收到 pointerup，overlay 不会卡死
  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !event.isPrimary) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    selecting = true;
    activePointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    try {
      overlay.setPointerCapture(event.pointerId);
    } catch {
      // 个别环境不支持 pointer capture，降级为 window 监听兜底
    }
    updateBox(event.clientX, event.clientY);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (selecting && event.pointerId === activePointerId) {
      updateBox(event.clientX, event.clientY);
    }
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!selecting || event.pointerId !== activePointerId) {
      return;
    }
    finishSelect(event.clientX, event.clientY);
  };

  const onPointerCancel = (event: PointerEvent): void => {
    if (!selecting || event.pointerId !== activePointerId) {
      return;
    }
    selecting = false;
    activePointerId = null;
    removeOverlay();
    callbacks.onCancel();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      // 拦住页面自身的 Esc 监听（如关闭弹窗、退出全屏）
      event.stopPropagation();
      selecting = false;
      activePointerId = null;
      removeOverlay();
      callbacks.onCancel();
    }
  };

  // 阻止选区期间页面自身的点击行为
  const stopClick = (event: Event): void => event.stopPropagation();

  overlay.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('pointercancel', onPointerCancel, true);
  window.addEventListener('keydown', onKeyDown, true);
  overlay.addEventListener('click', stopClick, true);
  overlay.addEventListener('dblclick', stopClick, true);

  activeCleanup = () => {
    overlay.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('pointercancel', onPointerCancel, true);
    window.removeEventListener('keydown', onKeyDown, true);
    overlay.remove();
  };

  return activeCleanup;
}

/** 当前选区实例的清理函数（移除 DOM + 解绑 window 监听，避免泄漏） */
let activeCleanup: (() => void) | null = null;

/** 移除选区 overlay（若存在） */
function removeOverlay(): void {
  activeCleanup?.();
  activeCleanup = null;
  // 兜底：直接移除残留 DOM
  document.getElementById(OVERLAY_ID)?.remove();
}
