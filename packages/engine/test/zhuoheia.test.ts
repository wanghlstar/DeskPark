import type { Card } from '../src';
import { getGame, ha, Rng } from '../src';
import { describe, expect, it } from 'vitest';

function game() {
  const def = getGame('zhuoheia');
  expect(def, '河南捉黑 A 应注册为独立玩法').toBeDefined();
  return def!;
}
function setup(players = 3, rounds = 1, seed = 9) {
  return game().setup({
    players: Array.from({ length: players }, (_, i) => ({ name: `P${i}`, isBot: true })),
    options: { rounds },
    seed,
  });
}
const cards = (values: number[], offset = 0): Card[] =>
  values.map((v, i) => ({
    id: offset + i,
    rank: v === 19 ? 14 : v === 18 ? 17 : v === 17 ? 16 : v === 16 ? 3 : v === 15 ? 2 : v,
    suit: v === 19 ? 'S' : v >= 17 ? 'J' : 'H',
  }));
function rig(hands: number[][]) {
  const s = setup(hands.length);
  s.hands = hands.map((h, i) => cards(h, i * 100));
  s.blackSeats = hands.map((h, i) => (h.includes(19) ? i : -1)).filter((i) => i >= 0);
  s.turn = 0;
  return s;
}
function act(s: ReturnType<typeof setup>, action: unknown) {
  const def = game(),
    before = JSON.stringify(s);
  expect(def.validate(s, s.turn, action)).toBeNull();
  const next = def.apply(s, s.turn, action);
  expect(JSON.stringify(s)).toBe(before);
  return next;
}
const play = (s: ReturnType<typeof setup>, ids = s.hands[s.turn].map((c: Card) => c.id)) =>
  act(s, { type: 'play', cards: ids });

describe('河南捉黑 A', () => {
  it.each([3, 4, 5, 6, 7, 8])('%i 人自动选择一/两副完整牌，无底牌，发牌最多相差一张', (n) => {
    const s = setup(n),
      deck: Card[] = s.hands.flat();
    expect(deck).toHaveLength(n >= 5 ? 108 : 54);
    expect(new Set(deck.map((c) => c.id)).size).toBe(deck.length);
    expect(deck.filter((c) => c.suit === 'J')).toHaveLength(n >= 5 ? 4 : 2);
    expect(s.blackSeats.length).toBeGreaterThanOrEqual(1);
    const sizes = s.hands.map((h: Card[]) => h.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(setup(n)).toEqual(s);
  });

  it('大小严格为黑桃A、大王、小王、3、2、其他A、K到4', () => {
    const order = [19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4];
    for (let i = 0; i < order.length - 1; i++) {
      const target = ha.resolvePlay(cards([order[i + 1]]), null)!;
      expect(ha.resolvePlay(cards([order[i]]), target)).toBeTruthy();
      expect(
        ha.resolvePlay(cards([order[i + 1]]), ha.resolvePlay(cards([order[i]]), null)),
      ).toBeNull();
    }
  });

  it.each([
    [4],
    [5, 5],
    [6, 6, 6],
    [7, 7, 7, 8, 9],
    [4, 5, 6, 7, 8],
    [4, 4, 5, 5],
    [4, 4, 4, 5, 5, 5],
    [4, 4, 4, 5, 5, 5, 17, 19],
    [4, 4, 4, 5, 5, 5, 6, 6, 18, 18],
  ])('接受争上游常用牌型 %j', (...values) => {
    expect(ha.resolvePlay(cards(values), null)).toBeTruthy();
  });
  it.each([
    [4, 4, 4, 4],
    [17, 18],
    [12, 13, 14, 15, 16],
    [3, 4, 5, 6, 7],
    [4, 4, 4, 5],
    [19, 14],
    [4, 5, 6, 7],
  ])('拒绝炸弹、王炸和越界连续牌 %j', (...values) => {
    expect(ha.resolvePlay(cards(values), null)).toBeNull();
  });

  it('黑 A 只是最大单张，不能单张压对子；可以主动过牌配合', () => {
    let s = play(
      rig([
        [6, 6, 4],
        [19, 9],
        [5, 5, 8],
      ]),
      [0, 1],
    );
    expect(game().validate(s, 1, { type: 'play', cards: [100] })).toBeTruthy();
    s = act(s, { type: 'pass' });
    expect(s.turn).toBe(2);
  });

  it('普通玩家先走不结束；黑 A 即使第二个走也让黑 A 方获胜', () => {
    let s = play(rig([[4], [19], [8, 9]]));
    expect(s.phase).toBe('playing');
    expect(s.finishOrder).toEqual([0]);
    s = play(s);
    expect(s.result.blackWon).toBe(true);
    expect(s.result.winners).toEqual([1]);
    expect(s.result.deltas).toEqual([-1, 2, -1]);
  });

  it('所有普通玩家跑完才算捉住，黑 A 留到最后输', () => {
    let s = play(rig([[4], [19], [5]]));
    s = act(s, { type: 'pass' });
    s = play(s);
    expect(s.result.blackWon).toBe(false);
    expect(s.result.winners).toEqual([0, 2]);
    expect(s.result.deltas).toEqual([1, -2, 1]);
  });

  it('两张黑桃 A 的持有者同队，一人跑掉同赢；一人两张时独战', () => {
    let s = rig([[19, 4], [19], [5], [6], [7]]);
    s.turn = 1;
    s = play(s);
    expect(s.result.winners).toEqual([0, 1]);
    expect(s.result.deltas).toEqual([3, 3, -2, -2, -2]);
    s = play(rig([[19, 19], [5], [6], [7], [8]]));
    expect(s.result.winners).toEqual([0]);
    expect(s.result.deltas).toEqual([4, -1, -1, -1, -1]);
  });

  it('已走玩家跳过；出完者收回牌权时由下一位未走玩家领出', () => {
    let s = play(rig([[4], [19, 8], [6, 7], [9, 10]]));
    for (let i = 0; i < 3; i++) s = act(s, { type: 'pass' });
    expect(s.turn).toBe(1);
    expect(s.lastPlay).toBeNull();
    expect(game().validate(s, 0, { type: 'pass' })).toBeTruthy();
    expect(game().validate(s, 1, { type: 'pass' })).toBeTruthy();
  });

  it('对手手牌、黑 A 持有者和随机种子不泄露给其他人及观战者', () => {
    let s = rig([
      [19, 4],
      [7, 8],
      [5, 6],
    ]);
    const other = game().view(s, 1),
      watcher = game().view(s, null);
    expect(other).not.toHaveProperty('hands');
    expect(other).not.toHaveProperty('blackSeats');
    expect(other).not.toHaveProperty('rng');
    expect(other.role).toBe('catcher');
    expect(watcher.role).toBeNull();
    expect(watcher.hand).toEqual([]);
    expect(other.exposed).toEqual([false, false, false]);
    expect(game().view(s, 0).role).toBe('black');
    s = play(s, [0]);
    expect(game().view(s, 1).exposed).toEqual([true, false, false]);
    expect(game().view(s, 1).revealed).toBeNull();
  });

  it('所有人数、多种种子和两局电脑对弈合法、守恒、零和，AI 候选同样合法', () => {
    const def = game();
    for (const n of [3, 4, 5, 6, 7, 8])
      for (let seed = 1; seed <= 4; seed++) {
        let s = setup(n, 2, seed),
          steps = 0;
        const rng = new Rng(seed);
        while (!def.isOver(s) && steps++ < 3000) {
          const seat = def.activeSeats(s)[0],
            v = def.view(s, seat);
          const action = def.bot(v, seat, rng),
            before = JSON.stringify(s);
          expect(def.validate(s, seat, action)).toBeNull();
          if (steps % 15 === 0)
            for (const o of def.aiPrompt?.(v, seat, rng)?.options ?? [])
              expect(def.validate(s, seat, o.action)).toBeNull();
          const next = def.apply(s, seat, action);
          expect(JSON.stringify(s)).toBe(before);
          s = next;
          const all: Card[] = [...s.hands.flat(), ...s.played];
          expect(all).toHaveLength(n >= 5 ? 108 : 54);
          expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
          expect(s.scores.reduce((a: number, b: number) => a + b, 0)).toBe(0);
        }
        expect(def.isOver(s), `${n}人 seed${seed} 应完成`).toBe(true);
      }
  });
});
