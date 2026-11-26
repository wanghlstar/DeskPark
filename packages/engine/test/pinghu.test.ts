import { describe, expect, it } from 'vitest';
import { Rng, getGame, heluogangci, hl } from '../src';

type State = hl.HlState;
type Action = hl.HlAction;
const game = () => {
  const def = getGame('pinghu') as typeof heluogangci;
  expect(def, '普通麻将应注册为独立玩法').toBeDefined();
  return def;
};

class Pool {
  used = new Set<number>();
  tiles(spec: string) {
    const out: hl.HlTile[] = [];
    for (const [, digits, suit] of spec.matchAll(/([1-9]+)([mspz])/g)) {
      for (const digit of digits) {
        const kind = { m: 0, s: 9, p: 18, z: 27 }[suit]! + Number(digit) - 1;
        const tile = hl.createHlTiles().find((t) => t.kind === kind && !this.used.has(t.id));
        if (!tile) throw new Error(`没有可用的 ${digit}${suit}`);
        this.used.add(tile.id);
        out.push(tile);
      }
    }
    return out;
  }
}

function base(hands?: string[]): State {
  const def = game();
  const s = def.setup({
    players: [0, 1, 2, 3].map((i) => ({ name: `P${i}`, isBot: true })),
    options: { ...def.defaultOptions, rounds: 1 },
    seed: 7,
  });
  if (hands) {
    const pool = new Pool();
    s.players.forEach((p, i) => {
      p.hand = pool.tiles(hands[i] ?? '');
    });
    s.wall = hl.createHlTiles().filter((t) => !pool.used.has(t.id));
  }
  return s;
}

function act(s: State, seat: number, action: Action): State {
  const def = game();
  expect(def.validate(s, seat, action)).toBeNull();
  const saved = JSON.stringify(s);
  const next = def.apply(s, seat, action);
  expect(JSON.stringify(s), 'apply 不修改输入').toBe(saved);
  return next;
}

function claims(s: State, choices: Record<number, Action>): State {
  while (s.window) {
    const seat = game().activeSeats(s)[0];
    s = act(s, seat, choices[seat] ?? { type: 'pass' });
  }
  return s;
}

describe('普通麻将 · 136 张基础规则', () => {
  it('带全部字牌，不亮次牌、不换三张、不定缺，庄家直接出牌', () => {
    const s = base();
    expect(s.phase).toBe('play');
    expect(s.players.map((p) => p.hand.length)).toEqual([14, 13, 13, 13]);
    expect(s.wall).toHaveLength(83);
    expect(s.ciTile).toBeNull();
    expect(s.ciKind).toBe(-1);
    const tiles = [...s.wall, ...s.players.flatMap((p) => p.hand)];
    expect(new Set(tiles.map((t) => t.id)).size).toBe(136);
    for (let kind = 0; kind < 34; kind++)
      expect(tiles.filter((t) => t.kind === kind)).toHaveLength(4);
    expect(game().activeSeats(s)).toEqual([s.dealer]);
    expect(hl.legalOf(s, s.dealer).discard).toHaveLength(14);
  });

  it('标准牌型可自摸，一家胡后结算，三家各付 1 分', () => {
    const s = base(['123m456s789p111z22z']);
    expect(hl.legalOf(s, 0).hu).toBe(true);
    const next = act(s, 0, { type: 'hu' });
    expect(next.phase).toBe('matchOver');
    expect(next.result?.win?.kind).toBe('zimo');
    expect(next.scores).toEqual([3, -1, -1, -1]);
    expect(next.result?.nextDealer).toBe(0);
    expect(hl.legalOf(next, 1).discard).toEqual([]);
  });

  it('字牌不能凑顺子，散牌和非标准牌型不能胡', () => {
    for (const spec of ['123m456s789p123z22m', '112244m3355s6677p']) {
      const s = base([spec]);
      expect(hl.legalOf(s, 0).hu).toBe(false);
      expect(game().validate(s, 0, { type: 'hu' })).toBeTruthy();
      expect(hl.legalOf(s, 0).pici).toBe(false);
    }
  });

  it('支持点炮，只有放炮者付 1 分', () => {
    let s = base(['2z', '123m456s789p111z2z']);
    s = act(s, 0, { type: 'discard', tile: s.players[0].hand[0].id });
    expect(hl.legalOf(s, 1).hu).toBe(true);
    s = claims(s, { 1: { type: 'hu' } });
    expect(s.phase).toBe('matchOver');
    expect(s.result?.win).toMatchObject({ seat: 1, from: 0, kind: 'dianpao' });
    expect(s.scores).toEqual([-1, 1, 0, 0]);
  });

  it('胡牌优先于碰杠，不受提交决定先后的影响', () => {
    let s = base(['9p', '999p147m258s1234z', '123m456s78p111z22z']);
    s = act(s, 0, { type: 'discard', tile: s.players[0].hand[0].id });
    expect(hl.legalOf(s, 1).gang).toHaveLength(1);
    expect(hl.legalOf(s, 2).hu).toBe(true);
    s = claims(s, { 1: { type: 'gang' }, 2: { type: 'hu' } });
    expect(s.result?.win?.seat).toBe(2);
    expect(s.players[1].melds).toHaveLength(0);
  });

  it('多人可胡同一张时，按出牌顺序截胡', () => {
    let s = base(['2z', '123m456s789p111z2z', '456m123s456p333z2z']);
    s = act(s, 0, { type: 'discard', tile: s.players[0].hand[0].id });
    expect(hl.legalOf(s, 1).hu).toBe(true);
    expect(hl.legalOf(s, 2).hu).toBe(true);
    s = act(s, 2, { type: 'hu' });
    s = act(s, 1, { type: 'hu' });
    expect(s.result?.win?.seat).toBe(1);
    expect(s.scores).toEqual([-1, 1, 0, 0]);
  });

  it('碰后必须出牌，不能马上自摸或加杠', () => {
    let s = base(['1z', '11z123m456s789p22z']);
    s = act(s, 0, { type: 'discard', tile: s.players[0].hand[0].id });
    s = claims(s, { 1: { type: 'peng' } });
    expect(s.players[1].melds[0].type).toBe('pung');
    expect(hl.legalOf(s, 1).discard).toHaveLength(11);
    expect(hl.legalOf(s, 1).hu).toBe(false);
    expect(hl.legalOf(s, 1).gang).toEqual([]);
  });

  it('明杠后从牌尾补一张，不亮次牌、不另计杠分', () => {
    let s = base(['1z', '111z123m456s789p2z']);
    const tail = s.wall.at(-1)!;
    const count = s.wall.length;
    s = act(s, 0, { type: 'discard', tile: s.players[0].hand[0].id });
    s = claims(s, { 1: { type: 'gang' } });
    expect(s.players[1].melds[0]).toMatchObject({ type: 'kong', kongType: 'ming' });
    expect(s.drawnThisTurn).toBe(tail.id);
    expect(s.wall).toHaveLength(count - 1);
    expect(s.gangDeltas).toEqual([0, 0, 0, 0]);
    expect(s.phase).toBe('play');
  });

  it('暗杠后补牌，空牌墙不能再杠', () => {
    const s = base(['1111z123m456s789p2z']);
    const tail = s.wall.at(-1)!;
    const tile = s.players[0].hand[0].id;
    expect(hl.legalOf(s, 0).gang[0]).toMatchObject({ type: 'an', ci: false });
    const next = act(s, 0, { type: 'gang', tile });
    expect(next.players[0].melds[0].kongType).toBe('an');
    expect(next.drawnThisTurn).toBe(tail.id);
    expect(next.gangDeltas).toEqual([0, 0, 0, 0]);
    s.wall = [];
    expect(hl.legalOf(s, 0).gang).toEqual([]);
  });

  it('碰后摸到第四张可补杠', () => {
    const s = base(['1z123m456s789p2z']);
    const tiles = Array.from({ length: 3 }, (_, i) => hl.hlTileOf(27 * 4 + i + 1));
    s.players[0].melds = [{ type: 'pung', kind: 27, tiles, from: 1, pengFrom: 1 }];
    s.wall = s.wall.filter((t) => !tiles.some((x) => x.id === t.id));
    const next = act(s, 0, { type: 'gang', tile: s.players[0].hand[0].id });
    expect(next.players[0].melds[0]).toMatchObject({ type: 'kong', kongType: 'ba' });
    expect(next.players[0].melds[0].tiles).toHaveLength(4);
    expect(next.gangDeltas).toEqual([0, 0, 0, 0]);
  });

  it('最后一张弃牌仍可点炮；无人胡则荒庄不计分', () => {
    let s = base(['2z', '123m456s789p111z2z']);
    s.wall = [];
    s = act(s, 0, { type: 'discard', tile: s.players[0].hand[0].id });
    const passed = claims(s, {});
    expect(passed.result?.reason).toBe('wall');
    expect(passed.scores).toEqual([0, 0, 0, 0]);
    expect(claims(s, { 1: { type: 'hu' } }).result?.reason).toBe('win');
  });

  it('联机视图不暴露牌墙和对手手牌', () => {
    const s = base();
    for (const seat of [null, 0, 1, 2, 3]) {
      const v = game().view(s, seat);
      expect(v.hand).toHaveLength(seat === null ? 0 : s.players[seat].hand.length);
      expect(v.players.every((p) => p.hand === null)).toBe(true);
      expect(v).not.toHaveProperty('wall');
    }
  });

  it('电脑完整对局：所有动作合法、136 张守恒、结算平衡', () => {
    const def = game();
    for (let seed = 1; seed <= 20; seed++) {
      let s = def.setup({ players: [], options: { ...def.defaultOptions, rounds: 2 }, seed });
      const rng = new Rng(seed);
      for (let step = 0; step < 2000 && !def.isOver(s); step++) {
        const seat = def.activeSeats(s)[0];
        const view = def.view(s, seat);
        const action = def.bot(view, seat, rng);
        expect(def.validate(s, seat, action)).toBeNull();
        s = def.apply(s, seat, action);
        const tiles = [
          ...s.wall,
          ...s.players.flatMap((p) => [
            ...p.hand,
            ...p.melds.flatMap((m) => m.tiles),
            ...p.river.filter((r) => !r.claimedBy?.length).map((r) => r.tile),
          ]),
        ];
        expect(tiles).toHaveLength(136);
        expect(new Set(tiles.map((t) => t.id)).size).toBe(136);
        expect(s.scores.reduce((a, b) => a + b, 0)).toBe(0);
      }
      expect(s.phase).toBe('matchOver');
    }
  });
});
