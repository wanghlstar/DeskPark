import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { render, preferences } = vi.hoisted(() => ({
  render: vi.fn<(track: 'lively' | 'calm') => Promise<AudioBuffer>>(),
  preferences: { music: true, musicVolume: 0.2, sound: false },
}));
vi.mock('../src/lib/store', () => ({ settings: { get: () => preferences } }));
vi.mock('../src/lib/music-score', async (original) => ({
  ...(await original<typeof import('../src/lib/music-score')>()),
  renderMusic: render,
}));

class Gain {
  gain = {
    value: 0,
    setValueAtTime(value: number) {
      this.value = value;
    },
    linearRampToValueAtTime(value: number) {
      this.value = value;
    },
    setTargetAtTime(value: number) {
      this.value = value;
    },
    cancelScheduledValues() {},
  };
  connect(target: unknown) {
    return target;
  }
  disconnect() {}
}

class Source {
  buffer: AudioBuffer | null = null;
  loop = false;
  started = false;
  stopped = false;
  onended: (() => void) | null = null;
  connect(target: unknown) {
    return target;
  }
  disconnect() {}
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
    this.onended?.();
  }
}

class Context {
  static instances: Context[] = [];
  currentTime = 0;
  state = 'running';
  destination = {};
  sources: Source[] = [];
  gains: Gain[] = [];
  constructor() {
    Context.instances.push(this);
  }
  createGain() {
    const gain = new Gain();
    this.gains.push(gain);
    return gain;
  }
  createBufferSource() {
    const source = new Source();
    this.sources.push(source);
    return source;
  }
  async resume() {
    this.state = 'running';
  }
  async suspend() {
    this.state = 'suspended';
  }
  async close() {
    this.state = 'closed';
  }
}

let player: import('../src/lib/music').BackgroundMusic;
let pending: Map<string, (buffer: AudioBuffer) => void>;
let hidden = false;
const buffers = {
  lively: { duration: 71.1 } as AudioBuffer,
  calm: { duration: 91.4 } as AudioBuffer,
};
const active = () =>
  Context.instances.flatMap((ac) => ac.sources).filter((s) => s.started && !s.stopped);
async function finish(track: keyof typeof buffers) {
  pending.get(track)!(buffers[track]);
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(async () => {
  vi.resetModules();
  render.mockReset();
  preferences.music = true;
  preferences.musicVolume = 0.2;
  hidden = false;
  Context.instances = [];
  pending = new Map();
  render.mockImplementation((track) => new Promise((resolve) => pending.set(track, resolve)));
  vi.stubGlobal('AudioContext', Context);
  vi.stubGlobal('document', {
    get hidden() {
      return hidden;
    },
  });
  player = new (await import('../src/lib/music')).BackgroundMusic();
});

afterEach(() => {
  player.dispose();
  vi.unstubAllGlobals();
});

describe('背景音乐播放生命周期', () => {
  it('首次交互前不创建音频；音效关闭不影响背景音乐', async () => {
    player.scene();
    expect(Context.instances).toHaveLength(0);
    player.unlock();
    await finish('lively');
    expect(active()).toHaveLength(1);
    expect(active()[0].loop).toBe(true);
    expect(preferences.sound).toBe(false);
  });

  it('渲染期间关闭音乐，过期结果不能重新开始播放', async () => {
    player.unlock();
    preferences.music = false;
    await player.sync();
    await finish('lively');
    expect(active()).toHaveLength(0);
    preferences.music = true;
    await player.sync();
    expect(active()).toHaveLength(1);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('舒缓曲尚在渲染时返回大厅，保留正在播放的轻快曲', async () => {
    player.unlock();
    await finish('lively');
    const original = active()[0];
    player.scene('pinghu');
    expect(pending.has('calm')).toBe(true);
    player.scene();
    await finish('calm');
    expect(active()).toEqual([original]);
    expect(active()[0].buffer).toBe(buffers.lively);
  });

  it('改音量不重启曲目；归零暂停，恢复后复用已有缓冲', async () => {
    player.unlock();
    await finish('lively');
    const original = active()[0];
    preferences.musicVolume = 0.35;
    await player.sync();
    expect(active()).toEqual([original]);
    expect(Context.instances[0].gains[0].gain.value).toBe(0.35);
    preferences.musicVolume = 0;
    await player.sync();
    expect(active()).toHaveLength(0);
    preferences.musicVolume = 0.3;
    await player.sync();
    expect(active()).toHaveLength(1);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('后台停止播放和音频上下文；返回后仅恢复一条循环', async () => {
    player.unlock();
    await finish('lively');
    hidden = true;
    await player.sync();
    expect(active()).toHaveLength(0);
    expect(Context.instances[0].state).toBe('suspended');
    hidden = false;
    await player.sync();
    await player.sync();
    expect(active()).toHaveLength(1);
    expect(Context.instances[0].state).toBe('running');
  });

  it('进入麻将后切曲，之后进入棋类保持同一条舒缓循环', async () => {
    player.unlock();
    await finish('lively');
    player.scene('pinghu');
    await finish('calm');
    expect(active()).toHaveLength(1);
    expect(active()[0].buffer).toBe(buffers.calm);
    const original = active()[0];
    player.scene('gomoku');
    await player.sync();
    expect(active()).toEqual([original]);
    expect(render).toHaveBeenCalledTimes(2);
  });
});
