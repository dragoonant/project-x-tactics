// Tile tap resolution (rule 25) and the ability bar model. Pure: no React, no three.js, no rules maths.
// Every legal move, attack and ability comes from `legalActions`; reasons for disabled abilities come from `actionProblem`.
import { actionProblem, legalActions, query } from '../../engine'
import type { Action, Pt, State, Unit } from '../../engine'
import { ABILITY_LABELS, ABILITY_TEXT, PASSIVE_ABILITIES, PASSIVE_TEXT, abilityLabel } from './names'

export interface Armed { ability: string; option?: string }

export type TapResult =
  | { kind: 'actions'; actions: Action[]; why: string }
  | { kind: 'select'; unit: string }
  | { kind: 'clear' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'none' }

// ---------------------------------------------------------------- memoised engine calls (per state object)
const legalCache = new WeakMap<State, Action[]>()
export function legalFor(s: State): Action[] {
  let l = legalCache.get(s)
  if (!l) { l = legalActions(s); legalCache.set(s, l) }
  return l
}

export interface DashTile { x: number; y: number; via: Pt }
const reachCache = new WeakMap<State, Map<string, { one: Map<string, Pt[]>; two: Map<string, DashTile> }>>()
const k = (x: number, y: number): string => `${x},${y}`

/** Shallow copy of the state with one unit standing somewhere else (for previews only; never stepped). */
export function withUnitAt(s: State, id: string, x: number, y: number): State {
  return { ...s, units: s.units.map((u) => (u.id === id ? { ...u, x, y } : u)) }
}

/** One-action reach (query.reachable) and, for units with two actions, the extra tiles a dash (two Move actions) reaches. */
export function reachFor(s: State, unitId: string): { one: Map<string, Pt[]>; two: Map<string, DashTile> } {
  let per = reachCache.get(s)
  if (!per) { per = new Map(); reachCache.set(s, per) }
  const hit = per.get(unitId)
  if (hit) return hit
  const one = new Map<string, Pt[]>()
  const two = new Map<string, DashTile>()
  const u = s.units.find((x) => x.id === unitId)
  if (u && u.side === s.phase && u.status === 'active' && u.actions >= 1 && !u.noMove) {
    for (const r of query.reachable(s, unitId)) one.set(k(r.x, r.y), r.path)
    if (u.actions >= 2) {
      for (const r of [...one.values()].map((p) => p[p.length - 1]!)) {
        const shadow = { ...withUnitAt(s, unitId, r.x, r.y) }
        for (const r2 of query.reachable(shadow, unitId)) {
          const key = k(r2.x, r2.y)
          if (!one.has(key) && !two.has(key) && !(r2.x === u.x && r2.y === u.y)) two.set(key, { x: r2.x, y: r2.y, via: { x: r.x, y: r.y } })
        }
      }
    }
  }
  const out = { one, two }
  per.set(unitId, out)
  return out
}

// ---------------------------------------------------------------- tap resolution
function unitAt(units: Unit[], p: Pt): Unit | undefined {
  return units.find((u) => u.x === p.x && u.y === p.y && u.status !== 'dead' && u.status !== 'escaped' && u.status !== 'safe')
}

function sameAbility(a: Action, armed: Armed): boolean {
  if (armed.ability === 'attack') return a.type === 'attack'
  return a.type === 'ability' && a.ability === armed.ability && (armed.option === undefined || a.option === armed.option)
}
function targetsTile(a: Action, tile: Pt, units: Unit[]): boolean {
  if (a.type === 'move' || a.type === 'endPhase') return false
  if (a.at) return a.at.x === tile.x && a.at.y === tile.y
  if (a.target) { const t = units.find((u) => u.id === a.target); return !!t && t.x === tile.x && t.y === tile.y }
  return false
}

/**
 * A tap on a tile resolves in exactly one place. `fogUnits` are the units the squad may see (view): hidden enemies are never
 * considered, so a tap cannot reveal them. `legal` is legalActions(state).
 */
export function resolveTap(s: State, fogUnits: Unit[], legal: Action[], selId: string | null, armed: Armed | null, tile: Pt): TapResult {
  const sel = selId ? s.units.find((u) => u.id === selId) : undefined
  const occ = unitAt(fogUnits, tile)
  if (s.outcome || s.phase !== 'squad') return { kind: 'none' }
  if (s.map.tiles[tile.y * s.map.w + tile.x]?.k === 'wall') return { kind: 'none' }
  if (sel && armed) {
    const hit = legal.filter((a) => (a.type === 'attack' || a.type === 'ability') && a.unit === sel.id && sameAbility(a, armed) && targetsTile(a, tile, s.units))
    if (hit.length) return { kind: 'actions', actions: [hit[0]!], why: armed.ability }
    return { kind: 'invalid', reason: `${abilityLabel(armed.ability, armed.option)}: not a valid target there` }
  }
  if (sel && sel.side === 'squad' && sel.status === 'active') {
    const mine = legal.filter((a) => a.type !== 'endPhase' && 'unit' in a && a.unit === sel.id)
    // lamp
    const lampT = s.map.tiles[tile.y * s.map.w + tile.x]
    if (lampT?.o === 'lamp') {
      const a = mine.find((m) => m.type === 'attack' && m.at && m.at.x === tile.x && m.at.y === tile.y)
      if (a) return { kind: 'actions', actions: [a], why: 'shoot lamp' }
    }
    if (occ && occ.id !== sel.id) {
      if (occ.side === 'syndicate') {
        // ABL-TKD-1: next to an unaware enemy, a tap takes it down quietly instead of an ambush attack that would wake its group
        const tk = mine.find((m) => m.type === 'ability' && m.ability === 'takedown' && m.target === occ.id)
        if (tk) return { kind: 'actions', actions: [tk], why: 'takedown' }
        const atk = mine.find((m) => m.type === 'attack' && m.target === occ.id)
        if (atk) return { kind: 'actions', actions: [atk], why: 'attack' }
        const cuff = mine.find((m) => m.type === 'ability' && m.ability === 'cuff' && m.target === occ.id)
        if (cuff) return { kind: 'actions', actions: [cuff], why: 'cuff' }
        return { kind: 'none' }
      }
      if (occ.side === 'squad') {
        if (occ.status === 'downed') {
          const st = mine.find((m) => m.type === 'ability' && m.ability === 'stabilize' && m.target === occ.id)
          if (st) return { kind: 'actions', actions: [st], why: 'stabilize' }
        }
        return { kind: 'select', unit: occ.id }
      }
      return { kind: 'none' }
    }
    if (occ && occ.id === sel.id) return { kind: 'none' }
    const reach = reachFor(s, sel.id)
    const key = k(tile.x, tile.y)
    if (reach.one.has(key)) return { kind: 'actions', actions: [{ type: 'move', unit: sel.id, to: { x: tile.x, y: tile.y } }], why: 'move' }
    const d = reach.two.get(key)
    if (d) return { kind: 'actions', actions: [{ type: 'move', unit: sel.id, to: { x: d.via.x, y: d.via.y } }, { type: 'move', unit: sel.id, to: { x: d.x, y: d.y } }], why: 'dash' }
    return { kind: 'clear' }
  }
  if (occ && occ.side === 'squad' && occ.id !== selId) return { kind: 'select', unit: occ.id }
  return { kind: 'clear' }
}

// ---------------------------------------------------------------- ability bar
export type NeedKind = 'none' | 'unit' | 'tile'
export interface AbilityEntry {
  key: string
  ability: string
  option?: string
  label: string
  text: string
  need: NeedKind
  enabled: boolean
  reason: string
  loud: boolean
}

const NEED: Record<string, NeedKind> = {
  attack: 'unit', takedown: 'unit', overwatch: 'none', longWatch: 'none', hunker: 'none', cuff: 'unit', stabilize: 'unit', suppress: 'unit',
  shieldBash: 'unit', maul: 'unit', baton: 'unit', pinningShot: 'unit', relay: 'unit', mark: 'unit', stim: 'unit',
  frag: 'tile', gas: 'tile', breach: 'tile', callSupport: 'tile',
}
const OPTIONS: Record<string, string[]> = { stim: ['heal', 'action'], callSupport: ['scan', 'smoke', 'spotlight'] }

function cap(t: string): string { return t.length ? t[0]!.toUpperCase() + t.slice(1) : t }

function probeReason(s: State, u: Unit, ability: string, option?: string): string {
  const base = { type: 'ability', unit: u.id, ability, option } as Action
  if (ability === 'attack') {
    const w = u.weapon
    if (!w || !u.armed) return 'No weapon'
  }
  const p0 = actionProblem(s, ability === 'attack' ? { type: 'attack', unit: u.id, target: '' } : base)
  if (p0 && /phase|actions left|is (downed|dead|stabilized|surrendered|cuffed|escaped|safe)|unaware/.test(p0)) return cap(p0)
  if (ability === 'takedown') return 'Needs an unaware enemy next to this trooper: reach it from behind, outside its red sight cone'
  const tileProbe = NEED[ability] === 'tile'
  const reasons: { d: number; r: string }[] = []
  if (tileProbe) {
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      if (dx === 0 && dy === 0) continue
      const at = { x: u.x + dx, y: u.y + dy }
      const r = actionProblem(s, { type: 'ability', unit: u.id, ability, at, option })
      if (r && !/invalid target tile|clear line/.test(r)) return cap(r)
    }
    return 'No valid tile in range'
  }
  const pool = s.units.filter((t) => t.id !== u.id)
  for (const t of pool) {
    const a: Action = ability === 'attack' ? { type: 'attack', unit: u.id, target: t.id } : { type: 'ability', unit: u.id, ability, target: t.id, option }
    const r = actionProblem(s, a)
    if (r) reasons.push({ d: Math.abs(t.x - u.x) + Math.abs(t.y - u.y), r })
  }
  const useful = reasons.filter((r) => !/not a valid target|not a surrendered|not a downed|not a visible|another active|must be an able/.test(r.r)).sort((a, b) => a.d - b.d)
  if (useful[0]) return cap(useful[0].r)
  return ability === 'attack' ? 'No enemy in sight' : 'No valid target'
}

export function abilityEntries(s: State, legal: Action[], u: Unit): AbilityEntry[] {
  const out: AbilityEntry[] = []
  const mine = legal.filter((a) => a.type !== 'endPhase' && 'unit' in a && a.unit === u.id)
  const mk = (ability: string, option?: string): AbilityEntry => {
    const key = option ? `${ability}:${option}` : ability
    const list = mine.filter((a) => (ability === 'attack' ? a.type === 'attack' : a.type === 'ability' && a.ability === ability && (option === undefined || a.option === option)))
    const enabled = list.length > 0
    const loud = enabled || NEED[ability] === 'none' ? safeLoud(s, u.id, ability) : false
    return {
      key, ability, option, label: abilityLabel(ability, option).replace(/^Stim: heal$/, 'Stim: heal').replace(/^Call support: /, 'Call: '),
      text: ABILITY_TEXT[ability] ?? ABILITY_LABELS[ability] ?? ability, need: NEED[ability] ?? 'unit', enabled,
      reason: enabled ? '' : probeReason(s, u, ability, option), loud,
    }
  }
  if (u.weapon && u.armed) out.push(mk('attack'))
  for (const ab of u.abilities) {
    if (PASSIVE_ABILITIES.has(ab) || NEED[ab] === undefined) continue
    const opts = OPTIONS[ab]
    if (opts) for (const o of opts) out.push(mk(ab, o))
    else out.push(mk(ab))
  }
  return out
}

function safeLoud(s: State, id: string, ability: string): boolean {
  try { return query.noiseInfo(s, id, ability === 'attack' ? undefined : ability).loud } catch { return false }
}

export function passiveList(u: Unit): { label: string; text: string }[] {
  return u.abilities.filter((a) => PASSIVE_ABILITIES.has(a)).map((a) => ({ label: ABILITY_LABELS[a] ?? a, text: PASSIVE_TEXT[a] ?? '' }))
}

/** Tiles to highlight while an ability is armed (from legalActions). */
export function armedTargets(s: State, legal: Action[], unitId: string, armed: Armed): Pt[] {
  const out: Pt[] = []
  for (const a of legal) {
    if (a.type === 'move' || a.type === 'endPhase' || a.unit !== unitId || !sameAbility(a, armed)) continue
    if (a.at) out.push({ x: a.at.x, y: a.at.y })
    else if (a.target) { const t = s.units.find((u) => u.id === a.target); if (t) out.push({ x: t.x, y: t.y }) }
  }
  return out
}

/** Does this ability need no further input (fires at once)? */
export function fireNow(s: State, legal: Action[], unitId: string, e: AbilityEntry): Action | null {
  if (e.need !== 'none') return null
  return legal.find((a) => a.type === 'ability' && a.unit === unitId && a.ability === e.ability) ?? null
}
