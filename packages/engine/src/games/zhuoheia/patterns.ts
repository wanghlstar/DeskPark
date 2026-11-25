// 候选枚举沿用跑得快的点数多重集合方式（esrrhs, MIT）。
// 完整声明：apps/web/public/licenses/paodekuai-ai.txt。
import type { Card } from '../../core/cards';
import { countBy } from '../../core/cards';
import type { PdkKind } from '../paodekuai/patterns';
export { KIND_NAME } from '../paodekuai/patterns';

export interface HaPattern {
  kind: Exclude<PdkKind, 'bomb'>;
  main: number;
  len: number;
  size: number;
}
export const isBlackAce = (c: Card) => c.suit === 'S' && c.rank === 14;
/** 黑桃A > 大王 > 小王 > 3 > 2 > 普通A > K…4。 */
export const value = (c: Card) =>
  isBlackAce(c) ? 19 : c.suit === 'J' ? c.rank + 1 : c.rank === 3 ? 16 : c.rank === 2 ? 15 : c.rank;

function analyze(cards: Card[]): HaPattern[] {
  const counts = countBy(cards, value),
    keys = [...counts.keys()].sort((a, b) => a - b);
  const n = cards.length,
    out: HaPattern[] = [];
  const add = (kind: HaPattern['kind'], main: number, len = 1) =>
    out.push({ kind, main, len, size: n });
  if (!n) return out;
  if (keys.length === 1 && n <= 3) add((['single', 'pair', 'trio'] as const)[n - 1], keys[0]);
  if (n === 5) for (const k of keys) if (counts.get(k) === 3) add('trio2', k);
  const chain =
    keys[0] >= 4 && keys.at(-1)! <= 14 && keys.every((k, i) => i === 0 || k === keys[i - 1] + 1);
  if (chain) {
    if (n >= 5 && keys.length === n) add('straight', keys.at(-1)!, n);
    if (keys.length >= 2 && keys.every((k) => counts.get(k) === 2))
      add('pairs', keys.at(-1)!, keys.length);
    if (keys.length >= 2 && keys.every((k) => counts.get(k) === 3))
      add('plane', keys.at(-1)!, keys.length);
  }
  if (out.length) return out;
  for (let len = 2; len <= Math.floor(n / 4); len++) {
    if (n !== len * 4 && n !== len * 5) continue;
    for (let lo = 4; lo + len - 1 <= 14; lo++) {
      const rest = new Map(counts);
      let ok = true;
      for (let k = lo; k < lo + len; k++) {
        if ((rest.get(k) ?? 0) < 3) {
          ok = false;
          break;
        }
        rest.set(k, rest.get(k)! - 3);
      }
      if (!ok) continue;
      if (n === len * 4) add('plane1', lo + len - 1, len);
      else if ([...rest.values()].every((c) => c === 0 || c === 2))
        add('plane2', lo + len - 1, len);
    }
  }
  return out;
}

export function resolvePlay(cards: Card[], target: HaPattern | null): HaPattern | null {
  return (
    analyze(cards).find(
      (p) =>
        !target ||
        (p.kind === target.kind &&
          p.size === target.size &&
          p.len === target.len &&
          p.main > target.main),
    ) ?? null
  );
}

export function combinations(
  hand: Card[],
  target: HaPattern | null,
): { cards: Card[]; pattern: HaPattern }[] {
  const groups = new Map<number, Card[]>();
  for (const c of hand) groups.set(value(c), [...(groups.get(value(c)) ?? []), c]);
  const keys = [...groups.keys()].sort((a, b) => a - b),
    counts = countBy(hand, value);
  const out: { cards: Card[]; pattern: HaPattern }[] = [],
    seen = new Set<string>();
  const rep = (k: number, n: number) => Array<number>(n).fill(k);
  const add = (values: number[]) => {
    if (target && values.length !== target.size) return;
    const key = [...values].sort((a, b) => a - b).join(',');
    if (seen.has(key)) return;
    seen.add(key);
    const used = new Map<number, number>();
    const cards = values.map((k) => {
      const i = used.get(k) ?? 0;
      used.set(k, i + 1);
      return groups.get(k)![i];
    });
    const pattern = resolvePlay(cards, target);
    if (pattern) out.push({ cards, pattern });
  };
  function wings(
    rest: Map<number, number>,
    need: number,
    pairs: boolean,
    picked: number[],
    index = 0,
  ) {
    if (!need) {
      add(picked);
      return;
    }
    for (let i = index; i < keys.length; i++) {
      const k = keys[i],
        per = pairs ? 2 : 1;
      if ((rest.get(k) ?? 0) < per) continue;
      const next = new Map(rest);
      next.set(k, next.get(k)! - per);
      wings(next, need - 1, pairs, [...picked, ...rep(k, per)], pairs ? i + 1 : i);
    }
  }
  for (const k of keys) {
    for (let n = 1; n <= Math.min(3, counts.get(k)!); n++) add(rep(k, n));
    if (counts.get(k)! >= 3 && (!target || target.kind === 'trio2')) {
      const rest = new Map(counts);
      rest.delete(k);
      wings(rest, 2, false, rep(k, 3));
    }
  }
  for (const per of [1, 2, 3])
    for (let lo = 4; lo <= 14; lo++)
      for (let len = per === 1 ? 5 : 2; lo + len - 1 <= 14 && len * per <= hand.length; len++) {
        const body: number[] = [],
          rest = new Map(counts);
        for (let k = lo; k < lo + len; k++) {
          if ((counts.get(k) ?? 0) < per) break;
          body.push(...rep(k, per));
          rest.set(k, counts.get(k)! - per);
        }
        if (body.length !== len * per) continue;
        add(body);
        if (per !== 3) continue;
        if (len * 4 <= hand.length && (!target || (target.kind === 'plane1' && target.len === len)))
          wings(rest, len, false, body);
        for (let k = lo; k < lo + len; k++) rest.delete(k);
        if (len * 5 <= hand.length && (!target || (target.kind === 'plane2' && target.len === len)))
          wings(rest, len, true, body);
      }
  return out;
}
