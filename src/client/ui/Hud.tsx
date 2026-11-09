// The Bodycam-feed HUD. Every number is read from the state or from query.* (rule 8): this file formats, it never computes rules.
import { useEffect, useMemo, useRef, useState } from 'react'
import { query } from '../../engine'
import type { State, Unit } from '../../engine'
import { WEAPONS } from '../../data'
import { boardApi } from '../board/CameraRig'
import { cancelArm, chooseAbility, endTurn, entriesFor, selectUnit, updateSettings } from '../game/controller'
import { ABILITY_TEXT, callSign } from '../game/names'
import { useStore } from '../game/store'
import { passiveList, type AbilityEntry } from '../game/tap'

export function statusChips(u: Unit): { text: string; kind: '' | 'bad' | 'good' }[] {
  const c: { text: string; kind: '' | 'bad' | 'good' }[] = []
  if (u.status === 'downed') c.push({ text: `DOWNED, bleeds in ${u.bleed}`, kind: 'bad' })
  else if (u.status === 'stabilized') c.push({ text: 'STABILIZED', kind: 'good' })
  else if (u.status === 'dead') c.push({ text: 'DEAD', kind: 'bad' })
  else if (u.status === 'surrendered') c.push({ text: 'SURRENDERED', kind: 'good' })
  else if (u.status === 'cuffed') c.push({ text: 'CUFFED', kind: 'good' })
  if (u.overwatch === 'overwatch') c.push({ text: 'OVERWATCH', kind: '' })
  if (u.overwatch === 'longWatch') c.push({ text: 'LONG WATCH', kind: '' })
  if (u.hunkered) c.push({ text: 'HUNKERED', kind: '' })
  if (u.suppressedBy) c.push({ text: 'SUPPRESSED', kind: 'bad' })
  if (u.pinned || u.noMove) c.push({ text: 'PINNED', kind: 'bad' })
  if (u.stunned) c.push({ text: 'STUNNED', kind: 'bad' })
  if (u.marked > 0) c.push({ text: 'MARKED', kind: 'bad' })
  if (u.fleeing) c.push({ text: 'FLEEING', kind: 'bad' })
  if (u.panicked) c.push({ text: 'PANICKED', kind: 'bad' })
  return c
}

const pad = (n: number): string => String(n).padStart(2, '0')
function useClock(): string {
  const t0 = useRef(Date.now())
  const [, tick] = useState(0)
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(i) }, [])
  const secs = 2 * 3600 + 14 * 60 + Math.floor((Date.now() - t0.current) / 1000)
  return `${pad(Math.floor(secs / 3600) % 24)}:${pad(Math.floor(secs / 60) % 60)}:${pad(secs % 60)}`
}

function useWide(): boolean {
  const [w, setW] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches)
  useEffect(() => {
    const m = window.matchMedia('(min-width: 900px)')
    const f = (): void => setW(m.matches)
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [])
  return w
}

function hpClass(u: Unit): string { const f = u.hp / Math.max(1, u.maxHp); return f > 0.6 ? '' : f > 0.3 ? 'hp-mid' : 'hp-low' }

function TopLeft({ state }: { state: State }): React.JSX.Element {
  const clock = useClock()
  const phaseName = state.phase === 'squad' ? 'SQUAD PHASE' : state.phase === 'syndicate' ? 'SYNDICATE PHASE' : 'CIVILIAN PHASE'
  return (
    <div className="topleft panel">
      <div className="row"><span className="rec-dot" /><span className="rec">REC</span><span className="cam">CAM-04 NIGHT MARKET</span></div>
      <div className="row"><span className="stamp">{clock}</span><span className="round">ROUND {pad(state.round)}</span><span className={`phase${state.phase !== 'squad' ? ' hostile' : ''}`} data-testid="phase">{phaseName}</span></div>
      <div className="seedline">SEED {state.setup.seed} / ACTIONS {state.log.length}</div>
    </div>
  )
}

function AlarmPanel({ state }: { state: State }): React.JSX.Element {
  const max = state.tuning.alarm.max
  const ticks = [state.tuning.alarm.t1, state.tuning.alarm.t2, state.tuning.alarm.t3]
  return (
    <div className="alarm panel" data-testid="alarm">
      <div className="lab"><span>ALARM</span><span><b>{state.alarm}</b> / {max}</span></div>
      <div className="meter">{Array.from({ length: max }, (_, i) => <i key={i} className={`${i < state.alarm ? 'on' : ''}${i < state.alarm && i + 1 >= ticks[1]! ? ' hot' : ''}`} />)}</div>
      <div className="ticks">{ticks.map((t) => <span key={t} style={{ left: `${((t - 0.5) / max) * 100}%` }}><em>{t}</em></span>)}</div>
    </div>
  )
}

function Ticker(): React.JSX.Element {
  const lines = useStore((s) => s.ticker)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight }, [lines])
  return (
    <div className="ticker panel pa" data-testid="ticker-panel">
      <h4>TELEMETRY</h4>
      <div className="lines" ref={ref} data-testid="ticker">
        {lines.slice(-40).map((l) => <div key={l.id} className={`ln t-${l.tone}`}><small>R{l.round}</small>{l.text}</div>)}
      </div>
    </div>
  )
}

function UnitCard({ state, unit }: { state: State; unit: Unit }): React.JSX.Element {
  const cover = query.coverPerSide(state, unit.id)
  const w = unit.weapon ? WEAPONS[unit.weapon]?.name ?? unit.weapon : 'none'
  const chips = statusChips(unit)
  const title = unit.side === 'squad' ? callSign(unit) : unit.name
  return (
    <div className="hovercard panel show-phone" data-testid="hovercard">
      <h4>{unit.side === 'squad' ? 'TROOPER' : unit.side === 'syndicate' ? 'HOSTILE' : 'CIVILIAN'}</h4>
      <div className="body">
        <div className="nm">{title}<small>{unit.side === 'squad' ? unit.name : unit.id.toUpperCase()}</small></div>
        <div className="phone-line">HP {unit.hp}/{unit.maxHp}{unit.maxResolve > 0 ? ` / RES ${unit.resolve}/${unit.maxResolve}` : ''}</div>
        <div className="kv"><span>HEALTH</span><b>{unit.hp} / {unit.maxHp}</b></div>
        <div className={`bar ${hpClass(unit)}`}><i style={{ width: `${(unit.hp / Math.max(1, unit.maxHp)) * 100}%` }} /></div>
        {unit.maxResolve > 0 && <><div className="kv"><span>RESOLVE</span><b>{unit.resolve} / {unit.maxResolve}</b></div><div className="bar res"><i style={{ width: `${(unit.resolve / unit.maxResolve) * 100}%` }} /></div></>}
        <div className="kv"><span>WEAPON</span><b>{w}</b></div>
        <div className="kv"><span>AIM / MOVE</span><b>{unit.aim} / {unit.mobility}</b></div>
        {cover && <div className="kv"><span>COVER N E S W</span><b>{(['N', 'E', 'S', 'W'] as const).map((k) => cover[k].level === 'none' ? '-' : cover[k].level === 'half' ? 'H' : 'F').join(' ')}</b></div>}
        {chips.length > 0 && <div className="chips">{chips.map((c) => <span key={c.text} className={`chip ${c.kind}`}>{c.text}</span>)}</div>}
      </div>
    </div>
  )
}

function Signed({ n }: { n: number }): React.JSX.Element { return <b>{n > 0 ? `+${n}` : n}</b> }

function TargetPanel({ state, sel, enemy }: { state: State; sel: Unit; enemy: Unit }): React.JSX.Element | null {
  const armed = useStore((s) => s.armed)
  const ability = armed && armed.ability !== 'attack' ? armed.ability : undefined
  const p = useMemo(() => query.preview(state, sel.id, enemy.id, ability), [state, sel.id, enemy.id, ability])
  const noise = useMemo(() => query.noiseInfo(state, sel.id, ability), [state, sel.id, ability])
  if (!p) return null
  const b = p.breakdown
  const cls = b.chance >= 60 ? '' : b.chance >= 35 ? 'mid' : 'low'
  const rng = (r: [number, number]): string => { const lo = Math.min(r[0], r[1]), hi = Math.max(r[0], r[1]); return lo === hi ? `${lo}` : `${lo}-${hi}` }
  return (
    <div className="target panel" data-testid="target-panel">
      <h4>TARGET LOCK / {enemy.name.toUpperCase()} {enemy.id.toUpperCase()}</h4>
      <div className="big"><b className={cls} data-testid="hit-chance">{b.chance}%</b><span>HIT</span><b className="mid" style={{ fontSize: 16 }}>{b.grazeChance}%</b><span>GRAZE</span><span>MISS {b.missChance}%</span></div>
      <div className="rows">
        <div><span>Aim</span><Signed n={b.aim} /></div>
        {b.range !== 0 && <div><span>Range ({b.distance})</span><Signed n={b.range} /></div>}
        {b.mods.map((m) => <div key={m.name}><span>{m.name}</span><Signed n={m.value} /></div>)}
        <div><span>Cover: {b.cover.level}{b.cover.hunkered ? ' (hunkered)' : ''}{b.cover.flanked ? ' (flanked)' : ''}</span><Signed n={-b.cover.value} /></div>
        {b.defence !== 0 && <div><span>Defence</span><Signed n={-b.defence} /></div>}
        <div className="tot"><span>Hit chance</span><b>{b.chance}%</b></div>
        <div><span>Damage hit / graze</span><b>{rng(p.damage.hit)} / {rng(p.damage.graze)}</b></div>
        <div><span>Resolve hit / graze / miss</span><b>{rng(p.resolve.hit)} / {rng(p.resolve.graze)} / {p.resolve.miss}</b></div>
      </div>
      <div className="flag">
        {p.flanked && <span className="chip good">FLANK</span>}
        {p.kills && <span className="chip bad">CAN KILL</span>}
        {p.surrenders && <span className="chip good">CAN BREAK RESOLVE</span>}
        {noise.loud ? <span className="chip bad">LOUD: {noise.groups.length} group(s) would wake</span> : <span className="chip good">QUIET</span>}
      </div>
    </div>
  )
}

function Channels({ state }: { state: State }): React.JSX.Element {
  const sel = useStore((s) => s.selected)
  const busy = useStore((s) => s.busy)
  const troopers = state.units.filter((u) => u.side === 'squad')
  return (
    <div className="chans pa" data-testid="channels">
      {troopers.map((u, i) => {
        const chips = statusChips(u)
        return (
          <button key={u.id} className={`chan${sel === u.id ? ' sel' : ''}${u.status === 'dead' ? ' dead' : ''}`} onClick={() => selectUnit(u.id)} disabled={busy} data-unit={u.id}>
            <span className="t"><b>{callSign(u)}</b><span>CH-{i + 1}</span></span>
            <span className="cls">{u.name}</span>
            <span className="vit"><span className={`bar ${hpClass(u)}`}><i style={{ width: `${(u.hp / Math.max(1, u.maxHp)) * 100}%` }} /></span><em>{u.hp}/{u.maxHp}</em></span>
            <span className="pips">{[0, 1].map((k) => <i key={k} className={u.actions > k ? 'on' : ''} />)}{chips[0] && <span className={`chip ${chips[0].kind}`} style={{ marginLeft: 6 }}>{chips[0].text}</span>}</span>
          </button>
        )
      })}
    </div>
  )
}

function AbilityBar({ state, unit }: { state: State; unit: Unit }): React.JSX.Element {
  const armed = useStore((s) => s.armed)
  const busy = useStore((s) => s.busy)
  const [focus, setFocus] = useState<string>('')
  const entries = useMemo(() => (state.phase === 'squad' && unit.status === 'active' ? entriesFor(state, unit.id) : []), [state, unit.id, unit.status])
  const passives = passiveList(unit)
  const click = (e: AbilityEntry): void => { setFocus(e.key); void chooseAbility(e) }
  const focusEntry = entries.find((e) => e.key === focus)
  return (
    <>
      <div className="abilities pa" data-testid="abilities">
        {entries.map((e) => (
          <button key={e.key} data-ability={e.key} aria-disabled={!e.enabled || busy} className={armed && armed.ability === e.ability && armed.option === e.option ? 'armed' : ''} onClick={() => click(e)} onMouseEnter={() => setFocus(e.key)}>
            {e.label}{e.loud && <span className="loud">LOUD</span>}
          </button>
        ))}
        {entries.length === 0 && <span className="passive">{unit.status === 'active' ? (state.phase === 'squad' ? 'No orders available' : 'Waiting for the syndicate phase to end') : statusChips(unit)[0]?.text ?? 'Out of action'}</span>}
        {passives.map((p) => <span key={p.label} className="passive" data-passive>{p.label}: {p.text}</span>)}
        {armed && <button className="danger" onClick={() => cancelArm()}>Cancel</button>}
      </div>
      {focusEntry && <div className="abdesc panel" data-testid="abdesc">{focusEntry.text}{!focusEntry.enabled && focusEntry.reason ? ` Unavailable: ${focusEntry.reason}.` : ''}</div>}
    </>
  )
}

function Controls({ state }: { state: State }): React.JSX.Element {
  const busy = useStore((s) => s.busy)
  const panel = useStore((s) => s.panel)
  const idle = state.phase === 'squad' && !state.units.some((u) => u.side === 'squad' && u.status === 'active' && u.actions > 0)
  return (
    <div className="ctrls pa">
      <button className="sq" onClick={() => boardApi.rotate(-1)} data-testid="rot-left">&#8630;</button>
      <button className="sq" onClick={() => boardApi.rotate(1)} data-testid="rot-right">&#8631;</button>
      <button className="sq" onClick={() => boardApi.home()} data-testid="cam-home">&#8962;</button>
      <button className="sq phone-only-log" onClick={() => useStore.setState({ panel: panel === 'log' ? 'none' : 'log' })}>LOG</button>
      <button className={`primary endturn${idle ? ' ready' : ''}`} onClick={() => void endTurn()} disabled={busy || state.phase !== 'squad' || !!state.outcome} data-testid="end-turn">{busy ? 'FEED BUSY...' : 'END TURN'}</button>
    </div>
  )
}

function SettingsPanel(): React.JSX.Element {
  const s = useStore((x) => x.settings)
  const audio = useStore((x) => x.audioFound)
  return (
    <div className="settings panel pa" data-testid="settings">
      <h4>SETTINGS</h4>
      <div className="body">
        <div>Animation speed</div>
        <div className="seg">{(['normal', 'fast', 'instant'] as const).map((k) => <button key={k} className={s.speed === k ? 'on' : ''} onClick={() => updateSettings({ speed: k })} data-speed={k}>{k.toUpperCase()}</button>)}</div>
        <label>Lite (no scanlines or glitch)<input type="checkbox" checked={s.lite} onChange={(e) => updateSettings({ lite: e.target.checked })} /></label>
        <label>Mute<input type="checkbox" checked={s.mute} onChange={(e) => updateSettings({ mute: e.target.checked })} /></label>
        <label>Volume<input type="range" min={0} max={1} step={0.05} value={s.volume} onChange={(e) => updateSettings({ volume: Number(e.target.value) })} /></label>
        {audio === 'no' && <div className="warn" data-testid="audio-missing">audio not found</div>}
        {audio === 'yes' && <div className="dim" style={{ color: 'var(--green)' }}>audio ready</div>}
      </div>
    </div>
  )
}

export function SettingsButton({ shifted }: { shifted?: boolean }): React.JSX.Element {
  const panel = useStore((s) => s.panel)
  return (
    <>
      <button className={`gear pa${shifted ? ' shifted' : ''}`} onClick={() => useStore.setState({ panel: panel === 'settings' ? 'none' : 'settings' })} data-testid="gear">SETTINGS</button>
      {panel === 'settings' && <SettingsPanel />}
    </>
  )
}

export function Hud(): React.JSX.Element | null {
  const state = useStore((s) => s.state)
  const fog = useStore((s) => s.fog)
  const sel = useStore((s) => s.selected)
  const hover = useStore((s) => s.hover)
  const hint = useStore((s) => s.hint)
  const saveError = useStore((s) => s.saveError)
  const panel = useStore((s) => s.panel)
  const lite = useStore((s) => s.settings.lite)
  const phaseTick = useStore((s) => s.phaseTick)
  const busy = useStore((s) => s.busy)
  const wide = useWide()
  useEffect(() => { document.body.classList.toggle('lite', lite) }, [lite])
  if (!state || !fog) return null
  const selU = sel ? state.units.find((u) => u.id === sel) ?? null : null
  const hoverU = hover ? fog.units.find((u) => u.x === hover.x && u.y === hover.y && u.status !== 'dead' && u.status !== 'escaped' && u.status !== 'safe') ?? null : null
  const canTarget = !!selU && selU.side === 'squad' && selU.status === 'active' && state.phase === 'squad' && !busy
  const phoneLog = panel === 'log'
  const hintText = saveError ? `Autosave unavailable: ${saveError}` : hint
  const glitchText = state.phase === 'squad' ? 'SQUAD PHASE' : state.phase === 'syndicate' ? 'SYNDICATE PHASE' : 'CIVILIAN PHASE'
  return (
    <div className="hud" data-testid="hud">
      <TopLeft state={state} />
      <div className="topright">
        <AlarmPanel state={state} />
        {(phoneLog || wide) && <Ticker />}
        {hoverU && <UnitCard state={state} unit={hoverU} />}
        {canTarget && hoverU && hoverU.side === 'syndicate' && selU && <TargetPanel state={state} sel={selU} enemy={hoverU} />}
      </div>
      <SettingsButton shifted />
      <div className="bottom">
        <div className={`hint panel${hintText ? '' : ' empty'}`} data-testid="hint">{hintText ?? '.'}</div>
        <Channels state={state} />
        <div className="row2">
          {selU ? <AbilityBar state={state} unit={selU} /> : <div className="abilities"><span className="passive">Select a trooper (tap a channel or a figure)</span></div>}
          <Controls state={state} />
        </div>
      </div>
      {phaseTick > 0 && !lite && <div className="glitch" key={phaseTick}><span>{glitchText}</span></div>}
      {state.outcome && <div className="glitch" key="end"><span>FEED ENDS</span></div>}
    </div>
  )
}
