import type { gm, rv } from '@park/engine';
import { useEffect, useRef, useState } from 'react';
import { toast } from '../../components/ui';
import type { GameController } from '../../lib/controller';
import { playSound } from '../../lib/sound';
import { DuelActions, DuelResult, MoveList, PlayerCard } from './duel';
import { useTurnCue } from './trick';
import './stones.css';

export default function StoneBoard({
  ctl,
}: {
  ctl: GameController<gm.GmView | rv.RvView, gm.GmAction | rv.RvAction>;
}) {
  const v = ctl.view!;
  const reversi = ctl.def.meta.id === 'reversi';
  const n = reversi ? 8 : 15;
  const winning = 'winning' in v ? v.winning : [];
  const counts = [1, 2].map((p) => v.board.filter((c) => c === p).length);
  const me = ctl.seat;
  const own = me ?? 0;
  const opp = 1 - own;
  const over = v.phase === 'over';
  const myTurn = me !== null && v.turn === me && !over;
  const [flip, setFlip] = useState(false);
  const [showResult, setShowResult] = useState(true);
  useTurnCue(myTurn);
  const seen = useRef(v.moves.length);
  useEffect(() => {
    if (v.moves.length > seen.current) playSound('play');
    seen.current = v.moves.length;
  }, [v.moves.length]);
  useEffect(() => {
    if (over) setShowResult(true);
  }, [over]);
  const label = (at: number) => `${String.fromCharCode(65 + (at % n))}${n - Math.floor(at / n)}`;
  const send = (a: gm.GmAction) => {
    const err = ctl.act(a);
    if (err) toast(err, 'error');
  };
  const badge = (s: number) => (
    <>
      <i className={`stone-swatch is-${v.colors[s]}`} />
      {v.colors[s] === 1 ? '黑方' : '白方'}
    </>
  );
  const last = v.moves.at(-1)?.at;
  const r = v.result;
  return (
    <>
      <div className={`stones-layout ${reversi ? 'is-reversi' : ''}`}>
        <div className="stones-well">
          <svg
            className="stones-board"
            viewBox={`-0.55 -0.55 ${n + 1.1} ${n + 1.1}`}
            role="group"
            aria-label={`${ctl.def.meta.name}棋盘`}
          >
            <defs>
              <radialGradient id="stone-black" cx="32%" cy="25%">
                <stop stopColor="#60676b" />
                <stop offset="1" stopColor="#111719" />
              </radialGradient>
              <radialGradient id="stone-white" cx="32%" cy="25%">
                <stop stopColor="#fff" />
                <stop offset="1" stopColor="#d8d8ce" />
              </radialGradient>
            </defs>
            <rect
              x="-0.5"
              y="-0.5"
              width={n + 1}
              height={n + 1}
              rx="0.35"
              className="stones-wood"
            />
            {reversi ? (
              Array.from({ length: 9 }, (_, i) => (
                <path key={i} d={`M 0 ${i} H 8 M ${i} 0 V 8`} className="stones-line" />
              ))
            ) : (
              <>
                {Array.from({ length: n }, (_, i) => (
                  <path
                    key={i}
                    d={`M .5 ${i + 0.5} H ${n - 0.5} M ${i + 0.5} .5 V ${n - 0.5}`}
                    className="stones-line"
                  />
                ))}
                {[48, 56, 112, 168, 176].map((at) => (
                  <circle
                    key={at}
                    cx={(at % n) + 0.5}
                    cy={Math.floor(at / n) + 0.5}
                    r=".07"
                    fill="#735331"
                  />
                ))}
              </>
            )}
            {v.board.map((_, displayAt) => {
              const at = flip ? n * n - 1 - displayAt : displayAt;
              const p = v.board[at];
              const x = (displayAt % n) + 0.5;
              const y = Math.floor(displayAt / n) + 0.5;
              const legal = myTurn && v.legal.includes(at);
              return (
                <g
                  key={at}
                  role="button"
                  aria-label={`${label(at)}${p ? (p === 1 ? ' 黑子' : ' 白子') : ' 空位'}`}
                  aria-disabled={!legal}
                  tabIndex={legal ? 0 : -1}
                  className={`stone-cell ${legal ? 'is-legal' : ''}`}
                  onClick={() => legal && send({ type: 'place', at })}
                  onKeyDown={(e) => {
                    if (legal && ['Enter', ' '].includes(e.key)) {
                      e.preventDefault();
                      send({ type: 'place', at });
                    }
                  }}
                >
                  <rect x={x - 0.5} y={y - 0.5} width="1" height="1" fill="transparent" />
                  {!p && legal && <circle cx={x} cy={y} r=".17" className="stone-preview" />}
                  {!!p && (
                    <circle
                      cx={x}
                      cy={y}
                      r=".43"
                      fill={`url(#stone-${p === 1 ? 'black' : 'white'})`}
                      className={winning.includes(at) ? 'stone is-winning' : 'stone'}
                    />
                  )}
                  {last === at && (
                    <rect
                      x={x - 0.1}
                      y={y - 0.1}
                      width=".2"
                      height=".2"
                      fill="var(--danger)"
                      pointerEvents="none"
                    />
                  )}
                </g>
              );
            })}
            {Array.from({ length: n }, (_, i) => (
              <text key={i} x={i + 0.5} y={n + 0.25} className="stones-coord">
                {String.fromCharCode(65 + (flip ? n - 1 - i : i))}
              </text>
            ))}
          </svg>
        </div>
        <aside className="stones-side">
          <PlayerCard ctl={ctl} seat={opp} badge={badge(opp)} active={!over && v.turn === opp} />
          <div className={`duel-status ${myTurn ? 'is-mine' : ''}`} aria-live="polite">
            {over ? '对局结束' : myTurn ? '轮到你落子' : `等待 ${ctl.players[v.turn].name}…`}
          </div>
          {reversi && (
            <div className="stones-count" aria-live="polite">
              黑 <b className="num">{counts[0]}</b>
              <span>:</span>白 <b className="num">{counts[1]}</b>
              {'skipped' in v && v.skipped !== null && !over && (
                <small>{v.colors[v.skipped] === 1 ? '黑方' : '白方'}无棋可走，自动让行</small>
              )}
            </div>
          )}
          <MoveList moves={v.moves.map((m) => `${m.color === 1 ? '黑' : '白'} ${label(m.at)}`)} />
          {me !== null && (
            <DuelActions
              showUndo={ctl.players[opp].isBot}
              canUndo={v.canUndo}
              canResign={myTurn}
              onUndo={() => send({ type: 'undo' })}
              onResign={() => send({ type: 'resign' })}
              onFlip={() => setFlip((f) => !f)}
            />
          )}
          <PlayerCard ctl={ctl} seat={own} badge={badge(own)} active={!over && v.turn === own} />
        </aside>
      </div>
      <DuelResult
        ctl={ctl}
        open={over && showResult}
        onClose={() => setShowResult(false)}
        won={r && me !== null && r.winner !== null ? r.winner === me : null}
        title={
          r?.winner === null ? '和棋' : `${r && v.colors[r.winner!] === 1 ? '黑方' : '白方'}获胜`
        }
        sub={
          r?.reason === 'five'
            ? '连成五子'
            : r?.reason === 'full'
              ? '棋盘已满'
              : r?.reason === 'nomoves'
                ? `双方无棋可走 · 黑 ${counts[0]} : 白 ${counts[1]}`
                : '认输结束本局'
        }
      />
    </>
  );
}
