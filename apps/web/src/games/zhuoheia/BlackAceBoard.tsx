import { cardLabel, ha } from '@park/engine';
import type { CSSProperties } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { CardRow, Hand } from '../../components/Hand';
import { Seat } from '../../components/Seat';
import { Button, Sheet, toast } from '../../components/ui';
import type { GameController } from '../../lib/controller';
import { signed } from '../../lib/format';
import { playSound } from '../../lib/sound';
import { speak } from '../../lib/speech';
import { CountChip, useHintCycle, useSelection, useTurnCue } from '../shared/trick';
import './black-ace.css';

export default function BlackAceBoard({ ctl }: { ctl: GameController<ha.HaView, ha.HaAction> }) {
  const v = ctl.view!;
  const me = ctl.seat ?? 0;
  const spectator = ctl.seat === null;
  const over = v.phase !== 'playing';
  const myTurn = !spectator && !over && v.turn === me;
  const n = ctl.players.length;
  const opponents = Array.from({ length: n - (spectator ? 0 : 1) }, (_, i) =>
    spectator ? i : (me + i + 1) % n,
  );
  useTurnCue(myTurn);
  const [selected, setSelected] = useSelection(v.hand, v.round);
  const moves = useMemo(() => (myTurn ? ha.legalMoves(v) : []), [v, myTurn]);
  const hint = useHintCycle(
    moves.filter((a) => a.type === 'play'),
    ctl.version,
  );
  const error = ha.playError(v, [...selected]);
  const pattern = ha.resolvePlay(
    v.hand.filter((c) => selected.has(c.id)),
    v.lastPlay?.pattern ?? null,
  );
  const resultRound = useRef(0);
  const lastVoice = useRef(ctl.version);
  useEffect(() => {
    if (ctl.version === lastVoice.current) return;
    lastVoice.current = ctl.version;
    if (ctl.last?.type === 'pass') speak('过牌');
    else if (ctl.last?.type === 'play' && v.lastPlay) {
      const { cards, pattern: p } = v.lastPlay;
      speak(
        p.kind === 'single'
          ? cardLabel(cards[0])
              .replace('♠', '黑桃')
              .replace('♥', '红桃')
              .replace('♣', '梅花')
              .replace('♦', '方块')
          : ha.KIND_NAME[p.kind],
      );
    }
  }, [ctl.version, ctl.last, v.lastPlay]);
  useEffect(() => {
    if (v.result && v.result.round !== resultRound.current && !spectator) {
      resultRound.current = v.result.round;
      playSound(v.result.winners.includes(me) ? 'win' : 'lose');
    }
  }, [v.result, me, spectator]);
  const send = (action: ha.HaAction) => {
    const err = ctl.act(action);
    if (err) toast(err, 'error');
    else setSelected(new Set());
  };
  const black = (seat: number) => v.exposed[seat] || v.result?.blackSeats.includes(seat);
  const lastText = (seat: number) => {
    if (v.finishOrder.includes(seat)) return `第 ${v.finishOrder.indexOf(seat) + 1} 位出完`;
    const move = v.lastMoves[seat];
    return !move ? '等待出牌' : move.type === 'pass' ? '过牌' : move.cards.map(cardLabel).join(' ');
  };
  return (
    <div className="black-ace" data-game="zhuoheia">
      <div className="black-ace__info info-chips">
        <span className="chip">
          第 {v.round} 局{v.options.rounds ? ` / ${v.options.rounds}` : ''}
        </span>
        <span className="chip">
          {n} 人 · {v.decks} 副 · 无炸弹
        </span>
        <span className="chip is-gold">
          {spectator ? '观战中' : v.role === 'black' ? '你的身份：黑 A 方' : '你的身份：捉 A 方'}
        </span>
      </div>
      <div
        className="black-ace__opponents"
        style={{ '--players': opponents.length } as CSSProperties}
      >
        {opponents.map((seat) => (
          <div className="black-ace__opponent" key={seat} data-seat={seat}>
            <Seat
              player={ctl.players[seat]}
              size={42}
              active={!over && v.turn === seat}
              deadline={ctl.deadlines[seat]}
              tag={black(seat) ? '黑 A' : undefined}
              dim={v.handCounts[seat] === 0}
              figureOverflow
              sub={
                <>
                  <CountChip n={v.handCounts[seat]} warnAt={1} />
                  <em>{signed(v.scores[seat])}</em>
                </>
              }
            />
            <small className="black-ace__last" title={lastText(seat)}>
              {lastText(seat)}
            </small>
          </div>
        ))}
      </div>
      <section className="black-ace__center" aria-label="当前出牌">
        {v.lastPlay ? (
          <>
            <div className="black-ace__target">
              <span>
                {ctl.players[v.lastPlay.seat].name} · {ha.KIND_NAME[v.lastPlay.pattern.kind]}
              </span>
              <CardRow cards={v.lastPlay.cards} w="var(--cw-sm)" overlap={0.28} />
            </div>
            <small>
              {!over && `等待 ${ctl.players[v.turn].name}${myTurn ? '（你）' : ''} 出牌`}
            </small>
          </>
        ) : (
          <div className="black-ace__empty">
            <b>♠ A</b>
            <span>{myTurn ? '轮到你自由领出' : `等待 ${ctl.players[v.turn].name} 领出`}</span>
            <small>黑 A 提前跑掉就赢 · 其余人要把他留到最后</small>
          </div>
        )}
      </section>
      {!spectator && (
        <div className="black-ace__controls">
          <Seat
            player={ctl.players[me]}
            size={36}
            layout="row"
            active={myTurn}
            deadline={ctl.deadlines[me]}
            tag={black(me) ? '黑 A' : undefined}
            sub={`积分 ${signed(v.scores[me])}`}
            figureOverflow
          />
          {myTurn ? (
            <div className="action-bar">
              <Button
                variant="felt"
                onClick={() => {
                  const a = hint();
                  if (a) setSelected(new Set(a.cards));
                }}
              >
                提示
              </Button>
              {v.lastPlay && (
                <Button variant="felt" onClick={() => send({ type: 'pass' })}>
                  过牌
                </Button>
              )}
              <Button
                variant="felt-primary"
                disabled={!!error}
                title={error ?? ''}
                onClick={() => send({ type: 'play', cards: [...selected] })}
              >
                出牌
              </Button>
              {pattern && !error && (
                <span className="pattern-tag">{ha.KIND_NAME[pattern.kind]}</span>
              )}
            </div>
          ) : (
            <span className="black-ace__waiting">
              {v.hand.length ? '观察出牌，找出隐藏的黑 A' : '已出完，继续看大家捉黑 A'}
            </span>
          )}
        </div>
      )}
      <div className="black-ace__hand">
        {spectator ? (
          <span className="action-hint">观战不显示手牌与隐藏身份</span>
        ) : (
          <Hand
            cards={v.hand}
            selected={selected}
            onChange={setSelected}
            layout="stacks"
            groupKey={ha.value}
            disabled={over || !myTurn}
            dealKey={v.round}
            markOf={(c) => (ha.isBlackAce(c) ? { text: '黑A', tone: 'gold' } : undefined)}
          />
        )}
      </div>
      {over && v.result && (
        <Sheet
          open
          dismissible={false}
          title={v.result.blackWon ? '黑 A 跑掉了' : '捉住黑 A 了'}
          footer={
            v.phase === 'matchOver' ? (
              <>
                <Button onClick={ctl.leave}>返回大厅</Button>
                {ctl.canRestart && (
                  <Button variant="primary" onClick={ctl.restart}>
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
                {v.ready[me] ? `等待其他玩家 ${v.ready.filter(Boolean).length}/${n}` : '继续下一局'}
              </Button>
            )
          }
        >
          <div className="result">
            <div
              className={`result__title ${!spectator && v.result.winners.includes(me) ? 'is-win' : 'is-lose'}`}
            >
              {v.result.blackWon ? '黑 A 方获胜' : '捉 A 方获胜'}
            </div>
            <div className="result__sub">
              黑 A：{v.result.blackSeats.map((seat) => ctl.players[seat].name).join('、')} · 第{' '}
              {v.round} 局
            </div>
            <table className="result__table">
              <thead>
                <tr>
                  <th>玩家 / 身份</th>
                  <th>本局</th>
                  <th>总分</th>
                </tr>
              </thead>
              <tbody>
                {ctl.players.map((p, seat) => (
                  <tr key={seat} className={seat === ctl.seat ? 'is-me' : ''}>
                    <td>
                      {p.name} · {v.result!.blackSeats.includes(seat) ? '黑 A' : '捉 A'}
                    </td>
                    <td className={v.result!.deltas[seat] > 0 ? 'delta-pos' : 'delta-neg'}>
                      {signed(v.result!.deltas[seat])}
                    </td>
                    <td>{signed(v.scores[seat])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="result__hands">
              {v.revealed?.map(
                (hand, seat) =>
                  hand.length > 0 && (
                    <div className="result__hand" key={seat}>
                      <span>{ctl.players[seat].name}</span>
                      <CardRow cards={hand} w="var(--cw-xs)" overlap={0.3} />
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
