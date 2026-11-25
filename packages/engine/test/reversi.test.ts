import { describe, expect, it } from 'vitest';
import { getGame, Rng } from '../src';

function game() {
  const def = getGame('reversi');
  expect(def, '黑白棋应注册为独立玩法').toBeDefined();
  return def!;
}
function setup(side = 'black') {
  return game().setup({
    players: [
      { name: '我', isBot: false },
      { name: '电脑', isBot: true },
    ],
    options: { level: 1, side },
    seed: 4,
  });
}
function place(s: ReturnType<typeof setup>, at: number) {
  const def = game();
  expect(def.validate(s, s.turn, { type: 'place', at })).toBeNull();
  const before = JSON.stringify(s);
  const next = def.apply(s, s.turn, { type: 'place', at });
  expect(JSON.stringify(s)).toBe(before);
  return next;
}

describe('黑白棋', () => {
  it('标准开局黑先，只有四个合法位置，白方选项与随机种子可复现', () => {
    const def = game();
    const s = setup();
    expect(s.board.filter(Boolean)).toHaveLength(4);
    expect(def.view(s, 0).legal).toEqual([19, 26, 37, 44]);
    expect(s.turn).toBe(0);
    expect(setup('white').turn).toBe(1);
    expect(setup('random')).toEqual(setup('random'));
  });

  it('落子必须夹住对手棋子，同时翻转所有八个方向', () => {
    const s = setup();
    s.board.fill(0);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      s.board[(3 + dy) * 8 + 3 + dx] = 2;
      s.board[(3 + 2 * dy) * 8 + 3 + 2 * dx] = 1;
    }
    const next = place(s, 27);
    expect(next.board.filter((p: number) => p === 1)).toHaveLength(17);
    expect(next.board.filter((p: number) => p === 2)).toHaveLength(0);
    expect(next.result.winner).toBe(0);
  });

  it('不会越过空格、自己棋子或棋盘边界错误夹吃', () => {
    const def = game();
    const s = setup();
    s.board.fill(0);
    s.board[7] = 2;
    s.board[8] = 1;
    expect(def.validate(s, 0, { type: 'place', at: 6 })).toBeTruthy();
    for (const at of [-1, 64, 1.1, '19', null, 27, 0])
      expect(def.validate(setup(), 0, { type: 'place', at })).toBeTruthy();
    expect(def.validate(setup(), 1, { type: 'place', at: 19 })).toBeTruthy();
    expect(def.validate(setup(), 0, { type: 'pass' })).toBeTruthy();
  });

  it('对方无棋可走时自动让行，当前玩家继续走', () => {
    const s = setup();
    s.board.fill(1);
    s.board[0] = 0;
    s.board[1] = 2;
    s.board[56] = 0;
    s.board[57] = 2;
    const next = place(s, 0);
    expect(next.phase).toBe('play');
    expect(next.turn).toBe(0);
    expect(next.skipped).toBe(1);
    expect(game().view(next, 0).legal).toEqual([56]);
  });

  it('双方都不能走则结束，即使棋盘尚有空位；按实际子数确定赢家', () => {
    const s = setup();
    s.board.fill(0);
    s.board[1] = 2;
    s.board[2] = 1;
    const next = place(s, 0);
    expect(next.board.filter(Boolean)).toHaveLength(3);
    expect(next.phase).toBe('over');
    expect(next.result).toMatchObject({ winner: 0, reason: 'nomoves' });
    expect(game().activeSeats(next)).toEqual([]);
  });

  it('满盘双方各 32 子时为和棋', () => {
    const s = setup();
    s.board = Array(64).fill(2);
    for (const i of [2, ...Array.from({ length: 29 }, (_, n) => n + 8)]) s.board[i] = 1;
    s.board[0] = 0;
    const next = place(s, 0);
    expect(next.board.filter((p: number) => p === 1)).toHaveLength(32);
    expect(next.result.winner).toBeNull();
  });

  it('人机悔棋恢复被翻转的棋子，真人对局不能悔棋；认输结束', () => {
    const def = game();
    const initial = setup();
    let s = place(initial, 19);
    s = place(s, def.view(s, s.turn).legal[0]);
    expect(def.view(s, 0).canUndo).toBe(true);
    const undone = def.apply(s, 0, { type: 'undo' });
    expect(undone.board).toEqual(initial.board);
    expect(undone.moves).toEqual([]);
    s.bots[1] = false;
    expect(def.validate(s, 0, { type: 'undo' })).toBeTruthy();
    expect(def.apply(initial, 0, { type: 'resign' }).result).toEqual({
      winner: 1,
      reason: 'resign',
    });
  });

  it('三档电脑均只下合法位置，不修改视图，有角时优先占角', () => {
    const def = game();
    for (const level of [1, 2, 3]) {
      const s = setup();
      s.options.level = level;
      s.board[0] = 0;
      s.board[1] = 2;
      s.board[2] = 1;
      const v = def.view(s, 0);
      const before = JSON.stringify(v);
      const a = def.bot(v, 0, new Rng(6));
      expect(a).toEqual({ type: 'place', at: 0 });
      expect(def.validate(s, 0, a)).toBeNull();
      expect(JSON.stringify(v)).toBe(before);
    }
  });

  it('多个种子完整对弈，每步棋子总数恰增一，自动让行也可正常结束', () => {
    const def = game();
    for (let seed = 1; seed <= 8; seed++) {
      let s = setup();
      s.options.level = (seed % 3) + 1;
      const rng = new Rng(seed);
      let steps = 0;
      while (!def.isOver(s) && steps++ < 61) {
        const seat = s.turn;
        const count = s.board.filter(Boolean).length;
        const a =
          seed % 2
            ? def.bot(def.view(s, seat), seat, rng)
            : { type: 'place', at: rng.pick(def.view(s, seat).legal) };
        s = place(s, a.at);
        expect(s.board.filter(Boolean)).toHaveLength(count + 1);
        expect(JSON.parse(JSON.stringify(s))).toEqual(s);
      }
      expect(s.phase).toBe('over');
    }
  });
});
