import { useSyncExternalStore } from 'react';
import { serverHttpUrl } from '../platform';
import { createStore } from '../store';

/**
 * 自定义配置保存在本机浏览器；服务器默认模型只读取公开信息，Key 由服务器携带。
 */
export type AiProtocol = 'anthropic' | 'openai';
export type AiSource = 'server' | 'custom';

export interface AiSettings {
  /** 旧版没有此字段：已有自定义配置继续沿用，新设备优先使用可用的服务器默认模型。 */
  source?: AiSource;
  protocol: AiProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 发言频率：0 不说话 · 1 偶尔 · 2 适中 · 3 话痨 */
  chat: 0 | 1 | 2 | 3;
  /** 将 AI 的文字发言交给系统语音朗读，音色与报牌共用。 */
  readAloud: boolean;
  /** 经本站服务器转发（解决跨域） */
  proxy: boolean;
}

export const aiSettings = createStore<AiSettings>('park.ai', {
  protocol: 'anthropic',
  baseUrl: '',
  apiKey: '',
  model: '',
  chat: 1,
  readAloud: true,
  proxy: false,
});

export const AI_DEFAULTS: Record<AiProtocol, { baseUrl: string; model: string }> = {
  anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: '' },
};

interface ServerAi {
  configured: boolean;
  protocol: AiProtocol;
  model: string;
}

const unavailable: ServerAi = { configured: false, protocol: 'openai', model: '' };
let serverConfig: ServerAi = unavailable;
const listeners = new Set<() => void>();

/** 只保存在内存中，刷新或打开设置时重新读取。 */
export const serverAi = {
  get: () => serverConfig,
  set(value: ServerAi) {
    serverConfig = value;
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  use(): ServerAi {
    return useSyncExternalStore(this.subscribe, this.get, this.get);
  },
};

export async function loadServerAi(): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5_000);
  try {
    const res = await fetch(`${serverHttpUrl()}/api/ai-proxy/default`, {
      cache: 'no-store',
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error('无法读取服务器默认模型');
    const data = (await res.json()) as Partial<ServerAi>;
    serverAi.set(
      data.configured === true &&
        (data.protocol === 'openai' || data.protocol === 'anthropic') &&
        typeof data.model === 'string' &&
        data.model.trim()
        ? { configured: true, protocol: data.protocol, model: data.model.trim() }
        : unavailable,
    );
  } catch {
    serverAi.set(unavailable);
  } finally {
    clearTimeout(timer);
  }
}

/** 填了默认值之后的实际配置 */
export function effectiveAi(s: AiSettings = aiSettings.get()) {
  const server = serverAi.get();
  const source: AiSource =
    s.source ??
    (s.apiKey.trim() || s.model.trim() || s.baseUrl.trim() || !server.configured
      ? 'custom'
      : 'server');
  if (source === 'server') {
    return {
      ...s,
      source,
      protocol: server.protocol,
      baseUrl: '',
      apiKey: '',
      model: server.model,
      proxy: true,
    };
  }
  const d = AI_DEFAULTS[s.protocol];
  return {
    ...s,
    source,
    baseUrl: (s.baseUrl.trim() || d.baseUrl).replace(/\/+$/, ''),
    model: s.model.trim() || d.model,
  };
}

export function aiReady(s: AiSettings = aiSettings.get()): boolean {
  const e = effectiveAi(s);
  if (e.source === 'server') return serverAi.get().configured;
  return !!e.apiKey.trim() && !!e.model;
}

/** 每次决策时顺便发言的概率 */
export const CHAT_RATE = [0, 0.2, 0.55, 1] as const;
