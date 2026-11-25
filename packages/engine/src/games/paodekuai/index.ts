import { cardsText, withRecommended } from '../../core/ai';
import type { Card } from '../../core/cards';
import { createDeck, pickCards, removeCards, sortCards } from '../../core/cards';
import { clone } from '../../core/clone';
import { Rng } from '../../core/rng';
import type { GameDefinition } from '../../core/types';
import { combinations, KIND_NAME, resolvePlay, value } from './patterns';
import type { PdkPattern } from './patterns';
export * from './patterns';

export interface PdkOptions {
  rounds: number;
}
export type PdkAction = { type: 'play'; cards: number[] } | { type: 'pass' } | { type: 'ready' };
export interface PdkResult {
  round: number;
  winner: number;
  deltas: number[];
}
export interface PdkState {
  options: PdkOptions;
  rng: number;
  round: number;
  phase: 'playing' | 'roundOver' | 'matchOver';
  turn: number;
  hands: Card[][];
  opening: boolean;
  lastPlay: { seat: number; cards: Card[]; pattern: PdkPattern } | null;
  lastMoves: ({ type: 'play'; cards: Card[] } | { type: 'pass' } | null)[];
  passes: number;
  played: Card[];
  scores: number[];
  ready: boolean[];
  result: PdkResult | null;
}
export interface PdkView extends Omit<PdkState, 'hands' | 'rng'> {
  seat: number | null;
  hand: Card[];
  handCounts: number[];
  revealed: Card[][] | null;
}

const first = (c: Card) => c.rank === 3 && c.suit === 'S';
const next = (seat: number) => (seat + 1) % 3;
function deal(s: PdkState) {
  const rng = new Rng(s.rng);
  const deck = rng.shuffle(
    createDeck(1, false).filter((c) =>
      c.rank === 2 ? c.suit === 'S' : c.rank !== 14 || c.suit !== 'D',
    ),
  );
  s.rng = rng.state;
  s.hands = [0, 1, 2].map((i) => sortCards(deck.slice(i * 16, i * 16 + 16), value));
  s.turn = s.hands.findIndex((h) => h.some(first));
  s.phase = 'playing';
  s.opening = true;
  s.lastPlay = null;
  s.lastMoves = [null, null, null];
  s.passes = 0;
  s.played = [];
  s.ready = [false, false, false];
  s.result = null;
}

export function legalMoves(v: PdkView): PdkAction[] {
  if (v.seat === null) return [];
  if (v.phase === 'roundOver') return v.ready[v.seat] ? [] : [{ type: 'ready' }];
  if (v.phase !== 'playing' || v.turn !== v.seat) return [];
  const target = v.lastPlay?.pattern ?? null;
  const largest = Math.max(...v.hand.map(value));
  const plays: PdkAction[] = combinations(v.hand, target)
    .filter(({ cards, pattern }) => {
      if (v.opening) return cards.some(first);
      return (
        !!target ||
        v.handCounts[next(v.seat!)] !== 1 ||
        pattern.kind !== 'single' ||
        pattern.main === largest
      );
    })
    .map(({ cards }) => ({ type: 'play', cards: cards.map((c) => c.id).sort((a, b) => a - b) }));
  return plays.length || !target ? plays : [{ type: 'pass' }];
}

export function playError(v: PdkView, ids: number[]): string | null {
  if (v.phase !== 'playing') return '本局已结束';
  if (v.seat !== v.turn) return '还没轮到你';
  if (!Array.isArray(ids) || !ids.length) return '请选择要出的牌';
  const cards = pickCards(v.hand, ids);
  if (!cards) return '请选择自己的手牌，且不可重复';
  if (v.opening && !cards.some(first)) return '首手必须包含黑桃 3';
  const pattern = resolvePlay(cards, v.lastPlay?.pattern ?? null);
  if (!pattern) return v.lastPlay ? '牌型不同或没有大过上家' : '不是有效牌型';
  if (
    !v.opening &&
    !v.lastPlay &&
    v.handCounts[next(v.seat!)] === 1 &&
    pattern.kind === 'single' &&
    pattern.main < Math.max(...v.hand.map(value))
  )
    return '下家报单，领出单张必须出最大单张';
  return null;
}

export const paodekuai: GameDefinition<PdkState, PdkAction, PdkView, PdkOptions> = {
  meta: {
    id: 'paodekuai',
    category: 'poker',
    name: '跑得快',
    nameEn: 'Run Fast',
    tagline: '三人各自为战，有大必压，先出完获胜',
    minPlayers: 3,
    maxPlayers: 3,
    defaultPlayers: 3,
    botDelayMs: [650, 1100],
    rules: [
      '48 张牌：3–K 各四张，三个 A、一个黑桃 2，无大小王。三人每人 16 张，无底牌、不分队。每局黑桃 3 的持有者先出，首手必须含黑桃 3。',
      '牌型：单张、对子、三张、三带任意两张、顺子（≥5 张）、连对（≥2 对）、三顺（≥2 组三张）、飞机带单或对、四张炸弹。2 不参加连续牌型，没有三带一、四带二或王炸。',
      '必须同牌型、同张数且更大才能压过，炸弹能压任何非炸弹。能压必压（包括只能炸时），压不住才可以过牌；两家都过后由最后出牌者重新领出。',
      '领出单张时，若下家只剩一张牌，必须出手里最大的单张；首手包含黑桃 3 的规则优先。',
      '先出完手牌者获胜，另外两家按剩余张数各付分给赢家；16 张一张未出者双倍，不另计炸弹分。局末亮牌，积分零和。',
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
  setup({ options, seed }) {
    const s: PdkState = {
      options: { rounds: [0, 1, 3, 6].includes(options.rounds) ? options.rounds : 3 },
      rng: seed,
      round: 1,
      phase: 'playing',
      turn: 0,
      hands: [],
      opening: true,
      lastPlay: null,
      lastMoves: [],
      passes: 0,
      played: [],
      scores: [0, 0, 0],
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
        ? [0, 1, 2].filter((i) => !s.ready[i])
        : [s.turn],
  validate(s, seat, a) {
    if (a.type === 'ready')
      return s.phase === 'roundOver' && [0, 1, 2].includes(seat) && !s.ready[seat]
        ? null
        : '现在不能准备';
    if (s.phase !== 'playing') return '本局已结束';
    if (seat !== s.turn) return '还没轮到你';
    if (a.type === 'pass') {
      if (!s.lastPlay) return '领出时必须出牌';
      return legalMoves(paodekuai.view(s, seat)).some((m) => m.type === 'play')
        ? '有大必压，不能过牌'
        : null;
    }
    if (a.type !== 'play') return '未知操作';
    return playError(paodekuai.view(s, seat), a.cards);
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
      s.turn = next(seat);
      if (s.passes === 2) {
        s.turn = s.lastPlay!.seat;
        s.lastPlay = null;
        s.passes = 0;
      }
    } else {
      const cards = pickCards(s.hands[seat], a.cards)!;
      const pattern = resolvePlay(cards, s.lastPlay?.pattern ?? null)!;
      if (!s.lastPlay) s.lastMoves = [null, null, null];
      s.hands[seat] = removeCards(s.hands[seat], a.cards)!;
      s.played.push(...cards);
      s.opening = false;
      s.passes = 0;
      s.lastPlay = { seat, cards: sortCards(cards, value), pattern };
      s.lastMoves[seat] = { type: 'play', cards: s.lastPlay.cards };
      if (!s.hands[seat].length) {
        const deltas = s.hands.map((h, i) =>
          i === seat ? 0 : -h.length * (h.length === 16 ? 2 : 1),
        );
        deltas[seat] = -deltas.reduce((sum, d) => sum + d, 0);
        s.scores = s.scores.map((score, i) => score + deltas[i]);
        s.result = { round: s.round, winner: seat, deltas };
        s.phase = s.options.rounds && s.round >= s.options.rounds ? 'matchOver' : 'roundOver';
        s.ready = [false, false, false];
      } else s.turn = next(seat);
    }
    return s;
  },
  view(s, seat) {
    const { hands, rng: _rng, ...publicState } = s;
    return {
      ...publicState,
      seat,
      hand: seat === null ? [] : hands[seat],
      handCounts: hands.map((h) => h.length),
      revealed: s.phase === 'playing' ? null : hands,
    };
  },
  isOver: (s) => s.phase === 'matchOver',
  bot(v) {
    return legalMoves(v).sort((a, b) => {
      if (a.type !== 'play' || b.type !== 'play') return 0;
      const ac = pickCards(v.hand, a.cards)!;
      const bc = pickCards(v.hand, b.cards)!;
      const ap = resolvePlay(ac, v.lastPlay?.pattern ?? null)!;
      const bp = resolvePlay(bc, v.lastPlay?.pattern ?? null)!;
      const cost = (p: PdkPattern, n: number) =>
        (n === v.hand.length ? -10000 : 0) +
        Number(p.kind === 'bomb') * 40 +
        (v.lastPlay ? p.main : p.main - n * 4);
      return cost(ap, ac.length) - cost(bp, bc.length);
    })[0];
  },
  aiPrompt(v, seat, rng) {
    if (v.phase !== 'playing' || v.turn !== seat) return null;
    return {
      situation: `跑得快：三人各自为战，无队友，有大必压，首手带黑桃3。领出时下家报单，单张必须最大。\n你的手牌：${cardsText(v.hand)}\n各家剩牌：${v.handCounts.join('、')}；你为${seat}号位。\n目标：${v.lastPlay ? `${KIND_NAME[v.lastPlay.pattern.kind]} ${cardsText(v.lastPlay.cards)}` : '自由领出'}\n已出牌：${cardsText(v.played)}`,
      options: withRecommended(
        paodekuai.bot(v, seat, rng),
        legalMoves(v).map((a) => ({
          action: a,
          label: a.type === 'play' ? `出 ${cardsText(pickCards(v.hand, a.cards)!)}` : '要不起',
        })),
      ),
    };
  },
};
