import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Table, highcard } from '../src';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const game = {
  ...highcard,
  meta: { ...highcard.meta, botDelayMs: [1000, 1000] as [number, number] },
};
const seats = () => [
  { name: '我', isBot: false },
  { name: 'B1', isBot: true },
  { name: 'B2', isBot: true },
];

describe('电脑行动节奏', () => {
  it('快速节奏缩短电脑等待，但真人截止时间和亮牌窗口不变', () => {
    const table = new Table(
      game,
      seats(),
      { rounds: 1 },
      { humanTimeoutMs: 5000, botDelayScale: 0.5 },
    );
    try {
      table.start();
      const deadline = table.deadlines[0];
      vi.advanceTimersByTime(499);
      expect(table.version).toBe(0);
      vi.advanceTimersByTime(1);
      expect(table.version).toBe(2);
      expect(table.deadlines[0]).toBe(deadline);
      table.act(0, { type: 'choose', card: table.view(0).hand[0].id });
      expect(table.state.phase).toBe('reveal');
      vi.advanceTimersByTime(1799);
      expect(table.state.phase).toBe('reveal');
      vi.advanceTimersByTime(1);
      expect(table.state.phase).toBe('choose');
    } finally {
      table.dispose();
    }
  });

  it('对局中换节奏会重排电脑计时，保留真人计时', () => {
    const table = new Table(game, seats(), { rounds: 1 }, { humanTimeoutMs: 5000 });
    try {
      table.start();
      const deadline = table.deadlines[0];
      vi.advanceTimersByTime(100);
      table.setBotDelayScale(0.5);
      expect(table.deadlines[0]).toBe(deadline);
      vi.advanceTimersByTime(500);
      expect(table.version).toBe(2);
    } finally {
      table.dispose();
    }
  });

  it('托管延迟同样调整，无效速度恢复标准，关闭后不再行动', () => {
    const table = new Table(
      game,
      seats().map((s) => ({ ...s, isBot: false, auto: true })),
      { rounds: 1 },
      { botDelayScale: Number.NaN },
    );
    try {
      table.start();
      table.setBotDelayScale(0.5);
      vi.advanceTimersByTime(349);
      expect(table.version).toBe(0);
      vi.advanceTimersByTime(1);
      expect(table.version).toBe(3);
      table.stop();
      const version = table.version;
      vi.advanceTimersByTime(5000);
      expect(table.version).toBe(version);
    } finally {
      table.dispose();
    }
  });
});
