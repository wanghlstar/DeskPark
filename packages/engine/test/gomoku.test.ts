import { describe, expect, it } from 'vitest';
import { getGame, Rng, simulate } from '../src';

function game() {
  const def = getGame('gomoku');
  expect(def, '五子棋应注册为独立玩法').toBeDefined();
  return def!;
}

function setup(side = 'black') {
  return game().setup({
    players: [
      { name: '我', isBot: false },
      { name: '电脑', isBot: true },
    ],
    options: { level: 1, side },
    seed: 19,
  });
}

function place(state: ReturnType<typeof setup>, at: number) {
  const def = game();
  const before = JSON.stringify(state);
  expect(def.validate(state, state.turn, { type: 'place', at })).toBeNull();
  const next = def.apply(state, state.turn, { type: 'place', at });
  expect(JSON.stringify(state)).toBe(before);
  return next;
}

describe('五子棋', () => {
  it('15×15 空棋盘，黑方先走，选择白方时电脑先走', () => {
    const state = setup();
    expect(state.board).toEqual(Array(225).fill(0));
    expect(state.turn).toBe(0);
    expect(setup('white').turn).toBe(1);
    expect(setup('random')).toEqual(setup('random'));
  });

  it.each([1, 15, 16, 14])('横竖斜连五判胜，方向步长 %i', (step) => {
    let state = setup();
    const first = step === 14 ? 4 : 0;
    for (let i = 0; i < 4; i++) {
      state = place(state, first + step * i);
      state = place(state, 210 + i);
    }
    state = place(state, first + step * 4);
    expect(state.result).toMatchObject({ winner: 0, reason: 'five' });
    expect(state.winning).toHaveLength(5);
    expect(game().activeSeats(state)).toEqual([]);
  });

  it('长连也获胜，棋盘换行不能误判为横向相连', () => {
    const state = setup();
    for (const at of [0, 1, 2, 4, 5]) state.board[at] = 1;
    expect(place(state, 3).result.winner).toBe(0);
    const edge = setup();
    for (const at of [12, 13, 14, 15]) edge.board[at] = 1;
    expect(place(edge, 16).phase).toBe('play');
  });

  it('拒绝越界、非整数、重复落子、过牌和错误座位', () => {
    const def = game();
    const state = place(setup(), 112);
    for (const at of [-1, 225, 2.5, '12', null, Infinity, 112])
      expect(def.validate(state, 1, { type: 'place', at })).toBeTruthy();
    expect(def.validate(state, 0, { type: 'place', at: 1 })).toBeTruthy();
    expect(def.validate(state, 1, { type: 'pass' })).toBeTruthy();
  });

  it('人机局悔棋撤回自己的落子与电脑应着，真人对局不允许悔棋', () => {
    const def = game();
    const state = place(place(setup(), 112), 113);
    expect(def.view(state, 0).canUndo).toBe(true);
    const undone = def.apply(state, 0, { type: 'undo' });
    expect(undone.board.every((x: number) => x === 0)).toBe(true);
    expect(undone.moves).toEqual([]);
    expect(undone.turn).toBe(0);
    state.bots[1] = false;
    expect(def.validate(state, 0, { type: 'undo' })).toBeTruthy();
  });

  it('认输立即结束，结束后不能再落子', () => {
    const def = game();
    const state = def.apply(setup(), 0, { type: 'resign' });
    expect(state.result).toEqual({ winner: 1, reason: 'resign' });
    expect(def.validate(state, 0, { type: 'place', at: 112 })).toBeTruthy();
  });

  it('满盘且没有五连时判和', () => {
    const s = setup();
    s.board = Array.from(
      { length: 225 },
      (_, at) => (((at % 15) + Math.floor(Math.floor(at / 15) / 2)) % 2) + 1,
    );
    s.board[223] = 0;
    const next = place(s, 223);
    expect(next.winning).toEqual([]);
    expect(next.result).toEqual({ winner: null, reason: 'full' });
  });

  it('电脑能立即成五，也会挡住对手唯一的成五位置；搜索不修改视图', () => {
    const def = game();
    for (const color of [1, 2]) {
      const state = setup();
      state.board[0] = color === 1 ? 2 : 1;
      for (const at of [1, 2, 3, 4]) state.board[at] = color;
      const view = def.view(state, 0);
      const before = JSON.stringify(view);
      expect(def.bot(view, 0, new Rng(7))).toEqual({ type: 'place', at: 5 });
      expect(JSON.stringify(view)).toBe(before);
    }
  });

  it('多种种子下电脑完整对弈并有结果，状态可序列化', () => {
    const def = game();
    for (let seed = 1; seed <= 6; seed++) {
      const { state } = simulate(def, 2, { level: (seed % 3) + 1, side: 'random' }, seed, 226);
      expect(def.isOver(state)).toBe(true);
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    }
  });
});
