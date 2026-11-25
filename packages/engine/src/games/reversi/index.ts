import { withRecommended } from '../../core/ai';
import { clone } from '../../core/clone';
import { Rng } from '../../core/rng';
import type { GameDefinition } from '../../core/types';
import { bestMove, initialBoard, legalOf, placed } from './board';

export interface RvOptions {
  level: number;
  side: string;
}
export type RvAction = { type: 'place'; at: number } | { type: 'undo' } | { type: 'resign' };
export interface RvState {
  options: RvOptions;
  board: number[];
  colors: number[];
  bots: boolean[];
  turn: number;
  moves: { at: number; color: number }[];
  skipped: number | null;
  phase: 'play' | 'over';
  result: { winner: number | null; reason: 'nomoves' | 'resign' } | null;
}
export interface RvView extends Omit<RvState, 'bots'> {
  seat: number | null;
  legal: number[];
  canUndo: boolean;
}

const canUndo = (s: RvState, seat: number) =>
  s.phase === 'play' &&
  s.turn === seat &&
  !s.bots[seat] &&
  s.bots[1 - seat] &&
  s.moves.some((m) => m.color === s.colors[seat]);
const coordinate = (at: number) => `${String.fromCharCode(65 + (at % 8))}${8 - Math.floor(at / 8)}`;
function play(s: RvState, at: number) {
  const color = s.colors[s.turn];
  s.board = placed(s.board, at, color);
  s.moves.push({ at, color });
  s.skipped = null;
  if (legalOf(s.board, 3 - color).length) s.turn = 1 - s.turn;
  else if (legalOf(s.board, color).length) s.skipped = 1 - s.turn;
  else {
    const counts = s.colors.map((p) => s.board.filter((c) => c === p).length);
    s.phase = 'over';
    s.result = {
      winner: counts[0] === counts[1] ? null : counts[0] > counts[1] ? 0 : 1,
      reason: 'nomoves',
    };
  }
}

export const reversi: GameDefinition<RvState, RvAction, RvView, RvOptions> = {
  meta: {
    id: 'reversi',
    category: 'chess',
    name: '黑白棋',
    nameEn: 'Reversi',
    tagline: '夹吃翻转，占住四角，终局棋子多者胜',
    minPlayers: 2,
    maxPlayers: 2,
    defaultPlayers: 2,
    botDelayMs: [500, 900],
    turnTimeoutMs: 120000,
    rules: [
      '8×8 棋盘，中央各两枚黑白棋子，黑方先走。每次在空格落子，必须在横、竖或斜向夹住至少一枚对方棋子。',
      '落子后翻转八个方向中被自己棋子夹住的全部对方棋子，不能跳过空格或自己的棋子。界面圆点标出可落子的位置。',
      '没有合法位置时自动让行；对方仍能走则继续。双方都不能走时结束（不一定满盘），棋子多的一方获胜，相同则和棋。',
      '提供三档电脑；人机局轮到自己时可以悔棋，也可在自己回合认输。',
    ],
  },
  defaultOptions: { level: 2, side: 'black' },
  optionFields: [
    {
      key: 'level',
      label: '电脑强度',
      type: 'select',
      choices: [
        { value: 1, label: '入门' },
        { value: 2, label: '普通' },
        { value: 3, label: '困难' },
      ],
    },
    {
      key: 'side',
      label: '执子',
      hint: '单人时是你执的颜色；联机时指 1 号位',
      type: 'select',
      choices: [
        { value: 'black', label: '黑方（先走）' },
        { value: 'white', label: '白方' },
        { value: 'random', label: '随机' },
      ],
    },
  ],
  setup({ players, options, seed }) {
    const black =
      options.side === 'white'
        ? false
        : options.side === 'random'
          ? new Rng(seed).int(2) === 0
          : true;
    return {
      options: { level: [1, 2, 3].includes(options.level) ? options.level : 2, side: options.side },
      board: initialBoard(),
      colors: black ? [1, 2] : [2, 1],
      bots: players.map((p) => p.isBot),
      turn: black ? 0 : 1,
      moves: [],
      skipped: null,
      phase: 'play',
      result: null,
    };
  },
  activeSeats: (s) => (s.phase === 'play' ? [s.turn] : []),
  validate(s, seat, a) {
    if (s.phase !== 'play') return '对局已结束';
    if (seat !== s.turn) return '还没轮到你';
    if (a.type === 'resign') return null;
    if (a.type === 'undo') return canUndo(s, seat) ? null : '现在不能悔棋';
    if (a.type !== 'place') return '未知操作';
    return legalOf(s.board, s.colors[seat]).includes(a.at) ? null : '此处不能夹住对手棋子';
  },
  apply(prev, seat, a) {
    const s = clone(prev);
    if (a.type === 'resign') {
      s.phase = 'over';
      s.result = { winner: 1 - seat, reason: 'resign' };
    } else if (a.type === 'undo') {
      let cut = s.moves.length - 1;
      while (s.moves[cut].color !== s.colors[seat]) cut--;
      const keep = s.moves.slice(0, cut);
      s.board = initialBoard();
      s.moves = [];
      s.turn = s.colors.indexOf(1);
      s.skipped = null;
      for (const m of keep) play(s, m.at);
    } else play(s, a.at);
    return s;
  },
  view(s, seat) {
    const { bots: _bots, ...publicState } = s;
    return {
      ...publicState,
      seat,
      legal: s.phase === 'play' ? legalOf(s.board, s.colors[s.turn]) : [],
      canUndo: seat !== null && canUndo(s, seat),
    };
  },
  isOver: (s) => s.phase === 'over',
  bot: (v, seat) => ({ type: 'place', at: bestMove(v.board, v.colors[seat], v.options.level) }),
  aiPrompt(v, seat, rng) {
    if (v.phase !== 'play' || v.turn !== seat) return null;
    return {
      situation:
        `黑白棋：八方向夹吃翻转，无棋可走自动让行；终局棋子数多者胜。角不可被翻转，注意对方行动力。你执${v.colors[seat] === 1 ? '黑' : '白'}。\n列 A–H，行从上到下 8–1。\n` +
        Array.from(
          { length: 8 },
          (_, row) =>
            `${8 - row} ${v.board
              .slice(row * 8, row * 8 + 8)
              .map((p) => ['·', '黑', '白'][p])
              .join(' ')}`,
        ).join('\n'),
      options: withRecommended(
        reversi.bot(v, seat, rng),
        v.legal.map((at) => ({
          action: { type: 'place' as const, at },
          label: `落子 ${coordinate(at)}`,
        })),
      ),
    };
  },
};
