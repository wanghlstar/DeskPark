// Adapted from Minjia-Hu/retro-arcade (MIT), Copyright (c) 2026 Minjia Hu.
// Full notice: apps/web/public/licenses/retro-arcade.txt.
export const SIZE = 15;
export const DIRS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];
export const inside = (x: number, y: number) => x >= 0 && x < SIZE && y >= 0 && y < SIZE;

export function winningLine(board: number[], at: number): number[] {
  const color = board[at];
  if (!color) return [];
  for (const [dx, dy] of DIRS) {
    const line = [at];
    for (const sign of [-1, 1]) {
      let x = (at % SIZE) + sign * dx;
      let y = Math.floor(at / SIZE) + sign * dy;
      while (inside(x, y) && board[y * SIZE + x] === color) {
        line.push(y * SIZE + x);
        x += sign * dx;
        y += sign * dy;
      }
    }
    if (line.length >= 5) return line;
  }
  return [];
}

function shape(count: number, open: number): number {
  if (count >= 5) return 100000;
  if (count === 4) return open === 2 ? 10000 : open === 1 ? 3000 : 0;
  if (count === 3) return open === 2 ? 1000 : open === 1 ? 100 : 0;
  if (count === 2) return open === 2 ? 100 : open === 1 ? 10 : 0;
  return open === 2 ? 10 : 0;
}

function point(board: number[], at: number, color: number): number {
  let score = 0;
  for (const [dx, dy] of DIRS) {
    let count = 1;
    let open = 0;
    for (const sign of [-1, 1]) {
      let x = (at % SIZE) + sign * dx;
      let y = Math.floor(at / SIZE) + sign * dy;
      while (inside(x, y) && board[y * SIZE + x] === color) {
        count++;
        x += sign * dx;
        y += sign * dy;
      }
      if (inside(x, y) && board[y * SIZE + x] === 0) open++;
    }
    score += shape(count, open);
  }
  return score;
}

export function candidates(board: number[], color: number): number[] {
  const near = new Set<number>();
  for (let at = 0; at < board.length; at++) {
    if (!board[at]) continue;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const x = (at % SIZE) + dx;
        const y = Math.floor(at / SIZE) + dy;
        if (inside(x, y) && board[y * SIZE + x] === 0) near.add(y * SIZE + x);
      }
  }
  if (!near.size) return board[112] === 0 ? [112] : [];
  return [...near]
    .map((at) => ({ at, score: point(board, at, color) + point(board, at, 3 - color) }))
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .map((c) => c.at);
}

function evaluate(board: number[], color: number): number {
  let score = 0;
  for (let at = 0; at < board.length; at++) {
    const p = board[at];
    if (!p) continue;
    for (const [dx, dy] of DIRS) {
      const px = (at % SIZE) - dx;
      const py = Math.floor(at / SIZE) - dy;
      if (inside(px, py) && board[py * SIZE + px] === p) continue;
      let x = at % SIZE;
      let y = Math.floor(at / SIZE);
      let count = 0;
      while (inside(x, y) && board[y * SIZE + x] === p) {
        count++;
        x += dx;
        y += dy;
      }
      const open =
        Number(inside(px, py) && !board[py * SIZE + px]) +
        Number(inside(x, y) && !board[y * SIZE + x]);
      score += (p === color ? 1 : -1) * shape(count, open);
    }
  }
  return score;
}

export function bestMove(input: number[], color: number, level: number): number {
  const board = [...input];
  const list = candidates(board, color);
  // 所有难度都先成五或防守，避免截断搜索候选时漏掉必应手。
  for (const p of [color, 3 - color])
    for (const at of list) {
      board[at] = p;
      const win = winningLine(board, at).length > 0;
      board[at] = 0;
      if (win) return at;
    }
  if (level === 1 || list.length <= 1) return list[0];
  let budget = level === 3 ? 2200 : 500;
  function search(p: number, depth: number, alpha: number, beta: number): number {
    if (depth === 0 || budget-- <= 0) return evaluate(board, p);
    let best = -Infinity;
    const moves = candidates(board, p).slice(0, 8);
    if (!moves.length) return 0;
    for (const at of moves) {
      board[at] = p;
      const value = winningLine(board, at).length
        ? 1e8 + depth
        : -search(3 - p, depth - 1, -beta, -alpha);
      board[at] = 0;
      best = Math.max(best, value);
      alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }
    return best;
  }
  let best = -Infinity;
  let chosen = list[0];
  for (const at of list.slice(0, 10)) {
    board[at] = color;
    const value = -search(3 - color, level === 3 ? 2 : 1, -Infinity, Infinity);
    board[at] = 0;
    if (value > best) {
      best = value;
      chosen = at;
    }
  }
  return chosen;
}
