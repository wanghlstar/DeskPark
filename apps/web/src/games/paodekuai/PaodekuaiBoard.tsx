import { pdk } from '@park/engine';
import { useEffect, useMemo, useRef } from 'react';
import { CardRow, Hand } from '../../components/Hand';
import { Seat } from '../../components/Seat';
import { Button, Sheet, toast } from '../../components/ui';
import type { GameController } from '../../lib/controller';
import { signed } from '../../lib/format';
import { playSound } from '../../lib/sound';
import { CountChip, MoveZone, useHintCycle, useSelection, useTurnCue } from '../shared/trick';
import '../doudizhu/doudizhu.css';

export default function PaodekuaiBoard({
  ctl,
}: {
  ctl: GameController<pdk.PdkView, pdk.PdkAction>;
}) {
  const v = ctl.view!;
  const me = ctl.seat ?? 0;
  const spectator = ctl.seat === null;
  const left = (me + 2) % 3;
  const right = (me + 1) % 3;
  const over = v.phase !== 'playing';
  const myTurn = !spectator && !over && v.turn === me;
  useTurnCue(myTurn);
  const [selected, setSelected] = useSelection(v.hand, v.round);
  const moves = useMemo(() => (myTurn ? pdk.legalMoves(v) : []), [v, myTurn]);
  const choices = moves.filter((a) => a.type === 'play');
  const hint = useHintCycle(choices, ctl.version);
  const canPass = moves.some((a) => a.type === 'pass');
  const error = pdk.playError(v, [...selected]);
  const pattern = pdk.resolvePlay(
    v.hand.filter((c) => selected.has(c.id)),
    v.lastPlay?.pattern ?? null,
  );
  const r = v.result;
  const resultRound = useRef(0);
  useEffect(() => {
    if (r && r.round !== resultRound.current && !spectator) {
      resultRound.current = r.round;
      playSound(r.winner === me ? 'win' : 'lose');
    }
  }, [r, me, spectator]);
  const send = (a: pdk.PdkAction) => {
    const err = ctl.act(a);
    if (err) toast(err, 'error');
    else setSelected(new Set());
  };
  const opponent = (seat: number, side: 'left' | 'right') => (
    <div className={`ddz__seat is-${side}`}>
      <Seat
        player={ctl.players[seat]}
        active={!over && v.turn === seat}
        deadline={ctl.deadlines[seat]}
        bubble={v.handCounts[seat] === 1 ? '报单！' : undefined}
        bubbleSide={side === 'left' ? 'right' : 'left'}
        sub={
          <span className="ddz__sub">
            <CountChip n={v.handCounts[seat]} warnAt={1} />
            <em>积分 {v.scores[seat]}</em>
          </span>
        }
      />
    </div>
  );
  return (
    <div className="ddz pdk" data-game="paodekuai">
      <div className="ddz__info info-chips">
        <span className="chip">
          第 <b className="num">{v.round}</b> 局{v.options.rounds ? ` / ${v.options.rounds}` : ''}
        </span>
        <span className="chip">48 张 · 有大必压</span>
        <span className="chip is-gold">
          {v.opening
            ? '首手含黑桃 3'
            : !v.lastPlay
              ? '自由领出'
              : pdk.KIND_NAME[v.lastPlay.pattern.kind]}
        </span>
      </div>
      {opponent(left, 'left')}
      {opponent(right, 'right')}
      <div className="ddz__center">
        {(
          [
            [left, 'left'],
            [right, 'right'],
            [me, 'me'],
          ] as const
        ).map(([seat, side]) => (
          <div key={seat} className={`ddz__zone is-${side}`}>
            <MoveZone
              move={v.lastMoves[seat]}
              from={side === 'me' ? 'bottom' : side}
              passText="要不起"
            />
          </div>
        ))}
      </div>
      <div className="ddz__me">
        <div className="ddz__myseat">
          <Seat
            player={ctl.players[me]}
            active={myTurn}
            deadline={ctl.deadlines[me]}
            sub={<span className="ddz__score">积分 {v.scores[me]}</span>}
            layout="row"
            size={48}
          />
        </div>
        {myTurn ? (
          <div className="action-bar">
            {canPass ? (
              <Button variant="felt-primary" onClick={() => send({ type: 'pass' })}>
                要不起
              </Button>
            ) : (
              <>
                <Button
                  variant="felt"
                  onClick={() => {
                    const a = hint();
                    if (a) setSelected(new Set(a.cards));
                  }}
                >
                  提示
                </Button>
                <Button
                  variant="felt-primary"
                  disabled={!!error}
                  title={error ?? ''}
                  onClick={() => send({ type: 'play', cards: [...selected] })}
                >
                  出牌
                </Button>
                {pattern && !error && (
                  <span className="pattern-tag">{pdk.KIND_NAME[pattern.kind]}</span>
                )}
              </>
            )}
          </div>
        ) : (
          !over &&
          !spectator && (
            <div className="action-hint">
              等待 <b>{ctl.players[v.turn].name}</b> 出牌
            </div>
          )
        )}
      </div>
      <div className="ddz__hand">
        {spectator ? (
          <div className="action-hint spectate">观战中</div>
        ) : (
          <Hand
            cards={v.hand}
            selected={selected}
            onChange={setSelected}
            disabled={over}
            dealKey={v.round}
          />
        )}
      </div>
      {over && r && (
        <Sheet
          open
          dismissible={false}
          footer={
            v.phase === 'matchOver' ? (
              <>
                <Button onClick={() => ctl.leave()}>返回大厅</Button>
                {ctl.canRestart && (
                  <Button variant="primary" onClick={() => ctl.restart()}>
                    再来一场
                  </Button>
                )}
              </>
            ) : spectator ? undefined : (
              <Button
                variant="primary"
                disabled={v.ready[me]}
                onClick={() => send({ type: 'ready' })}
              >
                {v.ready[me] ? `等待其他玩家 ${v.ready.filter(Boolean).length}/3` : '继续下一局'}
              </Button>
            )
          }
        >
          <div className="result">
            <div
              className={`result__title ${r.winner === me && !spectator ? 'is-win' : 'is-lose'}`}
            >
              {ctl.players[r.winner].name} 先出完
            </div>
            <div className="result__sub">剩牌每张 1 分 · 16 张未出双倍 · 第 {r.round} 局</div>
            <table className="result__table">
              <thead>
                <tr>
                  <th>玩家</th>
                  <th className="num">本局</th>
                  <th className="num">总分</th>
                </tr>
              </thead>
              <tbody>
                {[0, 1, 2].map((s) => (
                  <tr key={s} className={s === me && !spectator ? 'is-me' : ''}>
                    <td>{ctl.players[s].name}</td>
                    <td className={`num ${r.deltas[s] >= 0 ? 'delta-pos' : 'delta-neg'}`}>
                      {signed(r.deltas[s])}
                    </td>
                    <td className="num">{v.scores[s]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="result__hands">
              {v.revealed?.map(
                (hand, s) =>
                  hand.length > 0 && (
                    <div className="result__hand" key={s}>
                      <span>{ctl.players[s].name}</span>
                      <CardRow cards={hand} w="var(--cw-xs)" overlap={0.5} />
                    </div>
                  ),
              )}
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
