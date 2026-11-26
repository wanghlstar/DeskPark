/**
 * 平台适配层：所有与运行环境相关的能力（存储、服务器地址、震动等）集中在这里，
 * 移植到 App（Capacitor / React Native）时只需替换本文件的实现。
 */

export const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* 隐私模式或配额已满时忽略 */
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

/** 统一保存服务 origin；本项目的 WebSocket 固定挂载在 /ws。 */
export function normalizeServerAddress(input: string): string {
  const value = input.trim();
  if (!value) return '';
  try {
    const url = new URL(value.includes('://') ? value : `http://${value}`);
    if (
      !['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !['/', '/ws', '/ws/'].includes(url.pathname)
    )
      throw new Error();
    url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'https:' : 'http:';
    return url.origin;
  } catch {
    throw new Error('请填写服务器的 HTTP / HTTPS 地址和端口，不含账号、查询参数或子路径');
  }
}

export function getServerAddress(): string {
  const saved = storage.get<unknown>('park.server', '');
  try {
    return typeof saved === 'string' ? normalizeServerAddress(saved) : '';
  } catch {
    return '';
  }
}

export function setServerAddress(input: string): void {
  const value = normalizeServerAddress(input);
  if (value) storage.set('park.server', value);
  else storage.remove('park.server');
  if (getServerAddress() !== value) throw new Error('无法保存服务器地址，请检查本机存储权限');
}

/** 运行时地址优先，其次构建参数，最后与页面同源；显式传空串可测试构建默认值。 */
export function serverUrl(address = getServerAddress()): string {
  if (address) {
    const url = new URL(normalizeServerAddress(address));
    return `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}/ws`;
  }
  const fromEnv = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (fromEnv) return fromEnv;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

/** 与联机服务器同源的 HTTP 接口地址。 */
export function serverHttpUrl(): string {
  const url = new URL(serverUrl(), location.href);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  return url.origin;
}

interface OrientationBridge {
  isPluginAvailable?: (name: string) => boolean;
  nativePromise?: (plugin: string, method: string, options: unknown) => Promise<unknown>;
}

function orientationBridge(): OrientationBridge | null {
  const cap = (globalThis as { Capacitor?: OrientationBridge }).Capacitor;
  return cap?.nativePromise && cap.isPluginAvailable?.('ScreenOrientation') ? cap : null;
}

export function supportsTableLandscape(): boolean {
  return orientationBridge() !== null;
}

/** 原生方向控制不要求网页全屏；解锁后恢复系统方向，而非强制竖屏。 */
export async function setTableLandscape(landscape: boolean): Promise<void> {
  const cap = orientationBridge();
  if (!cap) return;
  await cap.nativePromise!(
    'ScreenOrientation',
    landscape ? 'lock' : 'unlock',
    landscape ? { orientation: 'landscape' } : {},
  );
}

export function vibrate(ms = 12): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* ignore */
  }
}

/**
 * 复制文字到剪贴板。
 * navigator.clipboard 只在安全页面（HTTPS / localhost）里存在；用 http 打开（例如局域网 IP、
 * 没配证书的服务器）时它是 undefined，这时退回到隐藏文本框 + execCommand('copy')。
 * 必须在点击事件里同步调用（不要先 await 别的东西），否则浏览器会拒绝复制。
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* 权限被拒等：再试旧办法 */
    }
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  const active = document.activeElement as HTMLElement | null;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  // 放在可视区外；16px 字号避免 iOS 聚焦时放大页面
  ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;font-size:16px;';
  document.body.appendChild(ta);
  let ok = false;
  try {
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, text.length);
    ok = document.execCommand('copy');
  } catch {
    /* 极少数浏览器会抛错：当作复制失败 */
  }
  ta.remove();
  active?.focus?.({ preventScroll: true });
  return ok;
}

export function randomToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
