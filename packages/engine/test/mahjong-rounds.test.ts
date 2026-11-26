import { describe, expect, it } from 'vitest';
import { heluogangci, hl, pinghu } from '../src';

for (const def of [pinghu, heluogangci]) {
  const setup = (rounds: number, round = rounds || 1) => {
    const s = def.setup({ players: [], options: { ...def.defaultOptions, rounds }, seed: 7 });
    s.round = round;
    return s;
  };
  const act = (s: hl.HlState, seat: number, action: hl.HlAction) => {
    expect(def.validate(s, seat, action)).toBeNull();
    const before = JSON.stringify(s);
    const next = def.apply(s, seat, action);
    expect(JSON.stringify(s)).toBe(before);
    return next;
  };
  const win = (s: hl.HlState) => {
    const tiles = hl.createHlTiles().filter((t) => t.id !== s.ciTile?.id);
    s.players[0].hand = [0, 1, 2, 12, 13, 14, 24, 25, 26, 27, 27, 27, 28, 28].map(
      (kind) =>
        tiles.splice(
          tiles.findIndex((t) => t.kind === kind),
          1,
        )[0],
    );
    for (let i = 1; i < 4; i++) s.players[i].hand = tiles.splice(0, 13);
    s.wall = tiles;
    s.turn = 0;
    s.turnDrawn = true;
    s.drawnThisTurn = s.players[0].hand.at(-1)!.id;
    return act(s, 0, { type: 'hu' });
  };

  describe(`${def.meta.name} · 盘数与最终结算`, () => {
    it.each([1, 4, 8])('%i 盘打完后直接结束本场，不需要额外准备', (rounds) => {
      const s = win(setup(rounds));
      expect(s.phase).toBe('matchOver');
      expect(def.isOver(s)).toBe(true);
      expect(def.activeSeats(s)).toEqual([]);
      expect(s.round).toBe(rounds);
      expect(s.result).toMatchObject({ round: rounds, reason: 'win', win: { seat: 0 } });
      expect(s.scores).toEqual(s.result!.deltas);
      for (let seat = 0; seat < 4; seat++) {
        expect(def.view(s, seat).legal?.ready).toBe(false);
        expect(def.validate(s, seat, { type: 'ready' })).toBeTruthy();
      }
    });

    it.each([1, 4, 8])('%i 盘最后荒庄也直接结束并保留结算', (rounds) => {
      let s = setup(rounds);
      s.wall = [];
      s = act(s, s.turn, { type: 'discard', tile: s.players[s.turn].hand[0].id });
      while (s.window) s = act(s, def.activeSeats(s)[0], { type: 'pass' });
      expect(s.phase).toBe('matchOver');
      expect(def.isOver(s)).toBe(true);
      expect(s.result).toMatchObject({ round: rounds, reason: 'wall', deltas: [0, 0, 0, 0] });
      expect(def.activeSeats(s)).toEqual([]);
    });

    it('未到设定盘数时仍等四家准备，然后进入下一盘', () => {
      let s = win(setup(4, 1));
      const scores = [...s.scores];
      expect(s.phase).toBe('roundOver');
      expect(def.isOver(s)).toBe(false);
      for (const seat of [0, 1, 2]) s = act(s, seat, { type: 'ready' });
      expect(s.round).toBe(1);
      expect(s.phase).toBe('roundOver');
      s = act(s, 3, { type: 'ready' });
      expect(s.phase).toBe('play');
      expect(s.round).toBe(2);
      expect(s.result).toBeNull();
      expect(s.scores).toEqual(scores);
    });

    it('不限盘数保持逐盘准备，不会提前结束', () => {
      let s = win(setup(0, 20));
      expect(s.phase).toBe('roundOver');
      for (let seat = 0; seat < 4; seat++) s = act(s, seat, { type: 'ready' });
      expect(s.phase).toBe('play');
      expect(s.round).toBe(21);
    });

    it('兼容旧版本已停在最后一盘局间结算的状态', () => {
      let s = win(setup(4));
      s.phase = 'roundOver';
      for (let seat = 0; seat < 4; seat++) s = act(s, seat, { type: 'ready' });
      expect(s.phase).toBe('matchOver');
      expect(s.round).toBe(4);
      expect(s.result?.reason).toBe('win');
    });
  });
}
