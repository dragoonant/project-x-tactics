// M1 debug page: the Night Market from above, driven by the random-legal-action policy.
// Every number shown comes from the engine state or query.*; this file never computes rules.
import { StrictMode, useCallback, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createGame, query, randomAction, step } from '../engine'
import type { GameEvent, State, Unit } from '../engine'
import './debug.css'

const CELL = 26
const SQUAD = ['recruit', 'enforcer', 'bulwark', 'marksman', 'vox', 'chem']
const END_CHANCE = 0.08

function fmt(e: GameEvent): string {
  const t = `r${e.round}`
  switch (e.kind) {
    case 'attack': {
      const b = e.breakdown
      return `${t} ${e.attacker} ${e.via} ${e.target}: ${e.outcome} (chance ${b.chance}%, roll ${e.roll})`
    }
    case 'damage': return `${t} ${e.target} takes ${e.hp} hp / ${e.resolve} resolve (hp ${e.hpLeft}, resolve ${e.resolveLeft})`
    case 'move': return `${t} ${e.unit} moves ${e.cost} tiles`
    case 'surrender': return `${t} ${e.unit} surrenders`
    case 'death': return `${t} ${e.unit} dies`
    case 'downed': return `${t} ${e.unit} is downed`
    case 'cuffed': return `${t} ${e.unit} cuffed by ${e.by}`
    case 'alarm': return `${t} ALARM ${e.from} to ${e.to} (${e.reason})`
    case 'wave': return `${t} reinforcements: wave ${e.wave}`
    case 'groupAware': return `${t} group ${e.group} is aware (${e.reason})`
    case 'ability': return `${t} ${e.unit} uses ${e.ability}${e.target ? ' on ' + e.target : ''}`
    case 'attackAction': return `${t} ${e.unit} attacks ${e.target ?? 'a lamp'}`
    case 'phaseStart': return `${t} -- ${e.side} phase --`
    case 'missionEnd': return `${t} MISSION ${String(e.outcome).toUpperCase()}`
    case 'step': case 'phaseEnd': case 'noise': return ''
    default: return `${t} ${e.kind}${e.unit ? ' ' + e.unit : ''}`
  }
}

function unitColor(u: Unit): string {
  if (u.side === 'squad') return '#4aa3ff'
  if (u.side === 'syndicate') return u.kind === 'bagman' ? '#ff4fd0' : '#ff5a4a'
  return '#e8d36a'
}

function newGame(seed: number): State {
  return createGame({ mapId: 'bust-01', squad: SQUAD, seed })
}

function App() {
  const [seed, setSeed] = useState(1)
  const [seedText, setSeedText] = useState('1')
  const [state, setState] = useState<State>(() => newGame(1))
  const [log, setLog] = useState<string[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  const push = useCallback((lines: string[]) => {
    setLog((l) => [...l, ...lines.filter(Boolean)].slice(-600))
    requestAnimationFrame(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight })
  }, [])

  const stepRandom = useCallback(() => {
    setState((s) => {
      if (s.outcome) return s
      const r = step(s, randomAction(s, 0, undefined, END_CHANCE))
      if (!r.ok) { push([`rejected: ${r.reason}`]); return s }
      push(r.events.map(fmt))
      return r.state
    })
  }, [push])

  const runToEnd = useCallback(() => {
    setState((s) => {
      let cur = s
      const lines: string[] = []
      let n = 0
      while (!cur.outcome && cur.round <= cur.tuning.sim.maxRounds && n < 5000) {
        const r = step(cur, randomAction(cur, 0, undefined, END_CHANCE))
        if (!r.ok) { lines.push(`rejected: ${r.reason}`); break }
        for (const e of r.events) lines.push(fmt(e))
        cur = r.state
        n++
      }
      if (!cur.outcome) lines.push(`stopped at the stall cap (round ${cur.round})`)
      push(lines)
      return cur
    })
  }, [push])

  const reset = useCallback((sd: number) => {
    setSeed(sd)
    setSeedText(String(sd))
    setState(newGame(sd))
    setLog([])
  }, [])

  const summary = useMemo(() => query.summary(state), [state])
  const w = state.map.w * CELL
  const h = state.map.h * CELL
  const onBoard = state.units.filter((u) => u.status !== 'dead' && u.status !== 'escaped' && u.status !== 'safe')

  const tileEls: React.ReactNode[] = []
  for (let y = 0; y < state.map.h; y++) {
    for (let x = 0; x < state.map.w; x++) {
      const t = state.map.tiles[y * state.map.w + x]!
      const lit = query.isLit(state, x, y)
      let fill = lit ? '#6b6340' : '#262a33'
      if (t.k === 'wall') fill = '#0d0e12'
      if (t.k === 'exit') fill = '#245a34'
      if (t.k === 'escape') fill = '#2b4d8a'
      if (t.k === 'door') fill = t.open ? '#6a5230' : '#a0703a'
      tileEls.push(<rect key={`t${x},${y}`} x={x * CELL} y={y * CELL} width={CELL} height={CELL} fill={fill} stroke="#14161c" strokeWidth={0.5} />)
      if (t.o === 'halfCover' || t.o === 'rubble') tileEls.push(<rect key={`o${x},${y}`} x={x * CELL + 6} y={y * CELL + 8} width={CELL - 12} height={CELL - 16} fill={t.o === 'rubble' ? '#7a7260' : '#9a7b4f'} />)
      if (t.o === 'fullCover') tileEls.push(<rect key={`o${x},${y}`} x={x * CELL + 3} y={y * CELL + 3} width={CELL - 6} height={CELL - 6} fill="#b9b9c4" />)
      if (t.o === 'lamp') tileEls.push(<circle key={`o${x},${y}`} cx={x * CELL + CELL / 2} cy={y * CELL + CELL / 2} r={5} fill="#ffe27a" stroke="#fff6c4" />)
    }
  }
  for (const p of state.map.extraction) tileEls.push(<rect key={`x${p.x},${p.y}`} x={p.x * CELL + 1} y={p.y * CELL + 1} width={CELL - 2} height={CELL - 2} fill="none" stroke="#5fe08a" strokeDasharray="3 3" />)
  for (const g of state.gas) for (let y = g.y - g.r; y <= g.y + g.r; y++) for (let x = g.x - g.r; x <= g.x + g.r; x++) tileEls.push(<rect key={`g${g.x},${g.y},${x},${y}`} x={x * CELL} y={y * CELL} width={CELL} height={CELL} fill="#6cd36c" opacity={0.35} />)
  for (const g of state.smoke) for (let y = g.y - g.r; y <= g.y + g.r; y++) for (let x = g.x - g.r; x <= g.x + g.r; x++) tileEls.push(<rect key={`m${g.x},${g.y},${x},${y}`} x={x * CELL} y={y * CELL} width={CELL} height={CELL} fill="#c8c8c8" opacity={0.5} />)
  for (const g of state.scans) tileEls.push(<circle key={`sc${g.x},${g.y}`} cx={g.x * CELL + CELL / 2} cy={g.y * CELL + CELL / 2} r={g.r * CELL} fill="none" stroke="#4aa3ff" strokeDasharray="4 4" />)

  const unitEls = onBoard.map((u) => {
    const cx = u.x * CELL + CELL / 2, cy = u.y * CELL + CELL / 2
    const inert = u.status === 'downed' || u.status === 'stabilized' || u.status === 'surrendered' || u.status === 'cuffed'
    return (
      <g key={u.id} opacity={inert ? 0.65 : 1}>
        {u.status === 'cuffed' || u.status === 'surrendered'
          ? <rect x={cx - 9} y={cy - 9} width={18} height={18} fill="none" stroke={unitColor(u)} strokeWidth={2} />
          : <circle cx={cx} cy={cy} r={9} fill={unitColor(u)} stroke={u.status === 'downed' ? '#fff' : '#111'} strokeWidth={u.status === 'downed' ? 2 : 1} />}
        <text x={cx} y={cy + 3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="#0b0c10">{u.kind === 'civilian' ? 'c' : u.kind[0]!.toUpperCase()}</text>
        {u.side !== 'civilians' && <text x={cx} y={cy - 11} textAnchor="middle" fontSize={8} fill="#fff">{u.hp}{u.maxResolve ? `/${u.resolve}` : ''}</text>}
      </g>
    )
  })

  return (
    <div className="page">
      <div className="board">
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Night Market, top-down">
          {tileEls}
          {unitEls}
        </svg>
      </div>
      <div className="side">
        <div className="hud">
          <div><b>Round</b> {state.round} <b>Phase</b> {state.phase} <b>Alarm</b> {state.alarm}/{state.tuning.alarm.max}</div>
          <div><b>Seed</b> {seed} <b>Steps</b> {state.steps} <b>Support</b> {state.supportCharges}</div>
          <div className={state.outcome ? 'outcome done' : 'outcome'}>
            {state.outcome ? `Mission ${state.outcome}` : 'Mission in progress'} &middot; intel {summary.intel} &middot; civilians lost {summary.civilianCasualties} &middot; troopers down {summary.troopersDowned}
          </div>
        </div>
        <div className="controls">
          <button type="button" onClick={stepRandom} disabled={!!state.outcome}>Step random</button>
          <button type="button" onClick={runToEnd} disabled={!!state.outcome}>Run to end</button>
          <button type="button" onClick={() => reset(Math.floor(Math.random() * 1_000_000) + 1)}>New seed</button>
          <label className="seed">
            Seed
            <input value={seedText} inputMode="numeric" onChange={(e) => setSeedText(e.target.value)} />
          </label>
          <button type="button" onClick={() => { const n = Number(seedText); if (Number.isFinite(n)) reset(Math.floor(n)) }}>Load seed</button>
        </div>
        <div className="legend">
          <span className="sw" style={{ background: '#4aa3ff' }} /> squad
          <span className="sw" style={{ background: '#ff5a4a' }} /> syndicate
          <span className="sw" style={{ background: '#ff4fd0' }} /> Bagman
          <span className="sw" style={{ background: '#e8d36a' }} /> civilian
          <span className="sw" style={{ background: '#6b6340' }} /> lit
          <span className="sw" style={{ background: '#262a33' }} /> dark
        </div>
        <div className="log" ref={logRef}>
          {log.length === 0 ? <div className="dim">No events yet. Press Step random or Run to end.</div> : log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
