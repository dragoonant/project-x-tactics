// The game controller: every transition of the client (new game, continue, dispatch, End Turn, taps, settings).
// It calls the engine (`step`, `view`, `legalActions`) and the frozen AI seam (`syndicatePolicy`); it never does rules maths.
import { createGame, randomAction, step, summarize, view } from '../../engine'
import type { Action, GameEvent, Pt, Setup, State } from '../../engine'
import { syndicatePolicy } from '../../ai'
import { audio } from './audio'
import { describeEvent } from './describe'
import { present } from './director'
import { clearSave, loadSettings, readSave, storeSettings, writeSave, type Settings } from './persist'
import { clearPresentation } from './presentation'
import { get, set, useStore, type TickerLine } from './store'
import { fireNow, abilityEntries, legalFor, resolveTap, type AbilityEntry } from './tap'
import { preloadModels } from './models'

let gen = 0
let lineId = 1
const cap = (t: string): string => (t.length ? t[0]!.toUpperCase() + t.slice(1) : t)

export const MAP_ID = 'bust-01'

export function boot(): void {
  const settings = loadSettings()
  set({ settings, save: readSave() })
  audio.setSettings(settings.mute, settings.volume)
  audio.onFound = (f) => set({ audioFound: f })
  void audio.init()
  void preloadModels((p) => set({ models: { done: p.done, total: p.total, ready: p.done >= p.total } })).then((p) => set({ models: { done: p.done, total: p.total, ready: true } }))
}

export function updateSettings(p: Partial<Settings>): void {
  const settings = { ...get().settings, ...p }
  storeSettings(settings)
  audio.setSettings(settings.mute, settings.volume)
  set({ settings })
}

export function refreshSave(): void { set({ save: readSave() }) }
export function discardSave(): void { clearSave(); set({ save: { kind: 'none' }, confirmNew: false }) }

// ------------------------------------------------------------------------------------------------ new / continue
function pushLines(lines: TickerLine[]): TickerLine[] { return [...get().ticker, ...lines].slice(-300) }
function line(text: string, tone: TickerLine['tone'] = 'info', round = get().state?.round ?? 1): TickerLine { return { id: lineId++, round, text, tone } }

function enter(state: State, resumed: boolean): void {
  gen++
  clearPresentation()
  const firstActor = state.units.find((u) => u.side === 'squad' && u.status === 'active') ?? state.units.find((u) => u.side === 'squad')
  set({
    screen: 'play', state, fog: view(state, 'squad'), selected: firstActor?.id ?? null, armed: null, hover: null, busy: false, hint: null,
    ticker: [line(resumed ? 'Feed restored from the last save' : 'Feed live. Operation NIGHT MARKET begins', 'phase', state.round)],
    saveError: null, panel: 'none', confirmNew: false, phaseTick: 0,
  })
  audio.syncMusic(state)
}

export function startGame(setup: Setup): void {
  let s: State
  try { s = createGame(setup) } catch (e) { set({ hint: `Could not start: ${(e as Error).message}` }); return }
  enter(s, false)
  persist(s)
}

export function replaySameSeed(): void {
  const st = get().state
  if (st) startGame({ mapId: MAP_ID, squad: [...st.setup.squad], seed: st.setup.seed, tuning: st.setup.tuning })
}

export function continueGame(): void {
  const r = readSave()
  set({ save: r })
  if (r.kind !== 'ok') return
  enter(r.state, true)
  if (r.state.phase === 'syndicate') void runSyndicate(gen)
}

export function toStart(): void {
  gen++
  clearPresentation()
  audio.stopMusic()
  set({ screen: 'start', busy: false, armed: null, hover: null, panel: 'none', save: readSave(), confirmNew: false })
}

// ------------------------------------------------------------------------------------------------ persistence
function persist(s: State): void {
  if (s.outcome) { clearSave(); return }
  const r = writeSave(s)
  set({ saveError: r.ok ? null : r.reason })
}

// ------------------------------------------------------------------------------------------------ applying a step
async function commit(next: State, events: GameEvent[], before: State, follow: boolean): Promise<void> {
  const g = gen
  const fog = view(next, 'squad')
  const visible = new Set<string>([...view(before, 'squad').units.map((u) => u.id), ...fog.units.map((u) => u.id)])
  const lines: TickerLine[] = []
  for (const e of events) {
    const l = describeEvent(e, { state: next, visible })
    if (l) lines.push({ ...l, id: lineId++, round: e.round })
  }
  const prev = get()
  let selected = prev.selected
  const sel = selected ? next.units.find((u) => u.id === selected) : undefined
  if (next.phase === 'squad' && (!sel || (sel.actions < 1 && next.units.some((u) => u.side === 'squad' && u.status === 'active' && u.actions > 0 && u.id !== selected)))) {
    const nxt = next.units.find((u) => u.side === 'squad' && u.status === 'active' && u.actions > 0)
    if (nxt) selected = nxt.id
  }
  const phaseChanged = before.phase !== next.phase
  set({ state: next, fog, ticker: pushLines(lines), selected, armed: null, hint: null, phaseTick: phaseChanged && prev.settings.speed !== 'instant' ? prev.phaseTick + 1 : prev.phaseTick })
  persist(next)
  audio.onEvents(events)
  audio.syncMusic(next)
  await present(events, before, next, { speed: prev.settings.speed, follow, alive: () => g === gen })
}

export async function dispatch(a: Action): Promise<boolean> {
  const st = get()
  if (!st.state || st.busy || st.state.outcome || st.screen !== 'play') return false
  const r = step(st.state, a)
  if (!r.ok) { set({ hint: cap(r.reason) }); return false }
  const g = gen
  const instant = st.settings.speed === 'instant'
  if (!instant) set({ busy: true })
  try {
    await commit(r.state, r.events, st.state, false)
  } finally {
    if (g === gen && !instant) set({ busy: false })
  }
  if (g === gen && get().state?.outcome) await finishGame()
  return true
}

async function runSyndicate(g: number): Promise<void> {
  set({ busy: true })
  let guard = 0
  try {
    while (g === gen) {
      const s = get().state
      if (!s || s.outcome || s.phase !== 'syndicate' || guard++ > 600) break
      let r = step(s, syndicatePolicy(s))
      if (!r.ok) r = step(s, { type: 'endPhase' })
      if (!r.ok) break
      await commit(r.state, r.events, s, true)
    }
  } finally {
    if (g === gen) set({ busy: false })
  }
  if (g === gen && get().state?.outcome) await finishGame()
}

export async function endTurn(): Promise<void> {
  const st = get()
  if (!st.state || st.busy || st.state.outcome || st.state.phase !== 'squad' || st.screen !== 'play') return
  const g = gen
  set({ busy: true, armed: null })
  const r = step(st.state, { type: 'endPhase' })
  if (!r.ok) { set({ busy: false, hint: cap(r.reason) }); return }
  await commit(r.state, r.events, st.state, true)
  if (g !== gen) return
  await runSyndicate(g)
}

async function finishGame(): Promise<void> {
  const g = gen
  clearSave()
  const instant = get().settings.speed === 'instant'
  if (!instant) await new Promise((r) => setTimeout(r, 1400))
  if (g !== gen) return
  set({ screen: 'end', busy: false, endShownAt: Date.now(), save: { kind: 'none' } })
}

// ------------------------------------------------------------------------------------------------ taps and selection
export function setHover(p: Pt | null): void {
  const h = get().hover
  if ((h === null && p === null) || (h && p && h.x === p.x && h.y === p.y)) return
  set({ hover: p })
}

export function selectUnit(id: string | null): void {
  if (get().busy) return
  set({ selected: id, armed: null, hint: null })
  audio.ui('select')
}

export async function onTileTap(tile: Pt, pointerType: string): Promise<void> {
  const st = get()
  if (!st.state || !st.fog || st.busy || st.screen !== 'play' || st.state.outcome) return
  const legal = legalFor(st.state)
  const res = resolveTap(st.state, st.fog.units, legal, st.selected, st.armed, tile)
  const touch = pointerType === 'touch'
  const sameHover = !!st.hover && st.hover.x === tile.x && st.hover.y === tile.y
  if (res.kind === 'actions') {
    if (touch && !sameHover) { set({ hover: tile, hint: `Tap the tile again to confirm (${res.why})` }); return }
    audio.ui('confirm')
    for (const a of res.actions) { if (!(await dispatch(a))) break }
    return
  }
  if (touch) set({ hover: tile })
  if (res.kind === 'select') { selectUnit(res.unit); return }
  if (res.kind === 'invalid') { set({ hint: res.reason }); return }
  if (res.kind === 'clear') { set({ selected: null, armed: null, hint: null }); return }
}

export async function chooseAbility(e: AbilityEntry): Promise<void> {
  const st = get()
  if (!st.state || st.busy || !st.selected) return
  if (!e.enabled) { set({ hint: `${e.label}: ${e.reason}` }); return }
  if (st.armed && st.armed.ability === e.ability && st.armed.option === e.option) { set({ armed: null, hint: null }); return }
  const now = fireNow(st.state, legalFor(st.state), st.selected, e)
  if (now) { audio.ui('confirm'); await dispatch(now); return }
  audio.ui('select')
  set({ armed: { ability: e.ability, option: e.option }, hint: e.need === 'tile' ? `${e.label}: pick a tile` : `${e.label}: pick a target` })
}

export function cancelArm(): void { set({ armed: null, hint: null }) }

export function entriesFor(s: State, unitId: string): AbilityEntry[] {
  const u = s.units.find((x) => x.id === unitId)
  return u ? abilityEntries(s, legalFor(s), u) : []
}

// ------------------------------------------------------------------------------------------------ report
export function buildReport(s: State): string {
  const sum = summarize(s)
  const lines: string[] = []
  lines.push('PROJECT-X INCIDENT REPORT (unofficial prototype, credit: evilgouki)')
  lines.push(`Outcome: ${sum.outcome ?? 'in progress'}`)
  lines.push(`Squad: ${s.setup.squad.join(', ')}`)
  lines.push(`Seed: ${sum.seed}`)
  lines.push(`Rounds: ${sum.rounds}   Peak Alarm: ${sum.peakAlarm} of ${s.tuning.alarm.max}`)
  for (const [kind, t] of Object.entries(sum.enemies)) lines.push(`  ${kind}: arrested ${t.arrests}, killed ${t.kills}, escaped ${t.escapes}, surrendered ${t.lost}`)
  lines.push(`Intel: ${sum.intel}`)
  lines.push(`Civilian casualties: ${sum.civilianCasualties}   civilians safe: ${sum.civiliansSafe}`)
  lines.push(`Troopers downed: ${sum.troopersDowned}   dead: ${sum.troopersDead}`)
  lines.push(`Actions taken: ${s.log.length}`)
  lines.push(`Tuning: ${JSON.stringify(s.tuning)}`)
  lines.push(`Setup: ${JSON.stringify({ mapId: s.setup.mapId, squad: s.setup.squad, seed: s.setup.seed, tuning: s.setup.tuning ?? null })}`)
  return lines.join('\n')
}

// ------------------------------------------------------------------------------------------------ test hook helpers
export async function autoplayStep(salt = 0): Promise<boolean> {
  const st = get()
  if (!st.state || st.screen !== 'play' || st.busy) return false
  if (st.state.phase === 'squad') {
    const a = randomAction(st.state, salt, undefined, 0.35)
    if (a.type === 'endPhase') await endTurn()
    else await dispatch(a)
  }
  return true
}

export { useStore }
