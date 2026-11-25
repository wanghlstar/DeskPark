import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as platform from '../src/lib/platform';
import { startServer } from '../../server/src/server';
import { testServerConnection } from '../src/lib/serverConnection';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal('location', new URL('https://localhost/'));
  vi.stubGlobal('window', { addEventListener: vi.fn() });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('运行时服务器地址', () => {
  it.each([
    ['192.168.2.8:8787', 'http://192.168.2.8:8787'],
    [' http://192.168.2.8:18878/ ', 'http://192.168.2.8:18878'],
    ['https://Games.Example.com/', 'https://games.example.com'],
    ['ws://192.168.2.8:8787/ws', 'http://192.168.2.8:8787'],
    ['wss://games.example.com/ws', 'https://games.example.com'],
    ['http://[::1]:8787', 'http://[::1]:8787'],
    ['', ''],
  ])('规范化 %s', (input, expected) => {
    expect(platform.normalizeServerAddress, '需要可校验的运行时服务器设置').toBeTypeOf('function');
    expect(platform.normalizeServerAddress(input)).toBe(expected);
  });

  it.each([
    'file:///etc/passwd',
    'ftp://example.com',
    'https://user:pass@example.com',
    'http://example.com:99999',
    'http://example.com/v1',
    'http://example.com/?key=secret',
    'https://example.com/#/room/ABCD',
    'not an address',
  ])('拒绝无效地址且保留已有配置：%s', (input) => {
    expect(platform.setServerAddress).toBeTypeOf('function');
    platform.setServerAddress('http://192.168.2.8:8787');
    expect(() => platform.setServerAddress(input)).toThrow();
    expect(platform.getServerAddress()).toBe('http://192.168.2.8:8787');
  });

  it('保存后覆盖构建参数，刷新后联机、AI 和邀请仍使用同一服务', async () => {
    expect(platform.setServerAddress).toBeTypeOf('function');
    vi.stubEnv('VITE_SERVER_URL', 'wss://old.example/ws');
    vi.stubEnv('VITE_PUBLIC_URL', 'https://old.example/');
    platform.setServerAddress('http://192.168.2.8:18878');
    vi.resetModules();
    const restored = await import('../src/lib/platform');
    const { roomLink } = await import('../src/lib/router');
    expect(restored.getServerAddress()).toBe('http://192.168.2.8:18878');
    expect(restored.serverUrl()).toBe('ws://192.168.2.8:18878/ws');
    expect(restored.serverHttpUrl()).toBe('http://192.168.2.8:18878');
    expect(roomLink('ABCD')).toBe('http://192.168.2.8:18878/#/room/ABCD');
  });

  it('清空恢复构建默认地址，普通网页仍默认同源', async () => {
    expect(platform.setServerAddress).toBeTypeOf('function');
    vi.stubEnv('VITE_SERVER_URL', 'wss://preset.example/ws');
    platform.setServerAddress('https://new.example');
    platform.setServerAddress('');
    expect(platform.getServerAddress()).toBe('');
    expect(platform.serverUrl()).toBe('wss://preset.example/ws');
    vi.stubEnv('VITE_SERVER_URL', '');
    expect(platform.serverUrl()).toBe('wss://localhost/ws');
    vi.stubEnv('VITE_PUBLIC_URL', '');
    const { roomLink } = await import('../src/lib/router');
    expect(roomLink('ABCD')).toBe('https://localhost/#/room/ABCD');
  });

  it('指定服务器后不再被安装包的旧远程网页配置跳转', async () => {
    expect(platform.setServerAddress).toBeTypeOf('function');
    vi.stubEnv('VITE_REMOTE_URL', 'https://old.example/');
    platform.setServerAddress('https://new.example');
    const network = vi.fn();
    vi.stubGlobal('fetch', network);
    const { isOfflineShell, openRemoteIfOnline } = await import('../src/lib/appShell');
    expect(isOfflineShell()).toBe(false);
    expect(await openRemoteIfOnline()).toBe(false);
    expect(network).not.toHaveBeenCalled();
  });

  it('连接测试使用独立身份完成真实握手，不挤掉玩家连接或修改本机配置', async () => {
    const app = startServer({ port: 0, host: '127.0.0.1' });
    const port = await app.ready;
    const player = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages: { t: string; code?: string }[] = [];
    try {
      await new Promise<void>((resolve) => {
        player.onopen = () =>
          player.send(
            JSON.stringify({ t: 'hello', token: 'real-player-token', name: '玩家', v: 1 }),
          );
        player.onmessage = (event) => {
          const message = JSON.parse(String(event.data));
          messages.push(message);
          if (message.t === 'welcome') resolve();
        };
      });
      platform.storage.set('park.profile', { token: 'real-player-token', name: '玩家' });
      const original = localStorage.getItem('park.profile');
      await testServerConnection(`127.0.0.1:${port}`);
      expect(messages.map((msg) => msg.t)).toEqual(['welcome']);
      expect(player.readyState).toBe(WebSocket.OPEN);
      expect(localStorage.getItem('park.profile')).toBe(original);
      expect(platform.getServerAddress()).toBe('');
    } finally {
      player.close();
      await app.close();
    }
  });
});
