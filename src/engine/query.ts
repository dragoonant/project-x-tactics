// ARCH-4 query.*: every number the UI shows. The UI never does rules maths.
import type { HitBreakdown, Pt, State } from './types'
import { bfs, pathFrom } from './grid'
import { coverAgainst, type CoverInfo } from './cover'
import { AttackSpec, hitBreakdown, weaponDef } from './combat'
import { isLit } from './los'
import { sees, sideSees } from './fog'
import { summarize, type Summary } from './mission'
import { moveTargets } from './legal'
import { dist, tn, unitById } from './util'

/** The attack spec the UI should preview for an attack or ability (matches abilities.ts). */
export function previewSpec(s: State, attackerId: string, ability?: string): AttackSpec | null {
  const u = unitById(s, attackerId)
  if (!u) return null
  switch (ability) {
    case undefined: case 'attack': case 'suppress':
      return u.weapon ? { weapon: u.weapon, kind: 'attack' } : null
    case 'shieldBash': return u.melee ? { weapon: u.melee, kind: 'shieldBash', melee: true, fixedDamage: tn(s, 'bash.damage'), resolve: tn(s, 'bash.resolve'), onHit: 'stun' } : null
    case 'maul': case 'baton': return u.melee ? { weapon: u.melee, kind: ability, melee: true } : null
    case 'pinningShot': return u.weapon ? { weapon: u.weapon, kind: 'pinningShot', fixedDamage: tn(s, 'pin.damage'), resolve: tn(s, 'pin.resolve'), onHit: 'pin' } : null
    case 'breach': return u.weapon ? { weapon: u.weapon, kind: 'breach', extraAim: { name: 'breach', value: tn(s, 'breach.aim') } } : null
    case 'overwatch': return u.weapon ? { weapon: u.weapon, kind: 'overwatch', overwatch: true } : null
    default: return null
  }
}

/** HIT-1..5 with the full breakdown. */
export function hitChance(s: State, attackerId: string, targetId: string, ability?: string): HitBreakdown | null {
  const a = unitById(s, attackerId), t = unitById(s, targetId)
  const spec = previewSpec(s, attackerId, ability)
  if (!a || !t || !spec) return null
  return hitBreakdown(s, a, t, spec)
}

export interface Preview {
  breakdown: HitBreakdown
  damage: { hit: [number, number]; graze: [number, number] }
  resolve: { hit: [number, number]; graze: [number, number]; miss: number }
  flanked: boolean
  kills: boolean
  surrenders: boolean
}

/** DMG-1..5: damage and Resolve damage ranges for a prospective attack (the Resolve preview). */
export function preview(s: State, attackerId: string, targetId: string, ability?: string): Preview | null {
  const a = unitById(s, attackerId), t = unitById(s, targetId)
  const spec = previewSpec(s, attackerId, ability)
  if (!a || !t || !spec) return null
  const w = weaponDef(spec.weapon)!
  const bd = hitBreakdown(s, a, t, spec)
  const flank = bd.cover.flanked
  const lo = spec.fixedDamage ?? w.damage[0], hi = spec.fixedDamage ?? w.damage[1]
  const fd = flank ? tn(s, 'flank.damage') : 0
  const hit: [number, number] = [lo + fd, hi + fd]
  const graze: [number, number] = [Math.ceil(lo / 2) + fd, Math.ceil(hi / 2) + fd]
  const baseRes = (spec.resolve ?? w.resolve) + (flank ? tn(s, 'flank.resolve') : 0)
  const resFor = (dmg: number): number => {
    if (t.maxResolve <= 0) return 0
    let r = baseRes
    if (t.marked > 0) r = Math.ceil(r * tn(s, 'mark.resolveMult'))
    const left = t.hp - dmg
    if (left > 0 && left * 2 < t.maxHp) r *= tn(s, 'resolve.woundedMult')
    return r
  }
  return {
    breakdown: bd,
    damage: { hit, graze },
    resolve: { hit: [resFor(hit[0]), resFor(hit[1])], graze: [resFor(graze[0]), resFor(graze[1])], miss: t.maxResolve > 0 ? tn(s, 'resolve.shotAt') : 0 },
    flanked: flank,
    kills: t.hp - hit[1] <= 0,
    surrenders: t.maxResolve > 0 && t.hp - hit[1] > 0 && t.resolve - resFor(hit[1]) <= 0,
  }
}

export interface ReachTile { x: number; y: number; cost: number; path: Pt[] }
/** MOVE-4: tiles the unit can move to with one Move action, with step cost and path. */
export function reachable(s: State, unitId: string): ReachTile[] {
  const u = unitById(s, unitId)
  if (!u) return []
  const b = bfs(s, u.x, u.y, u.mobility)
  return moveTargets(s, u).map((p) => ({ x: p.x, y: p.y, cost: b.cost[p.y * s.map.w + p.x] as number, path: pathFrom(s, b, p.x, p.y) }))
}

export type Compass = 'N' | 'E' | 'S' | 'W'
/** COV: cover a unit would get against an attacker standing at a tile. */
export function coverFrom(s: State, unitId: string, from: Pt): CoverInfo | null {
  const u = unitById(s, unitId)
  return u ? coverAgainst(s, u, from.x, from.y) : null
}
/** COV: cover value and level against an attacker straight north / east / south / west. */
export function coverPerSide(s: State, unitId: string): Record<Compass, { level: 'none' | 'half' | 'full'; value: number }> | null {
  const u = unitById(s, unitId)
  if (!u) return null
  const dirs: Record<Compass, Pt> = { N: { x: 0, y: -1 }, E: { x: 1, y: 0 }, S: { x: 0, y: 1 }, W: { x: -1, y: 0 } }
  const out = {} as Record<Compass, { level: 'none' | 'half' | 'full'; value: number }>
  for (const k of Object.keys(dirs) as Compass[]) {
    const c = coverAgainst(s, u, u.x + dirs[k].x * 5, u.y + dirs[k].y * 5)
    out[k] = { level: c.level, value: c.value }
  }
  return out
}

const LOUD_ABILITIES = new Set(['suppress', 'frag', 'breach'])
/** NOI-3/4: would this action be loud, how far does it carry, and which unaware groups would it wake? */
export function noiseInfo(s: State, unitId: string, ability?: string): { loud: boolean; radius: number; groups: string[] } {
  const u = unitById(s, unitId)
  if (!u) return { loud: false, radius: 0, groups: [] }
  let loud: boolean
  if (ability === undefined || ability === 'attack') loud = weaponDef(u.weapon)?.noise === 'loud'
  else if (['shieldBash', 'maul', 'baton'].includes(ability)) loud = false
  else if (ability === 'pinningShot') loud = weaponDef(u.weapon)?.noise === 'loud'
  else loud = LOUD_ABILITIES.has(ability)
  const radius = loud ? tn(s, 'noise.hearingRadius') : 0
  const groups = loud
    ? s.groups.filter((g) => !g.aware && g.members.some((id) => { const m = unitById(s, id); return !!m && m.status === 'active' && dist(m.x, m.y, u.x, u.y) <= radius })).map((g) => g.id)
    : []
  return { loud, radius, groups }
}

export function summary(s: State): Summary { return summarize(s) }

export const query = {
  hitChance, preview, previewSpec, reachable, coverFrom, coverPerSide, noiseInfo, summary,
  isLit: (s: State, x: number, y: number): boolean => isLit(s, x, y),
  /** FOG-1 for one observer/target pair. */
  canSee: (s: State, observerId: string, targetId: string): boolean => {
    const o = unitById(s, observerId), t = unitById(s, targetId)
    return !!o && !!t && sees(s, o, t)
  },
  /** FOG-2: does the unit's side see the target? */
  sideSees: (s: State, observerId: string, targetId: string): boolean => {
    const o = unitById(s, observerId), t = unitById(s, targetId)
    return !!o && !!t && sideSees(s, o.side, t)
  },
}
