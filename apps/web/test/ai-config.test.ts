import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { complete } from '../src/lib/ai/client';
import * as settings from '../src/lib/ai/settings';
import { storage } from '../src/lib/platform';

const unavailable = { configured: false, protocol: 'openai' as const, model: '' };
const server = { configured: true, protocol: 'openai' as const, model: 'server-model' };

beforeEach(() => {
  vi.stubGlobal('location', new URL('http://deskpark.test:8787/'));
  settings.aiSettings.set({
    source: undefined,
    protocol: 'openai',
    baseUrl: '',
    apiKey: '',
    model: '',
    proxy: false,
    chat: 1,
  });
  settings.serverAi?.set(unavailable);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('AI 配置来源', () => {
  it('新设备有服务器配置时可直接使用，不需要在网页填写 Key', () => {
    expect(settings.serverAi, '需要可读取的服务器默认模型配置').toBeDefined();
    settings.serverAi.set(server);
    expect(settings.effectiveAi()).toMatchObject({
      source: 'server',
      model: 'server-model',
      apiKey: '',
    });
    expect(settings.aiReady()).toBe(true);
    expect(settings.aiSettings.get().apiKey).toBe('');
  });

  it('已有自定义配置继续使用自己的模型，可切换默认后再切回', () => {
    expect(settings.serverAi).toBeDefined();
    settings.serverAi.set(server);
    settings.aiSettings.set({
      baseUrl: 'https://player.example/v1',
      apiKey: 'player-key',
      model: 'player-model',
    });
    expect(settings.effectiveAi()).toMatchObject({
      source: 'custom',
      model: 'player-model',
      apiKey: 'player-key',
    });
    settings.aiSettings.set({ source: 'server' });
    expect(settings.effectiveAi()).toMatchObject({
      source: 'server',
      model: 'server-model',
      apiKey: '',
    });
    settings.aiSettings.set({ source: 'custom' });
    expect(settings.effectiveAi()).toMatchObject({
      source: 'custom',
      model: 'player-model',
      apiKey: 'player-key',
    });
  });

  it('选择服务器默认但服务器未配置时，不会静默改用自定义凭据', async () => {
    settings.aiSettings.set({ source: 'server', apiKey: 'player-key', model: 'player-model' });
    expect(settings.aiReady()).toBe(false);
    await expect(complete({ system: '测试', user: '你好' })).rejects.toThrow(
      '服务器尚未配置默认 AI',
    );
  });

  it('只读取服务器的协议和模型，不将服务端配置持久化或接受返回的 Key', async () => {
    expect(typeof settings.loadServerAi).toBe('function');
    vi.stubEnv('VITE_SERVER_URL', 'wss://games.example.com/ws');
    const network = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ...server, apiKey: 'must-not-store' })));
    vi.stubGlobal('fetch', network);
    const persist = vi.spyOn(storage, 'set');
    await settings.loadServerAi();
    expect(network.mock.calls[0][0]).toBe('https://games.example.com/api/ai-proxy/default');
    expect(settings.serverAi.get()).toEqual(server);
    expect(persist).not.toHaveBeenCalled();
  });

  it('服务器不可达时显示默认模型不可用，自定义仍可使用', async () => {
    expect(typeof settings.loadServerAi).toBe('function');
    settings.serverAi.set(server);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await settings.loadServerAi();
    expect(settings.serverAi.get()).toEqual(unavailable);
    settings.aiSettings.set({ source: 'custom', apiKey: 'player-key', model: 'player-model' });
    expect(settings.aiReady()).toBe(true);
  });

  it('默认 OpenAI 调用经服务器完成，不发送玩家自己的地址或 Key', async () => {
    expect(settings.serverAi).toBeDefined();
    settings.serverAi.set(server);
    settings.aiSettings.set({
      source: 'server',
      baseUrl: 'https://player.example/v1',
      apiKey: 'player-key',
      model: 'player-model',
    });
    const network = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: '你好' } }] })),
      );
    vi.stubGlobal('fetch', network);
    expect(await complete({ system: '测试', user: '你好' })).toBe('你好');
    const [url, init] = network.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://deskpark.test:8787/api/ai-proxy/default/openai/chat/completions');
    expect(init.headers).not.toHaveProperty('authorization');
    expect(init.headers).not.toHaveProperty('x-ai-target');
    expect(JSON.parse(String(init.body)).model).toBe('server-model');
    expect(JSON.stringify(network.mock.calls)).not.toContain('player-key');
  });

  it('默认 Anthropic 沿用 SDK 调用和响应解析，网页不需要真实 Key', async () => {
    expect(settings.serverAi).toBeDefined();
    settings.serverAi.set({ ...server, protocol: 'anthropic', model: 'claude-opus-4-6' });
    const network = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ content: [{ type: 'text', text: '你好' }], stop_reason: 'end_turn' }),
          { headers: { 'content-type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', network);
    expect(await complete({ system: '测试', user: '你好' })).toBe('你好');
    const [url, init] = network.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe(
      'http://deskpark.test:8787/api/ai-proxy/default/anthropic/v1/messages',
    );
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer server-default');
    expect(new Headers(init.headers).has('x-ai-target')).toBe(false);
  });

  it('自定义的转发开关只改变路径，模型和 Key 始终使用玩家配置', async () => {
    settings.aiSettings.set({
      source: 'custom',
      baseUrl: 'https://player.example/v1',
      apiKey: 'player-key',
      model: 'player-model',
    });
    const network = vi
      .fn()
      .mockImplementation(
        async () => new Response(JSON.stringify({ choices: [{ message: { content: '你好' } }] })),
      );
    vi.stubGlobal('fetch', network);
    for (const proxy of [false, true]) {
      settings.aiSettings.set({ proxy });
      await complete({ system: '测试', user: '你好' });
      const [url, init] = network.mock.calls.at(-1) as [string, RequestInit];
      expect(url).toBe(
        proxy
          ? 'http://deskpark.test:8787/api/ai-proxy/openai/chat/completions'
          : 'https://player.example/v1/chat/completions',
      );
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer player-key');
      expect(JSON.parse(String(init.body)).model).toBe('player-model');
    }
  });
});
