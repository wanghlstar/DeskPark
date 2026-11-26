import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as platform from '../src/lib/platform';

beforeEach(() => {
  vi.resetModules();
  const saved = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  });
  vi.stubGlobal('Capacitor', undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe('牌桌强制横屏', () => {
  it('普通浏览器和未安装插件的旧 APK 不请求锁屏', async () => {
    expect(platform.supportsTableLandscape).toBeTypeOf('function');
    expect(platform.supportsTableLandscape()).toBe(false);
    await platform.setTableLandscape(true);
    const bridge = vi.fn();
    vi.stubGlobal('Capacitor', { isPluginAvailable: () => false, nativePromise: bridge });
    expect(platform.supportsTableLandscape()).toBe(false);
    await platform.setTableLandscape(true);
    expect(bridge).not.toHaveBeenCalled();
  });

  it('原生牌桌使用 landscape，退出或关闭后解锁而不锁定竖屏', async () => {
    const bridge = vi.fn(async () => undefined);
    vi.stubGlobal('Capacitor', {
      isPluginAvailable: (name: string) => name === 'ScreenOrientation',
      nativePromise: bridge,
    });
    expect(platform.supportsTableLandscape).toBeTypeOf('function');
    expect(platform.supportsTableLandscape()).toBe(true);
    await platform.setTableLandscape(true);
    await platform.setTableLandscape(false);
    expect(bridge.mock.calls).toEqual([
      ['ScreenOrientation', 'lock', { orientation: 'landscape' }],
      ['ScreenOrientation', 'unlock', {}],
    ]);
  });

  it('原生调用失败可被界面捕获，避免显示成功但没有切换方向', async () => {
    vi.stubGlobal('Capacitor', {
      isPluginAvailable: () => true,
      nativePromise: vi.fn(async () => {
        throw new Error('系统拒绝锁定方向');
      }),
    });
    expect(platform.setTableLandscape).toBeTypeOf('function');
    await expect(platform.setTableLandscape(true)).rejects.toThrow('系统拒绝锁定方向');
  });

  it('旧设置默认跟随系统，开启后刷新保留选择且保留其他设置', async () => {
    localStorage.setItem('park.settings', JSON.stringify({ speechRate: 1.25, botPace: 'fast' }));
    const { settings } = await import('../src/lib/store');
    expect(settings.get().tableLandscape).toBe(false);
    settings.set({ tableLandscape: true });
    vi.resetModules();
    const restored = (await import('../src/lib/store')).settings.get();
    expect(restored).toMatchObject({ tableLandscape: true, speechRate: 1.25, botPace: 'fast' });
  });
});
