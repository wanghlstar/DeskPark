import { cardsText, withRecommended } from '../../core/ai';
import type { Card } from '../../core/cards';
import { createDeck, pickCards, removeCards, sortCards } from '../../core/cards';
import { clone } from '../../core/clone';
import { Rng } from '../../core/rng';
import type { GameDefinition } from '../../core/types';
import { combinations, isBlackAce, KIND_NAME, resolvePlay, value } from './patterns';
import type { HaPattern } from './patterns';
export * from './patterns';

export interface HaOptions {
  rounds: number;
}
export type HaAction = { type: 'play'; cards: number[] } | { type: 'pass' } | { type: 'ready' };
export interface HaResult {
  round: number;
  blackWon: boolean;
  blackSeats: number[];
  winners: number[];
  deltas: number[];
}
export interface HaState {
  options: HaOptions;
  rng: number;
  round: number;
  decks: number;
  firstSeat: number;
  phase: 'playing' | 'roundOver' | 'matchOver';
  turn: number;
  hands: Card[][];
  blackSeats: number[];
  exposed: boolean[];
  finishOrder: number[];
  lastPlay: { seat: number; cards: Card[]; pattern: HaPattern } | null;
  lastMoves: ({ type: 'play'; cards: Card[] } | { type: 'pass' } | null)[];
  passes: number;
  played: Card[];
  scores: number[];
  ready: boolean[];
  result: HaResult | null;
}
export interface HaView extends Omit<HaState, 'hands' | 'rng' | 'blackSeats'> {
  seat: number | null;
  hand: Card[];
  handCounts: number[];
  role: 'black' | 'catcher' | null;
  revealed: Card[][] | null;
}

function deal(s: HaState) {
  const n = s.hands.length,
    rng = new Rng(s.rng),
    deck = rng.shuffle(createDeck(s.decks, true));
  s.rng = rng.state;
  s.hands = Array.from({ length: n }, (_, i) =>
    sortCards(
      deck.filter((_, j) => j % n === i),
      value,
    ),
  );
  s.blackSeats = s.hands.flatMap((h, i) => (h.some(isBlackAce) ? [i] : []));
  s.phase = 'playing';
  s.turn = (s.firstSeat + s.round - 1) % n;
  s.exposed = Array<boolean>(n).fill(false);
  s.finishOrder = [];
  s.lastPlay = null;
  s.lastMoves = Array(n).fill(null);
  s.passes = 0;
  s.played = [];
  s.ready = Array<boolean>(n).fill(false);
  s.result = null;
}
function nextSeat(s: HaState, seat: number) {
  for (let i = 1; i <= s.hands.length; i++) {
    const next = (seat + i) % s.hands.length;
    if (s.hands[next].length) return next;
  }
  return seat;
}
function finish(s: HaState, blackWon: boolean) {
  const black = s.blackSeats.length,
    catchers = s.hands.length - black;
  const deltas = s.hands.map(
    (_, i) => (s.blackSeats.includes(i) ? catchers : -black) * (blackWon ? 1 : -1),
  );
  s.scores = s.scores.map((score, i) => score + deltas[i]);
  const winners = s.hands.flatMap((_, i) => (s.blackSeats.includes(i) === blackWon ? [i] : []));
  s.result = { round: s.round, blackWon, blackSeats: [...s.blackSeats], winners, deltas };
  s.phase = s.options.rounds && s.round >= s.options.rounds ? 'matchOver' : 'roundOver';
}

export function legalMoves(v: HaView): HaAction[] {
  if (v.seat === null) return [];
  if (v.phase === 'roundOver') return v.ready[v.seat] ? [] : [{ type: 'ready' }];
  if (v.phase !== 'playing' || v.turn !== v.seat || !v.hand.length) return [];
  const choices = combinations(v.hand, v.lastPlay?.pattern ?? null).map(({ cards, pattern }) => ({
    action: { type: 'play', cards: cards.map((c) => c.id) } as HaAction,
    score: cards.length === v.hand.length ? -10000 : pattern.main - cards.length * 4,
  }));
  if (v.lastPlay) {
    const ally = v.role === 'black' && v.exposed[v.lastPlay.seat];
    choices.push({ action: { type: 'pass' }, score: ally ? -100 : 100 });
  }
  return choices.sort((a, b) => a.score - b.score).map((c) => c.action);
}
export function playError(v: HaView, ids: number[]): string | null {
  if (v.phase !== 'playing') return '本局已结束';
  if (v.seat !== v.turn || !v.hand.length) return '还没轮到你';
  if (!Array.isArray(ids) || !ids.length) return '请选择要出的牌';
  const cards = pickCards(v.hand, ids);
  if (!cards) return '请选择自己的手牌，且不可重复';
  if (!resolvePlay(cards, v.lastPlay?.pattern ?? null))
    return '需要同牌型、同张数且更大；本玩法无炸弹';
  return null;
}

export const zhuoheia: GameDefinition<HaState, HaAction, HaView, HaOptions> = {
  meta: {
    id: 'zhuoheia',
    category: 'poker',
    name: '捉黑 A',
    nameEn: 'Catch the Black Ace',
    tagline: '河南玩法 · 藏好黑桃 A，别被留到最后',
    minPlayers: 3,
    maxPlayers: 8,
    defaultPlayers: 3,
    botDelayMs: [650, 1100],
    rules: [
      '3–4 人一副 54 张，5–8 人两副 108 张，含大小王；全部轮流发完，无底牌，各家最多相差一张。首局随机首家，之后顺次轮换。',
      '只有黑桃 A 是隐藏身份：持有者为黑 A 方，其余人为捉 A 方。两副牌的黑桃 A 持有者同队；同一人拿两张则独战。未出黑桃 A 前不公开身份。',
      '单张大小：黑桃 A > 大王 > 小王 > 3 > 2 > 其他 A > K > Q > J > 10…4。不设炸弹和王炸，黑桃 A 单张不能压不同牌型。',
      '可出单张、对子、三张、三带二、顺子（至少五张）、连对（至少两对）、三顺和飞机带单/对；连续牌只使用 4 到普通 A，2、3、王、黑桃 A 不参加连续牌。',
      '跟牌必须同型、同张数且更大，可以主动过牌。跳过已出完的玩家；其余在局玩家都过后，原出牌者领出，若他已出完则由下一位未走玩家领出。',
      '任意黑 A 玩家提前出完，黑 A 方立即同赢；普通玩家先出完仍继续，直到全部普通玩家出完才算捉住黑 A。局末公开身份和剩牌，无进贡；双方按人数结算零和积分。',
    ],
  },
  defaultOptions: { rounds: 3 },
  optionFields: [
    {
      key: 'rounds',
      label: '局数',
      type: 'select',
      choices: [
        { value: 1, label: '1 局' },
        { value: 3, label: '3 局' },
        { value: 6, label: '6 局' },
        { value: 0, label: '不限' },
      ],
    },
  ],
  setup({ players, options, seed }) {
    const rng = new Rng(seed),
      firstSeat = rng.int(players.length);
    const s: HaState = {
      options: { rounds: [0, 1, 3, 6].includes(options.rounds) ? options.rounds : 3 },
      rng: rng.state,
      firstSeat,
      round: 1,
      decks: players.length >= 5 ? 2 : 1,
      phase: 'playing',
      turn: 0,
      hands: players.map(() => []),
      blackSeats: [],
      exposed: [],
      finishOrder: [],
      lastPlay: null,
      lastMoves: [],
      passes: 0,
      played: [],
      scores: players.map(() => 0),
      ready: [],
      result: null,
    };
    deal(s);
    return s;
  },
  activeSeats: (s) =>
    s.phase === 'matchOver'
      ? []
      : s.phase === 'roundOver'
        ? s.ready.flatMap((ready, i) => (ready ? [] : [i]))
        : [s.turn],
  validate(s, seat, a) {
    if (a.type === 'ready')
      return s.phase === 'roundOver' && seat >= 0 && seat < s.hands.length && !s.ready[seat]
        ? null
        : '现在不能准备';
    if (s.phase !== 'playing') return '本局已结束';
    if (seat !== s.turn || !s.hands[seat]?.length) return '还没轮到你';
    if (a.type === 'pass') return s.lastPlay ? null : '领出时必须出牌';
    if (a.type !== 'play') return '未知操作';
    return playError(zhuoheia.view(s, seat), a.cards);
  },
  apply(prev, seat, a) {
    const s = clone(prev);
    if (a.type === 'ready') {
      s.ready[seat] = true;
      if (s.ready.every(Boolean)) {
        s.round++;
        deal(s);
      }
    } else if (a.type === 'pass') {
      s.lastMoves[seat] = { type: 'pass' };
      s.passes++;
      const last = s.lastPlay!.seat;
      const responders = s.hands.filter((h, i) => h.length && i !== last).length;
      if (s.passes >= responders) {
        s.turn = s.hands[last].length ? last : nextSeat(s, last);
        s.lastPlay = null;
        s.passes = 0;
      } else s.turn = nextSeat(s, seat);
    } else {
      const cards = pickCards(s.hands[seat], a.cards)!;
      const pattern = resolvePlay(cards, s.lastPlay?.pattern ?? null)!;
      if (!s.lastPlay) s.lastMoves = s.hands.map(() => null);
      s.hands[seat] = removeCards(s.hands[seat], a.cards)!;
      s.played.push(...cards);
      if (cards.some(isBlackAce)) s.exposed[seat] = true;
      s.lastPlay = { seat, cards: sortCards(cards, value), pattern };
      s.lastMoves[seat] = { type: 'play', cards: s.lastPlay.cards };
      s.passes = 0;
      if (!s.hands[seat].length) {
        s.finishOrder.push(seat);
        if (s.blackSeats.includes(seat)) finish(s, true);
        else if (s.hands.every((h, i) => !h.length || s.blackSeats.includes(i))) finish(s, false);
      }
      if (s.phase === 'playing') s.turn = nextSeat(s, seat);
    }
    return s;
  },
  view(s, seat) {
    const { hands, rng: _rng, blackSeats, ...publicState } = s;
    return {
      ...publicState,
      seat,
      hand: seat === null ? [] : hands[seat],
      handCounts: hands.map((h) => h.length),
      role: seat === null ? null : blackSeats.includes(seat) ? 'black' : 'catcher',
      revealed: s.phase === 'playing' ? null : hands,
    };
  },
  isOver: (s) => s.phase === 'matchOver',
  bot: (v) => legalMoves(v)[0],
  aiPrompt(v, seat) {
    if (v.phase !== 'playing' || v.turn !== seat) return null;
    const moves = legalMoves(v);
    return {
      situation: `河南捉黑A：黑桃A>大王>小王>3>2>其他A>K…4，无炸弹；可主动过牌。你的秘密身份：${v.role === 'black' ? '黑A方，任意黑A提前跑掉同赢' : '捉A方，要让黑A留到最后'}。不要在发言中透露自己的身份或手牌，不知道其他未公开的黑A位置。\n手牌：${cardsText(v.hand)}\n各家剩牌：${v.handCounts.join('、')}；你为${seat}号。已公开黑A：${v.exposed.flatMap((b, i) => (b ? [i] : [])).join('、') || '无'}\n目标：${v.lastPlay ? `${v.lastPlay.seat}号 ${KIND_NAME[v.lastPlay.pattern.kind]} ${cardsText(v.lastPlay.cards)}` : '自由领出'}\n已出牌：${cardsText(v.played)}`,
      options: withRecommended(
        moves[0],
        moves.map((action) => ({
          action,
          label:
            action.type === 'play' ? `出 ${cardsText(pickCards(v.hand, action.cards)!)}` : '过牌',
        })),
      ),
    };
  },
};
