import { Rng, SUIT_SYMBOL, sh } from '@park/engine';
import type { Card } from '@park/engine';
import { Eye, History, RotateCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { CardRow, Hand } from '../../components/Hand';
import { PlayingCard } from '../../components/PlayingCard';
import type { CardMark } from '../../components/Hand';
import { Avatar, Seat } from '../../components/Seat';
import { Button, Sheet, toast } from '../../components/ui';
import type { GameController } from '../../lib/controller';
import { playSound } from '../../lib/sound';
import { CountChip, MoveZone, useSelection, useTurnCue } from '../shared/trick';
import './shuangsheng.css';
import { useShuangshengVoice } from './voice';

type Ctl = GameController<sh.SsView, sh.SsAction>;

const lv = (n: number) => sh.LEVEL_LABEL(n);

function trumpText(v: sh.SsView): string {
  if (!v.decl) return '未定';
  if (v.decl.suit === null) return v.decl.fallback ? '无主' : sh.STRENGTH_NAME[v.decl.strength];
  return `${SUIT_SYMBOL[v.decl.suit]} ${sh.STRENGTH_NAME[v.decl.strength]}`;
}

const LEVEL_MARK: CardMark = { text: '级', tone: 'level' };
const TRUMP_MARK: CardMark = { text: '主', tone: 'trump' };

/** 级牌标「级」，其余主牌（王、主花色）标「主」；反主后随新的主花色变化 */
function markFor(v: sh.SsView): (c: Card) => CardMark | undefined {
  const trump = v.decl ? v.decl.suit : null;
  return (c) => {
    if (c.suit === 'J') return TRUMP_MARK;
    if (c.rank === v.level) return LEVEL_MARK;
    if (trump !== null && c.suit === trump) return TRUMP_MARK;
    return undefined;
  };
}

const RED: Record<string, boolean> = { H: true, D: true };

/** 桌面中间的大字：打几、什么主 */
function CenterInfo({ v }: { v: sh.SsView }) {
  const d = v.decl;
  const suit = d?.suit ?? null;
  return (
    <div className="sj-big" aria-hidden>
      <span className="sj-big__level">
        打 <b>{lv(v.level)}</b>
      </span>
      <span className={`sj-big__trump ${suit && RED[suit] ? 'is-red' : ''}`}>
        {!d ? (
          <em>未定主</em>
        ) : suit === null ? (
          <b>无主</b>
        ) : (
          <>
            <b className="sj-big__suit">{SUIT_SYMBOL[suit]}</b> 主
          </>
        )}
        {d && <small>{sh.STRENGTH_NAME[d.strength]}</small>}
      </span>
    </div>
  );
}

/** 闲家得分：放大显示在桌面右上方，分数变化时闪一下 */
function ScoreBig({ points, onLast }: { points: number; onLast?: () => void }) {
  return (
    <div className={`sj-score-big ${points >= 80 ? 'is-hot' : ''}`}>
      <span>闲家得分</span>
      <b key={points} className="num">
        {points}
      </b>
      {onLast && (
        <button type="button" className="sj-peek-btn" onClick={onLast} title="查看上一圈">
          <History size={14} /> 上一圈
        </button>
      )}
    </div>
  );
}

/** 上一圈：四家各出了什么牌 */
function LastTrickSheet({
  v,
  players,
  markOf,
  onClose,
}: {
  v: sh.SsView;
  players: { name: string }[];
  markOf: (c: Card) => CardMark | undefined;
  onClose: () => void;
}) {
  const t = v.lastTrick;
  return (
    <Sheet
      open
      onClose={onClose}
      title="上一圈"
      subtitle={
        t
          ? `${players[t.winner!]?.name} 最大${t.points ? ` · ${t.points} 分` : ''}${
              t.points && sh.teamOf(t.winner!) !== v.dealerTeam ? '（闲家得分）' : ''
            }`
          : undefined
      }
      footer={<Button onClick={onClose}>关闭</Button>}
    >
      {t ? (
        <div className="sj-last">
          {t.plays.map((p, i) => (
            <div key={p.seat} className={`sj-last__row ${t.winner === p.seat ? 'is-big' : ''}`}>
              <span className="sj-last__who">
                {players[p.seat]?.name}
                {i === 0 && <small>首出</small>}
                {v.dealer === p.seat && <small>庄</small>}
                {t.winner === p.seat && <em>最大</em>}
              </span>
              <CardRow cards={p.cards} w="var(--cw-xs)" overlap={0.45} markOf={markOf} />
            </div>
          ))}
        </div>
      ) : (
        <p className="sj-last__empty">还没有打完的一圈</p>
      )}
    </Sheet>
  );
}

/** 底牌：扣底的一家能看，其他人只看到牌背 */
function BottomSheet({
  v,
  players,
  markOf,
  onClose,
}: {
  v: sh.SsView;
  players: { name: string }[];
  markOf: (c: Card) => CardMark | undefined;
  onClose: () => void;
}) {
  const name = v.burier !== null ? players[v.burier]?.name : '';
  return (
    <Sheet
      open
      onClose={onClose}
      title={`${name} 扣的底牌`}
      subtitle={
        v.bottom
          ? `共 8 张 · 底牌分 ${sh.sumPoints(v.bottom)}`
          : `只有扣底的一家（${name}）能看，本局结束后公开`
      }
      footer={<Button onClick={onClose}>关闭</Button>}
    >
      <div className="sj-bottom-peek">
        {v.bottom ? (
          <CardRow cards={v.bottom} w="var(--cw-sm)" overlap={0.35} markOf={markOf} />
        ) : (
          <div className="cardrow" style={{ '--w': 'var(--cw-sm)', '--ov': 0.55 } as CSSProperties}>
            {Array.from({ length: 8 }, (_, i) => (
              <PlayingCard key={i} faceDown w="var(--cw-sm)" />
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

export default function ShuangshengBoard({ ctl }: { ctl: Ctl }) {
  const v = ctl.view!;
  const players = ctl.players;
  const spectator = ctl.seat === null;
  const me = ctl.seat ?? 0;
  const right = (me + 1) % 4;
  const top = (me + 2) % 4;
  const left = (me + 3) % 4;
  const myTeam = sh.teamOf(me);
  const ctx: sh.SsCtx = { level: v.level, trump: v.decl ? v.decl.suit : null };

  const over = v.phase === 'roundOver' || v.phase === 'matchOver';
  const playing = v.phase === 'play';
  const myTurn = !spectator && playing && v.waiting === me;
  const myBury = !spectator && v.phase === 'bury' && v.burier === me;
  const myChoice = !spectator && (v.phase === 'declare' || v.phase === 'fan') && v.waiting === me;
  const canDeclare = !spectator && v.declOptions.length > 0;

  const [peek, setPeek] = useState<null | 'bottom' | 'last'>(null);
  const [sel, setSel] = useSelection(v.hand, `${v.round}-${v.phase}-${v.burier}`);
  useTurnCue(myTurn || myBury || myChoice);
  useShuangshengVoice(v, players);

  const act = (a: sh.SsAction) => {
    const err = ctl.act(a);
    if (err) toast(err, 'error');
    return !err;
  };

  const resultRound = useRef(0);
  useEffect(() => {
    const r = v.result;
    if (!r || resultRound.current === r.round || spectator) return;
    resultRound.current = r.round;
    const winTeam = r.side === 'dealer' ? r.dealerTeam : 1 - r.dealerTeam;
    playSound(winTeam === myTeam ? 'win' : 'lose');
  }, [v.result, myTeam, spectator]);

  const selected = v.hand.filter((c) => sel.has(c.id));
  const lead = v.trick?.plays[0]?.cards ?? null;
  const playError = useMemo(() => {
    if (!myTurn) return null;
    if (!selected.length) return '';
    return lead ? sh.followError(v.hand, lead, selected, ctx) : sh.leadError(selected, ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTurn, sel, ctl.version]);
  const throwing = myTurn && !lead && !playError && sh.isThrow(selected, ctx);

  const hint = () => {
    const a = ctl.def.bot(v, me, new Rng(ctl.version + 7)) as sh.SsAction;
    if (a.type === 'play' || a.type === 'bury') setSel(new Set(a.cards));
  };

  const fromBottom = useMemo(() => new Set(v.fromBottom), [v.fromBottom]);
  const markOf = useMemo(
    () => markFor(v),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [v.level, v.decl?.suit, v.decl === null],
  );
  // 本墩目前最大的一家（实时）
  const bigSeat = v.trick && v.trick.plays.length ? (v.trick.winner ?? v.winning) : null;
  const zoneCls = (s: number) => (bigSeat === s ? 'is-big' : '');
  const bigTag = (s: number) =>
    bigSeat === s ? (
      <span className="sj-bigtag">{v.trick?.winner != null ? '最大' : '目前最大'}</span>
    ) : null;

  const trickMove = (s: number) => {
    const p = v.trick?.plays.find((x) => x.seat === s);
    return p ? { type: 'play' as const, cards: p.cards } : null;
  };

  const bubbleOf = (s: number) => {
    if (v.throwFail && v.throwFail.seat === s && playing) return '甩牌失败';
    if (v.phase === 'trickEnd' && v.trick?.winner === s)
      return v.trick.points ? `最大 · ${v.trick.points} 分` : '最大';
    if ((v.phase === 'declare' || v.phase === 'fan') && v.waiting === s)
      return v.phase === 'fan' ? '考虑反主' : '考虑亮主';
    if (v.phase === 'bury' && v.burier === s) return '扣底中';
    return undefined;
  };

  const tagOf = (s: number) => (v.dealer === s ? '庄' : undefined);

  // 扣完底之后，在最后扣底那家的头像下面放「底牌」入口
  const bottomReady =
    v.burier !== null && (v.phase === 'fan' || v.phase === 'play' || v.phase === 'trickEnd');
  const bottomBtn = (s: number) =>
    bottomReady && v.burier === s ? (
      <button type="button" className="sj-peek-btn is-bottom" onClick={() => setPeek('bottom')}>
        <Eye size={13} /> 底牌
      </button>
    ) : null;

  const seatEl = (s: number, side: 'left' | 'right' | 'top') => (
    <Seat
      player={players[s]}
      active={v.waiting === s && (playing || v.phase === 'bury' || myChoiceFor(v, s))}
      deadline={ctl.deadlines[s]}
      tag={tagOf(s)}
      sub={
        <>
          <CountChip n={v.handCounts[s]} warnAt={0} />
          {bottomBtn(s)}
        </>
      }
      layout={side === 'top' ? 'row' : 'column'}
      bubble={bubbleOf(s)}
      bubbleSide={side === 'left' ? 'right' : side === 'right' ? 'left' : 'bottom'}
      className={sh.teamOf(s) === myTeam ? 'is-ally' : ''}
    />
  );

  const dealerName = v.dealer !== null ? players[v.dealer]?.name : null;
  const showDeclBox =
    v.phase === 'deal' ||
    v.phase === 'declare' ||
    v.phase === 'flip' ||
    v.phase === 'bury' ||
    v.phase === 'fan' ||
    (playing && !!v.trick && v.trick.plays.length === 0 && !v.lastTrick);

  return (
    <div className="sj">
      <div className="rotate-tip">
        <RotateCw size={12} /> 横屏体验更佳
      </div>
      <div className="sj__info info-chips top-info">
        <span className="chip">
          第 <b className="num">{v.round}</b> 局
        </span>
        <span className="chip is-gold">
          打 <b>{lv(v.level)}</b>
        </span>
        <span className={`chip ${v.trumpKnown ? 'is-gold' : ''}`}>
          主 <b>{trumpText(v)}</b>
        </span>
        {dealerName && (
          <span className="chip">
            庄 <b>{dealerName}</b>
          </span>
        )}
        <span className="chip">
          闲家得分 <b className="num">{v.points}</b>
        </span>
        <span className={`chip ${v.dealerTeam === myTeam ? 'is-gold' : ''}`}>
          {spectator ? '南北' : '我方'} <b>{lv(v.levels[myTeam])}</b>
          {v.pre?.[myTeam] && <small> 510K</small>}
        </span>
        <span className={`chip ${v.dealerTeam !== myTeam ? 'is-gold' : ''}`}>
          {spectator ? '东西' : '对方'} <b>{lv(v.levels[1 - myTeam])}</b>
          {v.pre?.[1 - myTeam] && <small> 510K</small>}
        </span>
      </div>

      <div className="sj__seat is-left">{seatEl(left, 'left')}</div>
      <div className="sj__seat is-right">{seatEl(right, 'right')}</div>

      <div className="sj__center">
        <div className="sj__top">{seatEl(top, 'top')}</div>
        {!over && <CenterInfo v={v} />}
        {!over && v.trumpKnown && (
          <ScoreBig
            points={v.points}
            onLast={
              v.lastTrick && (playing || v.phase === 'trickEnd') ? () => setPeek('last') : undefined
            }
          />
        )}
        <div className={`sj__zone is-top ${zoneCls(top)}`}>
          <MoveZone move={trickMove(top)} from="top" markOf={markOf} />
          {bigTag(top)}
        </div>
        <div className={`sj__zone is-left ${zoneCls(left)}`}>
          <MoveZone move={trickMove(left)} from="left" markOf={markOf} />
          {bigTag(left)}
        </div>
        <div className={`sj__zone is-right ${zoneCls(right)}`}>
          <MoveZone move={trickMove(right)} from="right" markOf={markOf} />
          {bigTag(right)}
        </div>
        <div className={`sj__zone is-me ${zoneCls(me)}`}>
          <MoveZone move={trickMove(me)} from="bottom" markOf={markOf} />
          {bigTag(me)}
        </div>
        {showDeclBox && <DeclBox v={v} players={players} />}
        {playing && v.throwFail && (
          <div className="sj-throw">
            <span>{players[v.throwFail.seat]?.name} 甩牌失败，只能出最小的一组</span>
            <CardRow cards={v.throwFail.tried} w="var(--cw-xs)" overlap={0.5} />
          </div>
        )}
      </div>

      <div className="sj__me">
        <div className="sj__myseat">
          <Seat
            player={players[me]}
            active={myTurn || myBury || myChoice}
            deadline={ctl.deadlines[me]}
            tag={tagOf(me)}
            layout="row"
            size={52}
            sub={
              <>
                <CountChip n={v.handCounts[me]} warnAt={0} />
                {bottomBtn(me)}
              </>
            }
          />
        </div>

        {canDeclare && (
          <div className="action-bar">
            <span className="action-hint">
              {v.phase === 'fan' ? '可以反主' : v.phase === 'deal' ? '可以亮主' : '轮到你亮主'}
            </span>
            {v.declOptions.map((o, i) => (
              <Button
                key={i}
                variant="felt-primary"
                onClick={() => act({ type: 'declare', cards: o.cards.map((c) => c.id) })}
              >
                {v.phase === 'fan' ? '反' : '亮'} {sh.declLabel(o)}
              </Button>
            ))}
            <Button variant="felt" onClick={() => act({ type: 'pass' })}>
              {v.phase === 'fan' ? '不反' : '不亮'}
            </Button>
          </div>
        )}

        {myBury && (
          <div className="action-bar">
            <span className="action-hint">
              选择 <b>8</b> 张牌扣底（已选 {selected.length}）
            </span>
            <Button variant="felt" onClick={hint}>
              提示
            </Button>
            <Button
              variant="felt-primary"
              disabled={selected.length !== 8}
              onClick={() => act({ type: 'bury', cards: [...sel] }) && setSel(new Set())}
            >
              扣底
            </Button>
          </div>
        )}

        {myTurn && (
          <div className="action-bar">
            <Button variant="felt" onClick={hint}>
              提示
            </Button>
            <Button
              variant="felt-primary"
              disabled={playError !== null}
              onClick={() => act({ type: 'play', cards: [...sel] }) && setSel(new Set())}
            >
              出牌
            </Button>
            {throwing && <span className="pattern-tag">甩牌</span>}
            {playError && <span className="action-hint">{playError}</span>}
          </div>
        )}

        {!myTurn && !myBury && !canDeclare && !spectator && !over && (
          <div className="action-hint">{waitingText(v, players)}</div>
        )}
      </div>

      <div className="sj__hand">
        {!spectator && (
          <Hand
            cards={v.hand}
            selected={sel}
            onChange={myTurn || myBury ? setSel : playing ? setSel : undefined}
            highlight={fromBottom}
            markOf={markOf}
            dealKey={v.round}
          />
        )}
      </div>

      {peek === 'bottom' && bottomReady && (
        <BottomSheet v={v} players={players} markOf={markOf} onClose={() => setPeek(null)} />
      )}
      {peek === 'last' && v.lastTrick && !over && (
        <LastTrickSheet v={v} players={players} markOf={markOf} onClose={() => setPeek(null)} />
      )}
      {over && v.result && <RoundResult ctl={ctl} v={v} me={me} spectator={spectator} />}
    </div>
  );
}

function myChoiceFor(v: sh.SsView, s: number) {
  return (v.phase === 'declare' || v.phase === 'fan') && v.waiting === s;
}

function waitingText(v: sh.SsView, players: { name: string }[]): string {
  const name = (s: number | null) => (s === null ? '' : (players[s]?.name ?? ''));
  switch (v.phase) {
    case 'deal':
      return `发牌中 ${v.dealt}/100${v.round === 1 && !v.decl ? '，可随时亮主' : ''}`;
    case 'declare':
      return `等待 ${name(v.waiting)} 亮主`;
    case 'flip':
      return '无人亮主，翻底定主…';
    case 'bury':
      return `等待 ${name(v.burier)} 扣底`;
    case 'fan':
      return `等待 ${name(v.waiting)} 决定是否反主`;
    case 'play':
      return `等待 ${name(v.waiting)} 出牌`;
    case 'trickEnd':
      return v.trick?.winner != null ? `${name(v.trick.winner)} 这一墩最大` : '';
    default:
      return '';
  }
}

function DeclBox({ v, players }: { v: sh.SsView; players: { name: string }[] }) {
  const d = v.decl;
  if (!d && !v.flipped.length) {
    if (v.phase !== 'deal' && v.phase !== 'declare') return null;
    return (
      <div className="sj-decl">
        <span className="sj-decl__title">
          {v.phase === 'deal' ? `发牌中 ${v.dealt}/100` : '亮主中'}
        </span>
        <span className="sj-decl__sub">级牌 + 同色王亮主：♠♣ 配小王，♥♦ 配大王</span>
      </div>
    );
  }
  return (
    <div className="sj-decl">
      {d && (
        <span className="sj-decl__title">
          {d.fallback
            ? `翻完底牌未定主，${players[d.seat]?.name} 坐庄打无主`
            : d.flip
              ? `翻底定主：${trumpText(v)}，${players[d.seat]?.name} 坐庄`
              : `${players[d.seat]?.name} ${v.dealer !== null && v.dealer !== d.seat ? '反' : '亮'}主：${trumpText(v)}`}
        </span>
      )}
      {d && !d.flip && d.cards.length > 0 && (
        <CardRow cards={d.cards} w="var(--cw-xs)" overlap={0.3} />
      )}
      {v.flipped.length > 0 && (
        <>
          <span className="sj-decl__sub">翻出的底牌</span>
          <CardRow cards={v.flipped} w="var(--cw-xs)" overlap={0.3} />
        </>
      )}
    </div>
  );
}

function RoundResult({
  ctl,
  v,
  me,
  spectator,
}: {
  ctl: Ctl;
  v: sh.SsView;
  me: number;
  spectator: boolean;
}) {
  const r = v.result!;
  const myTeam = sh.teamOf(me);
  const matchOver = v.phase === 'matchOver';
  const winTeam = r.side === 'dealer' ? r.dealerTeam : 1 - r.dealerTeam;
  const win = winTeam === myTeam;
  const readyCount = v.ready.filter(Boolean).length;
  const teamName = (t: number) =>
    spectator ? (t === 0 ? '南北' : '东西') : t === myTeam ? '我方' : '对方';
  const title = matchOver
    ? spectator
      ? `${teamName(winTeam)}获胜`
      : win
        ? '打过 A，赢得整场'
        : '对方打过 A'
    : r.side === 'dealer'
      ? `${teamName(r.dealerTeam)}守庄`
      : `${teamName(1 - r.dealerTeam)}上台`;
  const sub = r.matchWon
    ? '赢得整场'
    : r.up > 0
      ? `${teamName(winTeam)}升 ${r.up} 级`
      : `${teamName(winTeam)}上台，不升级`;

  return (
    <Sheet
      open
      dismissible={false}
      footer={
        matchOver ? (
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
            onClick={() => ctl.act({ type: 'ready' })}
          >
            {v.ready[me] ? `等待其他玩家 ${readyCount}/4` : '继续下一局'}
          </Button>
        )
      }
    >
      <div className="result">
        <div className={`result__title ${win || spectator ? 'is-win' : 'is-lose'}`}>{title}</div>
        <div className="result__sub">
          第 {r.round} 局 · 打 {lv(r.level)} · 庄家 {ctl.players[r.dealer]?.name} · {sub}
        </div>
        <div className="sj-score">
          <div>
            <span>闲家得分</span>
            <b className="num">{r.defenderPoints}</b>
          </div>
          <div>
            <span>底牌分</span>
            <b>
              {r.bottomPoints}
              {r.scored && r.bottomPoints > 0
                ? ` × ${r.multiplier}（抠底）`
                : r.scored
                  ? ''
                  : '（庄方守底）'}
            </b>
          </div>
        </div>
        <div className="sj-bottom">
          <span>底牌</span>
          <CardRow cards={r.bottom} w="var(--cw-xs)" overlap={0.4} />
        </div>
        <div className="sj-levels">
          {[myTeam, 1 - myTeam].map((t) => (
            <div key={t}>
              <span>
                <Avatar
                  name={ctl.players[t === myTeam ? me : (me + 1) % 4].name}
                  avatar={ctl.players[t === myTeam ? me : (me + 1) % 4].avatar}
                  size={22}
                />
                {teamName(t)}
              </span>
              <b>
                {lv(r.levelsBefore[t])}
                {r.levelsAfter[t] !== r.levelsBefore[t] && <> → {lv(r.levelsAfter[t])}</>}
                {r.reset && t === r.dealerTeam && <small>（丢庄，退回 5）</small>}
                {r.preBefore?.[t] && r.preAfter && !r.preAfter[t] && (
                  <small>{r.levelsAfter[t] === 3 ? '（打 K 大光，直接打 3）' : '（打过 K）'}</small>
                )}
              </b>
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
