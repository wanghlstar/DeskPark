// TypeScript adaptation of esrrhs/paodekuai_ai/go/moves.go (MIT).
// Copyright (c) 2017-2026 esrrhs. Full notice: apps/web/public/licenses/paodekuai-ai.txt.
import type { Card } from '../../core/cards';
import { countValues, valuesToCards } from '../doudizhu/moves';
import { beats, ddzValue } from '../doudizhu/patterns';

export type PdkKind =
  | 'single'
  | 'pair'
  | 'trio'
  | 'trio2'
  | 'straight'
  | 'pairs'
  | 'plane'
  | 'plane1'
  | 'plane2'
  | 'bomb';
export interface PdkPattern {
  kind: PdkKind;
  main: number;
  len: number;
  size: number;
}
export const KIND_NAME: Record<PdkKind, string> = {
  single: '单张',
  pair: '对子',
  trio: '三张',
  trio2: '三带二',
  straight: '顺子',
  pairs: '连对',
  plane: '三顺',
  plane1: '飞机带单',
  plane2: '飞机带对',
  bomb: '炸弹',
};
export { ddzValue as value, beats };

export function analyze(values: number[]): PdkPattern[] {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const keys = [...counts.keys()].sort((a, b) => a - b);
  const n = values.length;
  if (!n || keys.some((k) => k < 3 || k > 15 || counts.get(k)! > 4)) return [];
  const out: PdkPattern[] = [];
  const add = (kind: PdkKind, main: number, len = 1) => out.push({ kind, main, len, size: n });
  if (keys.length === 1)
    add((['', 'single', 'pair', 'trio', 'bomb'] as const)[n] as PdkKind, keys[0]);
  if (n === 5) for (const k of keys) if (counts.get(k) === 3) add('trio2', k);
  const chain = keys.at(-1)! <= 14 && keys.every((k, i) => i === 0 || k === keys[i - 1] + 1);
  if (chain) {
    if (n >= 5 && keys.length === n) add('straight', keys.at(-1)!, n);
    if (keys.length >= 2 && keys.every((k) => counts.get(k) === 2))
      add('pairs', keys.at(-1)!, keys.length);
    if (keys.length >= 2 && keys.every((k) => counts.get(k) === 3))
      add('plane', keys.at(-1)!, keys.length);
  }
  // 与来源规则一致：完整顺子、连对、三顺优先识别，不把三顺拆成机身和翅膀。
  if (out.length) return out;
  for (let len = 2; len <= Math.floor(n / 4); len++) {
    if (n !== len * 4 && n !== len * 5) continue;
    for (let lo = 3; lo + len - 1 <= 14; lo++) {
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

export function resolvePlay(cards: Card[], target: PdkPattern | null): PdkPattern | null {
  return (
    analyze(cards.map(ddzValue))
      .filter((p) => !target || beats(p, target))
      .sort((a, b) => Number(a.kind === 'bomb') - Number(b.kind === 'bomb') || b.len - a.len)[0] ??
    null
  );
}

/** 按点数多重集合生成，翅膀全枚举；不按花色重复生成等价出法。 */
export function combinations(
  hand: Card[],
  target: PdkPattern | null,
): { cards: Card[]; pattern: PdkPattern }[] {
  const counts = countValues(hand);
  const keys = [...counts.keys()].sort((a, b) => a - b);
  const values: number[][] = [];
  const rep = (k: number, n: number) => Array<number>(n).fill(k);
  function wings(
    rest: Map<number, number>,
    need: number,
    pairs: boolean,
    picked: number[],
    index = 0,
  ) {
    if (!need) {
      values.push(picked);
      return;
    }
    for (let i = index; i < keys.length; i++) {
      const k = keys[i];
      const per = pairs ? 2 : 1;
      if ((rest.get(k) ?? 0) < per) continue;
      const next = new Map(rest);
      next.set(k, next.get(k)! - per);
      wings(next, need - 1, pairs, [...picked, ...rep(k, per)], pairs ? i + 1 : i);
    }
  }
  for (const k of keys) {
    for (let n = 1; n <= counts.get(k)!; n++) values.push(rep(k, n));
    if (counts.get(k)! >= 3) {
      const rest = new Map(counts);
      rest.delete(k);
      wings(rest, 2, false, rep(k, 3));
    }
  }
  for (const per of [1, 2, 3]) {
    const min = per === 1 ? 5 : 2;
    for (let lo = 3; lo <= 14; lo++)
      for (let len = min; lo + len - 1 <= 14 && len * per <= hand.length; len++) {
        const body: number[] = [];
        const rest = new Map(counts);
        for (let k = lo; k < lo + len; k++) {
          if ((counts.get(k) ?? 0) < per) break;
          body.push(...rep(k, per));
          rest.set(k, counts.get(k)! - per);
        }
        if (body.length !== len * per) continue;
        values.push(body);
        if (per !== 3) continue;
        if (len * 4 <= hand.length) wings(rest, len, false, body);
        for (let k = lo; k < lo + len; k++) rest.delete(k);
        if (len * 5 <= hand.length) wings(rest, len, true, body);
      }
  }
  const seen = new Set<string>();
  return values.flatMap((v) => {
    const key = [...v].sort((a, b) => a - b).join(',');
    if (seen.has(key)) return [];
    seen.add(key);
    const cards = valuesToCards(hand, v);
    const pattern = resolvePlay(cards, target);
    return pattern ? [{ cards, pattern }] : [];
  });
}
