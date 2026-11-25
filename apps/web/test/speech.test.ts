import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const voices = [
  { voiceURI: 'english', name: 'English', lang: 'en-US', localService: true, default: true },
  { voiceURI: 'online', name: '自然普通话', lang: 'zh-CN', localService: false, default: false },
  { voiceURI: 'cantonese', name: '粤语', lang: 'zh-HK', localService: true, default: false },
  { voiceURI: 'local', name: '本地普通话', lang: 'zh-CN', localService: true, default: false },
];
const synth = { getVoices: vi.fn(() => voices), speak: vi.fn(), cancel: vi.fn() };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  const saved = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  });
  vi.stubGlobal('window', { speechSynthesis: synth });
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      constructor(public text: string) {}
    },
  );
  vi.stubGlobal('Capacitor', undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe('中文报牌语音', () => {
  it('优先本地普通话，保留其他中文音色供试听选择', async () => {
    const speech = await import('../src/lib/speech');
    const list = await speech.loadSpeechVoices();
    expect(list.map((v) => v.id)).toEqual(['local', 'online', 'cantonese']);
    speech.speak('轮到你出牌');
    expect(synth.speak.mock.calls[0][0]).toMatchObject({ voice: voices[3], lang: 'zh-CN' });
  });

  it('保存的音色与语速生效；音色消失后退回普通话', async () => {
    const { settings } = await import('../src/lib/store');
    const speech = await import('../src/lib/speech');
    settings.set({ speechVoice: 'online', speechRate: 1.3 });
    speech.speak('对六');
    expect(synth.speak.mock.calls[0][0]).toMatchObject({ voice: voices[1], rate: 1.3 });
    settings.set({ speechVoice: 'removed' });
    speech.speak('不要');
    expect(synth.speak.mock.calls[1][0]).toMatchObject({ voice: voices[3] });
    expect(synth.cancel).toHaveBeenCalledTimes(2);
  });

  it('独立语音开关及总音效开关都能静音，试听不改设置', async () => {
    const { settings } = await import('../src/lib/store');
    const speech = await import('../src/lib/speech');
    settings.set({ speech: false });
    speech.speak('顺子');
    expect(synth.speak).not.toHaveBeenCalled();
    speech.speak('试听：该你出牌了', { preview: true });
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(settings.get().speech).toBe(false);
    settings.set({ speech: true, sound: false });
    speech.speak('三带二');
    expect(synth.speak).toHaveBeenCalledTimes(1);
  });

  it('原生音色使用稳定标识保存，并映射回插件的完整列表下标', async () => {
    const bridge = vi.fn(async (_plugin: string, method: string) =>
      method === 'getSupportedVoices' ? { voices } : undefined,
    );
    vi.stubGlobal('Capacitor', { isPluginAvailable: () => true, nativePromise: bridge });
    const { settings } = await import('../src/lib/store');
    const speech = await import('../src/lib/speech');
    await speech.loadSpeechVoices();
    settings.set({ speechVoice: 'local', speechRate: 0.9 });
    speech.speak('黑桃A');
    await vi.waitFor(() =>
      expect(bridge).toHaveBeenCalledWith('TextToSpeech', 'speak', {
        text: '黑桃A',
        lang: 'zh-CN',
        rate: 0.9,
        voice: 3,
        queueStrategy: 0,
      }),
    );
    expect(synth.speak).not.toHaveBeenCalled();
    speech.stopSpeech();
    expect(bridge).toHaveBeenCalledWith('TextToSpeech', 'stop', {});
  });

  it('停止语音使尚在加载音色的旧报牌失效，不延迟读出过时动作', async () => {
    let resolve!: (value: unknown) => void;
    const bridge = vi.fn((_plugin: string, method: string) =>
      method === 'getSupportedVoices'
        ? new Promise((done) => {
            resolve = done;
          })
        : Promise.resolve(),
    );
    vi.stubGlobal('Capacitor', { isPluginAvailable: () => true, nativePromise: bridge });
    const speech = await import('../src/lib/speech');
    speech.speak('旧报牌');
    speech.stopSpeech();
    resolve({ voices });
    await new Promise((done) => setTimeout(done, 0));
    expect(bridge.mock.calls.some((call) => call[1] === 'speak')).toBe(false);
  });
});
