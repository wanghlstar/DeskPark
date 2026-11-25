const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];
const inside = (x: number, y: number) => x >= 0 && x < 8 && y >= 0 && y < 8;
export const CORNERS = [0, 7, 56, 63];

export function initialBoard(): number[] {
  const board = Array<number>(64).fill(0);
  board[27] = board[36] = 2;
  board[28] = board[35] = 1;
  return board;
}

export function flips(board: number[], at: number, color: number): number[] {
  if (!Number.isInteger(at) || at < 0 || at >= 64 || board[at]) return [];
  const out: number[] = [];
  for (const [dx, dy] of DIRS) {
    let x = (at % 8) + dx;
    let y = Math.floor(at / 8) + dy;
    const line: number[] = [];
    while (inside(x, y) && board[y * 8 + x] === 3 - color) {
      line.push(y * 8 + x);
      x += dx;
      y += dy;
    }
    if (line.length && inside(x, y) && board[y * 8 + x] === color) out.push(...line);
  }
  return out;
}

export function legalOf(board: number[], color: number): number[] {
  return board.flatMap((p, at) => (!p && flips(board, at, color).length ? [at] : []));
}

export function placed(board: number[], at: number, color: number): number[] {
  const next = [...board];
  next[at] = color;
  for (const p of flips(board, at, color)) next[p] = color;
  return next;
}

function weight(board: number[], at: number): number {
  if (CORNERS.includes(at)) return 500;
  const x = at % 8;
  const y = Math.floor(at / 8);
  for (const c of CORNERS) {
    const dx = Math.abs((c % 8) - x);
    const dy = Math.abs(Math.floor(c / 8) - y);
    if (!board[c] && dx <= 1 && dy <= 1) return dx === 1 && dy === 1 ? -100 : -50;
  }
  return x === 0 || x === 7 || y === 0 || y === 7 ? 20 : 2;
}

function evaluate(board: number[], color: number): number {
  const endgame = board.filter((p) => !p).length < 12;
  return (
    board.reduce(
      (sum, p, at) =>
        !p ? sum : sum + (p === color ? 1 : -1) * (endgame ? 10 : weight(board, at)),
      0,
    ) +
    (legalOf(board, color).length - legalOf(board, 3 - color).length) * 8
  );
}

export function bestMove(board: number[], color: number, level: number): number {
  const ordered = (b: number[], p: number) =>
    legalOf(b, p).sort((a, c) => weight(b, c) - weight(b, a) || a - c);
  const moves = ordered(board, color);
  const corner = moves.find((at) => CORNERS.includes(at));
  if (corner !== undefined) return corner;
  let budget = level === 3 ? 4000 : 600;
  function search(b: number[], p: number, depth: number, alpha: number, beta: number): number {
    const legal = ordered(b, p);
    if (!legal.length) {
      if (!legalOf(b, 3 - p).length) {
        const delta = b.reduce((s, c) => s + (c === p ? 1 : c ? -1 : 0), 0);
        return Math.sign(delta) * 100000 + delta;
      }
      return -search(b, 3 - p, depth, -beta, -alpha);
    }
    if (depth <= 0 || budget-- <= 0) return evaluate(b, p);
    let best = -Infinity;
    for (const at of legal) {
      const score = -search(placed(b, at, p), 3 - p, depth - 1, -beta, -alpha);
      best = Math.max(best, score);
      alpha = Math.max(alpha, score);
      if (alpha >= beta) break;
    }
    return best;
  }
  let best = -Infinity;
  let chosen = moves[0];
  for (const at of moves) {
    const after = placed(board, at, color);
    const score =
      level === 1
        ? weight(board, at) + flips(board, at, color).length
        : -search(after, 3 - color, level === 3 ? 3 : 1, -Infinity, Infinity);
    if (score > best) {
      best = score;
      chosen = at;
    }
  }
  return chosen;
}
