import type { ServerMessage } from '@park/protocol';
import { PROTOCOL_VERSION } from '@park/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hub } from '../src/rooms';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('联机房主设置节奏', () => {
  it('创建与修改向所有玩家同步，非房主和开局后的修改被拒绝', () => {
    const hub = new Hub();
    const a: ServerMessage[] = [],
      b: ServerMessage[] = [];
    const host = hub.connect((m) => a.push(m)),
      guest = hub.connect((m) => b.push(m));
    host.onMessage({ t: 'hello', token: 'pace-host-aaaaaaaa', name: '甲', v: PROTOCOL_VERSION });
    guest.onMessage({ t: 'hello', token: 'pace-guest-bbbbbbb', name: '乙', v: PROTOCOL_VERSION });
    host.onMessage({ t: 'create', gameId: 'highcard', seats: 3, pace: 'fast' });
    const room = [...hub.rooms.values()][0];
    try {
      expect(room.snapshot().pace).toBe('fast');
      guest.onMessage({ t: 'join', code: room.code });
      expect(b.filter((m) => m.t === 'room').at(-1)).toMatchObject({ room: { pace: 'fast' } });
      guest.onMessage({ t: 'configure', pace: 'relaxed' });
      expect(room.snapshot().pace).toBe('fast');
      host.onMessage({ t: 'configure', pace: 'relaxed' });
      expect(b.filter((m) => m.t === 'room').at(-1)).toMatchObject({ room: { pace: 'relaxed' } });
      host.onMessage({ t: 'configure', pace: 'fast' });
      host.onMessage({ t: 'start' });
      host.onMessage({ t: 'configure', pace: 'relaxed' });
      expect(room.snapshot().pace).toBe('fast');
      vi.advanceTimersByTime(500);
      expect(room.table!.version).toBe(1); // 第三座电脑已经出牌，两位真人仍等待。
      expect(Object.keys(room.table!.deadlines)).toHaveLength(2);
    } finally {
      room.dispose();
    }
  });

  it('旧客户端省略或乱填节奏时使用标准，不能设置任意零延迟', () => {
    const hub = new Hub();
    const host = hub.connect(() => {});
    host.onMessage({ t: 'hello', token: 'pace-default-aaaa', name: '甲', v: PROTOCOL_VERSION });
    host.onMessage({ t: 'create', gameId: 'highcard', pace: 0 });
    const room = [...hub.rooms.values()][0];
    expect(room.snapshot().pace).toBe('normal');
    host.onMessage({ t: 'configure', pace: 'unexpected' });
    expect(room.snapshot().pace).toBe('normal');
    room.dispose();
  });
});
