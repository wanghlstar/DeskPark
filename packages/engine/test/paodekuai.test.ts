import { describe, expect, it } from 'vitest';
import type { Card } from '../src';
import { getGame, pdk, Rng } from '../src';

function game() {
  const def = getGame('paodekuai');
  expect(def, '跑得快应注册为独立玩法').toBeDefined();
  return def!;
}
function setup(rounds = 1, seed = 8) {
  return game().setup({
    players: [0, 1, 2].map((i) => ({ name: `P${i}`, isBot: true })),
    options: { rounds },
    seed,
  });
}
const cards = (values: number[], offset = 0): Card[] =>
  values.map((v, i) => ({
    id: offset + i,
    rank: v === 15 ? 2 : v,
    suit: 'S',
  }));
function rig(hands: number[][]) {
  const s = setup();
  s.hands = hands.map((values, i) => cards(values, 100 * i));
  s.turn = 0;
  s.opening = false;
  return s;
}
function play(s: ReturnType<typeof setup>, ids = s.hands[s.turn].map((c: Card) => c.id)) {
  const def = game();
  const before = JSON.stringify(s);
  const action = { type: 'play', cards: ids };
  expect(def.validate(s, s.turn, action)).toBeNull();
  const next = def.apply(s, s.turn, action);
  expect(JSON.stringify(s)).toBe(before);
  return next;
}

describe('跑得快（48 张）', () => {
  it('每人 16 张，三 A 一 2 无王，黑桃 3 持有者先出', () => {
    const s = setup();
    expect(s.hands.map((h: Card[]) => h.length)).toEqual([16, 16, 16]);
    const deck: Card[] = s.hands.flat();
    expect(new Set(deck.map((c) => c.id)).size).toBe(48);
    expect(deck.filter((c) => c.rank === 14)).toHaveLength(3);
    expect(deck.filter((c) => c.rank === 2)).toHaveLength(1);
    expect(deck.some((c) => c.suit === 'J')).toBe(false);
    expect(s.hands[s.turn]).toContainEqual(expect.objectContaining({ rank: 3, suit: 'S' }));
    const hand: Card[] = s.hands[s.turn];
    const notThree = hand.find((c) => c.rank !== 3)!;
    expect(game().validate(s, s.turn, { type: 'play', cards: [notThree.id] })).toContain('黑桃 3');
    expect(setup()).toEqual(s);
  });

  it.each([
    [3],
    [4, 4],
    [5, 5, 5],
    [6, 6, 6, 6],
    [3, 3, 3, 4, 5],
    [3, 3, 3, 4, 4],
    [3, 4, 5, 6, 7],
    [3, 3, 4, 4],
    [3, 3, 3, 4, 4, 4],
    [3, 3, 3, 4, 4, 4, 5, 6],
    [3, 3, 3, 4, 4, 4, 5, 5, 6, 6],
    [3, 3, 3, 3, 4, 4, 4, 5],
  ])('识别合法牌型 %j', (...values) => {
    const s = rig([values, [15, 13], [14, 12]]);
    expect(
      game().validate(s, 0, { type: 'play', cards: s.hands[0].map((c: Card) => c.id) }),
    ).toBeNull();
  });

  it.each([
    [3, 4],
    [3, 3, 3, 4],
    [3, 3, 3, 3, 4, 5],
    [11, 12, 13, 14, 15],
    [3, 3, 5, 5],
    [3, 4, 5, 6],
    [3, 3, 3, 3, 3],
  ])('拒绝非法牌型 %j', (...values) => {
    const s = rig([values, [15, 13], [14, 12]]);
    expect(
      game().validate(s, 0, { type: 'play', cards: s.hands[0].map((c: Card) => c.id) }),
    ).toBeTruthy();
  });

  it('有大必压，包括只能使用炸弹时；压不住才允许过牌', () => {
    const def = game();
    let s = play(
      rig([
        [8, 3],
        [9, 4],
        [7, 6],
      ]),
      [0],
    );
    expect(def.validate(s, 1, { type: 'pass' })).toContain('必压');
    s.hands[1] = cards([4, 4, 4, 4, 3], 100);
    expect(def.validate(s, 1, { type: 'pass' })).toContain('必压');
    s = play(s, [100, 101, 102, 103]);
    expect(def.validate(s, 2, { type: 'pass' })).toBeNull();
  });

  it('同型同长度才能压牌，炸弹压非炸弹，连续两家过后原出牌者领出', () => {
    const def = game();
    let s = play(
      rig([
        [10, 10, 3],
        [8, 8, 4],
        [9, 9, 5],
      ]),
      [0, 1],
    );
    expect(def.validate(s, 1, { type: 'play', cards: [100] })).toBeTruthy();
    s = def.apply(s, 1, { type: 'pass' });
    expect(def.validate(s, 2, { type: 'pass' })).toBeNull();
    s = def.apply(s, 2, { type: 'pass' });
    expect(s.turn).toBe(0);
    expect(s.lastPlay).toBeNull();
  });

  it('纯三顺按完整三顺识别，不把多出的三张重新解释为飞机翅膀', () => {
    const s = rig([
      [3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 7, 8, 15],
      [4, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 9],
      [12, 13],
    ]);
    const next = play(
      s,
      Array.from({ length: 12 }, (_, i) => i),
    );
    expect(
      game().validate(next, 1, {
        type: 'play',
        cards: Array.from({ length: 12 }, (_, i) => i + 100),
      }),
    ).toBeTruthy();
    expect(pdk.resolvePlay(cards([3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6]), null)?.kind).toBe('plane');
  });

  it('领出单张且下家报单时必须出最大单张，首手仍优先包含黑桃 3', () => {
    const def = game();
    const s = rig([[3, 10, 15], [8], [9, 9]]);
    expect(def.validate(s, 0, { type: 'play', cards: [0] })).toContain('最大');
    expect(def.validate(s, 0, { type: 'play', cards: [2] })).toBeNull();
    s.opening = true;
    expect(def.validate(s, 0, { type: 'play', cards: [0] })).toBeNull();
  });

  it('不能出别人的牌、重复牌或错误座位，领出不能过牌', () => {
    const def = game();
    const s = rig([
      [3, 3],
      [4, 4],
      [5, 5],
    ]);
    for (const ids of [[], [100], [0, 0], [-1]])
      expect(def.validate(s, 0, { type: 'play', cards: ids })).toBeTruthy();
    expect(def.validate(s, 1, { type: 'play', cards: [100] })).toBeTruthy();
    expect(def.validate(s, 0, { type: 'pass' })).toBeTruthy();
  });

  it('赢家收剩牌分，16 张未出者双倍；准备齐后重新发牌', () => {
    const def = game();
    const s = rig([[15], [3, 4, 5], Array(16).fill(6)]);
    s.options.rounds = 2;
    let next = play(s);
    expect(next.result.deltas).toEqual([35, -3, -32]);
    expect(next.scores.reduce((a: number, b: number) => a + b, 0)).toBe(0);
    expect(next.phase).toBe('roundOver');
    for (const seat of [2, 0, 1]) {
      expect(def.validate(next, seat, { type: 'ready' })).toBeNull();
      next = def.apply(next, seat, { type: 'ready' });
    }
    expect(next.round).toBe(2);
    expect(next.hands.every((h: Card[]) => h.length === 16)).toBe(true);
  });

  it('对手和观战者只能看到牌数，结算后才亮手牌', () => {
    const def = game();
    const s = setup();
    for (const seat of [0, 1, 2, null]) {
      const v = def.view(s, seat);
      expect(v.hand).toEqual(seat === null ? [] : s.hands[seat]);
      expect(v).not.toHaveProperty('hands');
      expect(v).not.toHaveProperty('rng');
      expect(v.revealed).toBeNull();
    }
    expect(def.view(play(rig([[15], [3, 4], [5, 6]])), 0).revealed).not.toBeNull();
  });

  it('20 种种子电脑完成三局，逐手检查合法性、不变性和 48 张牌守恒', () => {
    const def = game();
    for (let seed = 1; seed <= 20; seed++) {
      let s = setup(3, seed);
      const rng = new Rng(seed);
      let steps = 0;
      while (!def.isOver(s) && steps++ < 600) {
        const seat = def.activeSeats(s)[0];
        const a = def.bot(def.view(s, seat), seat, rng);
        const before = JSON.stringify(s);
        expect(def.validate(s, seat, a)).toBeNull();
        const next = def.apply(s, seat, a);
        expect(JSON.stringify(s)).toBe(before);
        s = next;
        const deck: Card[] = [...s.hands.flat(), ...s.played];
        expect(deck).toHaveLength(48);
        expect(new Set(deck.map((c) => c.id)).size).toBe(48);
      }
      expect(s.phase).toBe('matchOver');
      expect(s.scores.reduce((a: number, b: number) => a + b, 0)).toBe(0);
    }
  });

  it('候选生成覆盖小手牌全部合法点数组合，包括三带散牌和飞机第四张作翅膀', () => {
    const def = game();
    for (const values of [
      [3, 3, 3, 3, 4, 4, 4, 5, 6, 7],
      [3, 3, 4, 4, 5, 5, 6, 7, 8, 9],
    ]) {
      for (const target of [null, pdk.resolvePlay(cards([3, 3, 3, 4, 4, 4, 5, 6]), null)]) {
        const s = rig([values, [12, 13], [14, 15]]);
        if (target) s.lastPlay = { seat: 2, cards: [], pattern: target };
        const key = (hand: Card[]) =>
          hand
            .map(pdk.value)
            .sort((a, b) => a - b)
            .join(',');
        const generated = new Set(
          pdk
            .legalMoves(def.view(s, 0))
            .flatMap((a) =>
              a.type === 'play'
                ? [key(s.hands[0].filter((c: Card) => a.cards.includes(c.id)))]
                : [],
            ),
        );
        const expected = new Set<string>();
        for (let mask = 1; mask < 1 << values.length; mask++) {
          const hand: Card[] = s.hands[0].filter((_: Card, i: number) => mask & (1 << i));
          if (!def.validate(s, 0, { type: 'play', cards: hand.map((c) => c.id) }))
            expected.add(key(hand));
        }
        expect(generated).toEqual(expected);
      }
    }
  });
});
