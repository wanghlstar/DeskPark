import { withRecommended } from '../../core/ai';
import { clone } from '../../core/clone';
import { Rng } from '../../core/rng';
import type { GameDefinition } from '../../core/types';
import { bestMove, candidates, SIZE, winningLine } from './board';

export interface GmOptions {
  level: number;
  side: string;
}
export type GmAction = { type: 'place'; at: number } | { type: 'undo' } | { type: 'resign' };
export interface GmState {
  options: GmOptions;
  board: number[];
  colors: number[];
  bots: boolean[];
  turn: number;
  moves: { at: number; color: number }[];
  phase: 'play' | 'over';
  winning: number[];
  result: { winner: number | null; reason: 'five' | 'full' | 'resign' } | null;
}
export interface GmView extends Omit<GmState, 'bots'> {
  seat: number | null;
  legal: number[];
  canUndo: boolean;
}

const canUndo = (s: GmState, seat: number) =>
  s.phase === 'play' &&
  seat === s.turn &&
  !s.bots[seat] &&
  s.bots[1 - seat] &&
  s.moves.some((m) => m.color === s.colors[seat]);
const coordinate = (at: number) =>
  `${String.fromCharCode(65 + (at % SIZE))}${SIZE - Math.floor(at / SIZE)}`;

export const gomoku: GameDefinition<GmState, GmAction, GmView, GmOptions> = {
  meta: {
    id: 'gomoku',
    category: 'chess',
    name: '五子棋',
    nameEn: 'Gomoku',
    tagline: '黑白交替，横竖斜线先连五子',
    minPlayers: 2,
    maxPlayers: 2,
    defaultPlayers: 2,
    botDelayMs: [450, 800],
    turnTimeoutMs: 120000,
    rules: [
      '15×15 棋盘，黑方先走，双方轮流在空交叉点落一子。',
      '横、竖或斜线连成至少五子即获胜，六子及以上的长连也有效。本玩法为自由五子棋，无三三、四四等禁手。',
      '棋盘填满无人连五为和棋。和电脑下时，轮到自己可以悔棋；随时可在自己回合认输。',
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
      board: Array(225).fill(0),
      colors: black ? [1, 2] : [2, 1],
      bots: players.map((p) => p.isBot),
      turn: black ? 0 : 1,
      moves: [],
      phase: 'play',
      winning: [],
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
    if (!Number.isInteger(a.at) || a.at < 0 || a.at >= 225) return '无效落子';
    return s.board[a.at] === 0 ? null : '这里已有棋子';
  },
  apply(prev, seat, a) {
    const s = clone(prev);
    if (a.type === 'resign') {
      s.phase = 'over';
      s.result = { winner: 1 - seat, reason: 'resign' };
    } else if (a.type === 'undo') {
      let cut = s.moves.length - 1;
      while (s.moves[cut].color !== s.colors[seat]) cut--;
      s.moves = s.moves.slice(0, cut);
      s.board.fill(0);
      for (const m of s.moves) s.board[m.at] = m.color;
      s.turn = seat;
    } else {
      s.board[a.at] = s.colors[seat];
      s.moves.push({ at: a.at, color: s.colors[seat] });
      s.winning = winningLine(s.board, a.at);
      if (s.winning.length || s.board.every(Boolean)) {
        s.phase = 'over';
        s.result = {
          winner: s.winning.length ? seat : null,
          reason: s.winning.length ? 'five' : 'full',
        };
      } else s.turn = 1 - seat;
    }
    return s;
  },
  view(s, seat) {
    const { bots: _bots, ...publicState } = s;
    return {
      ...publicState,
      seat,
      canUndo: seat !== null && canUndo(s, seat),
      legal: s.phase === 'play' ? s.board.flatMap((p, at) => (p ? [] : [at])) : [],
    };
  },
  isOver: (s) => s.phase === 'over',
  bot: (v, seat) => ({ type: 'place', at: bestMove(v.board, v.colors[seat], v.options.level) }),
  aiPrompt(v, seat, rng) {
    if (v.phase !== 'play' || v.turn !== seat) return null;
    return {
      situation:
        `自由五子棋：连成至少五子获胜，无禁手。你执${v.colors[seat] === 1 ? '黑' : '白'}。\n` +
        v.board
          .reduce((rows: string[], _, at) => {
            if (at % SIZE === 0)
              rows.push(
                `${SIZE - Math.floor(at / SIZE)} ${v.board
                  .slice(at, at + SIZE)
                  .map((p) => ['·', '黑', '白'][p])
                  .join(' ')}`,
              );
            return rows;
          }, [])
          .join('\n') +
        '\n列从左到右为 A–O。',
      options: withRecommended(
        gomoku.bot(v, seat, rng),
        candidates(v.board, v.colors[seat]).map((at) => ({
          label: `落子 ${coordinate(at)}`,
          action: { type: 'place' as const, at },
        })),
      ),
    };
  },
};
