import type { Table } from '@park/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiSpeech } from '../src/lib/ai/events';
import { aiSettings, serverAi } from '../src/lib/ai/settings';
import { aiTurn } from '../src/lib/ai/turn';
import { decide } from '../src/lib/ai/agent';
import { speak } from '../src/lib/speech';

vi.mock('../src/lib/speech', () => ({ speak: vi.fn(), stopSpeech: vi.fn() }));
vi.mock('../src/lib/ai/agent', () => ({
  decide: vi.fn(async () => ({ index: 0, say: '看我这手！' })),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  aiSpeech.clear();
  aiSettings.set({ source: 'server', chat: 3, readAloud: true });
  serverAi.set({ configured: true, protocol: 'openai', model: 'test-model' });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AI 发言与朗读', () => {
  it('AI 气泡接入语音；关闭朗读仍然显示文字', () => {
    aiSpeech.say(1, '该我啦');
    expect(speak).toHaveBeenCalledWith('该我啦', { interrupt: false, channel: 'ai' });
    expect(aiSpeech.get()[1].text).toBe('该我啦');
    aiSettings.set({ readAloud: false });
    aiSpeech.say(2, '我先过');
    expect(speak).toHaveBeenCalledTimes(1);
    expect(aiSpeech.get()[2].text).toBe('我先过');
  });

  const table = () =>
    ({
      seats: [
        { name: '我', isBot: false },
        { name: '电脑', isBot: true, ai: true },
      ],
      def: {
        meta: { name: '测试扑克' },
        aiPrompt: () => ({
          situation: '公开局面',
          options: [
            { label: '第一手', action: { type: 'play', cards: [1] } },
            { label: '第二手', action: { type: 'pass' } },
          ],
        }),
      },
      view: () => ({}),
    }) as unknown as Table;

  it('话痨每次思考都请求一句话，不因随机概率保持沉默', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    await aiTurn(table(), 1, { onCancel: () => {} });
    expect(vi.mocked(decide).mock.calls[0][3]).toBe(true);
    expect(aiSpeech.get()[1].text).toBe('看我这手！');
  });

  it('不主动发言时即使模型擅自返回 say，也不显示和朗读', async () => {
    aiSettings.set({ chat: 0 });
    const action = await aiTurn(table(), 1, { onCancel: () => {} });
    expect(action).toEqual({ type: 'play', cards: [1] });
    expect(aiSpeech.get()).toEqual({});
    expect(speak).not.toHaveBeenCalled();
  });
});
