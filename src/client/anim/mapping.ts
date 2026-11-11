// Engine event / unit state -> clip, exactly as the table in docs/spec/30-figures-anim.md section 2. Pure functions, no three.js.
// `baseClip` is the standing clip a unit shows when nothing is happening to it; the `*Clip` helpers pick the transient clip for an event.
import type { ClipName } from './contract'

export interface StateLike {
  side: string
  status: string
  hunkered?: boolean
  panicked?: boolean
  fleeing?: boolean
  armed?: boolean
  actions?: number
}
export type MoveMode = 'walk' | 'run' | 'panic' | null

type TileAt = (x: number, y: number) => { k: string; o?: string; open?: boolean } | undefined
export type CoverLevel = 'high' | 'low'
interface Pt { x: number; y: number }

/** True when any of the four sides of a tile has cover (wall, closed door, cover object, rubble): the same sources the engine's COV rules use. */
export function hasCoverNear(tileAt: TileAt, x: number, y: number): boolean {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const t = tileAt(x + dx, y + dy)
    if (!t) continue
    if (t.k === 'wall' || (t.k === 'door' && !t.open)) return true
    if (t.o === 'halfCover' || t.o === 'fullCover' || t.o === 'rubble') return true
  }
  return false
}

export interface AimUnit { id: string; side: string; status: string; x: number; y: number; armed?: boolean; group?: string | null }
/**
 * Who a figure in cover aims at: the closest active hostile it can see (squad against syndicate). A syndicate figure whose group is
 * still unaware aims at nobody, so it keeps facing its sight cone (STL-1). Ties go to the lower id, so the pick is stable.
 */
export function aimTarget(u: AimUnit, units: readonly AimUnit[], awareGroups: ReadonlySet<string>): Pt | null {
  if (u.status !== 'active' || u.armed === false) return null
  const foe = u.side === 'squad' ? 'syndicate' : u.side === 'syndicate' ? 'squad' : null
  if (!foe) return null
  if (u.side === 'syndicate' && u.group && !awareGroups.has(u.group)) return null
  let best: AimUnit | null = null, bd = Infinity
  for (const o of units) {
    if (o.side !== foe || o.status !== 'active') continue
    const d = (o.x - u.x) ** 2 + (o.y - u.y) ** 2
    if (d < bd || (d === bd && best && o.id < best.id)) { best = o; bd = d }
  }
  return best ? { x: best.x, y: best.y } : null
}

/**
 * The state-driven clip: death / downed / surrender / cuffed by status, panic and cower for civilians; behind low cover (or hunkered)
 * the kneel (`cover`), next to high cover the standing aim (`coverHigh`). `cover: true` means low.
 */
export function baseClip(u: StateLike, o: { cover: boolean | CoverLevel | null; moving: MoveMode }): ClipName {
  switch (u.status) {
    case 'dead': return 'death'
    case 'downed': case 'stabilized': return 'downed'
    case 'surrendered': return 'surrender'
    case 'cuffed': return 'cuffed'
    default: break
  }
  if (o.moving) return o.moving
  if (u.side === 'civilians') return u.panicked || u.fleeing ? 'cower' : 'idle'
  if (u.armed === false) return 'idle'
  if (u.hunkered) return 'cover'
  if (o.cover === 'high') return 'coverHigh'
  if (o.cover) return 'cover'
  return 'idle'
}

/** How a unit travels along a `move` / `flee` / `civilianFlee` / `civilianMove` event. A move that uses the unit's second action is a run (dash). */
export function moveMode(eventKind: string, u: StateLike, actionsBefore: number): 'walk' | 'run' | 'panic' {
  if (u.side === 'civilians') return eventKind === 'civilianFlee' || u.panicked ? 'panic' : 'walk'
  if (eventKind === 'flee') return 'run'
  return actionsBefore < 2 ? 'run' : 'walk'
}

export type AttackEvent = Record<string, any>
/** shieldBash -> bash; any other melee weapon attack -> melee; everything ranged (attack, overwatch, suppression, breach, pinning shot) -> fire. */
export function attackClip(e: AttackEvent): 'fire' | 'melee' | 'bash' {
  if (e.via === 'shieldBash') return 'bash'
  if (e.via === 'maul' || e.via === 'baton' || e.breakdown?.melee) return 'melee'
  return 'fire'
}
/** Ranged attacks aim before they fire; melee does not. */
export const aimsFirst = (c: 'fire' | 'melee' | 'bash'): boolean => c === 'fire'

/** Abilities that have a clip of their own. Attack-like abilities (bash, maul, baton, pinning shot, breach) arrive as `attack` events instead. */
export function abilityClip(ability: string): 'point' | 'throw' | 'fire' | 'melee' | null {
  switch (ability) {
    case 'takedown': return 'melee'
    case 'relay': case 'mark': case 'callSupport': case 'rally': return 'point'
    case 'frag': case 'gas': return 'throw'
    case 'suppress': return 'fire'
    default: return null
  }
}

/** Health damage plays `hit` (graze too); a damage event that only cost Resolve does not. */
export function damageClip(e: Record<string, any>): 'hit' | null {
  return typeof e.hp === 'number' && e.hp > 0 ? 'hit' : null
}

/** Events that end the pre-event pose hold of a unit whose status changed (the new status clip may now play). */
export const STATUS_EVENTS: ReadonlySet<string> = new Set(['surrender', 'cuffed', 'downed', 'death', 'stabilized'])

/** Every clip of the contract with the situation that plays it, for the docs and the exhaustive test. */
export const CLIP_SOURCES: Record<ClipName, string> = {
  idle: 'state: standing',
  cover: 'state: kneeling behind low cover (or hunkered)',
  coverHigh: 'state: standing aim beside high cover',
  walk: 'event: move (first action), civilianMove',
  run: 'event: move using the second action, flee',
  aim: 'event: attack (ranged), before fire',
  fire: 'event: attack (ranged, overwatch, reaction, suppression), ability suppress',
  melee: 'event: attack with a melee weapon',
  bash: 'event: attack via shieldBash',
  throw: 'event: ability frag / gas',
  point: 'event: ability relay / mark / callSupport / rally',
  hit: 'event: damage with Health loss',
  downed: 'state: downed or stabilized',
  surrender: 'state: surrendered',
  cuffed: 'state: cuffed',
  death: 'state: dead (holds last frame)',
  panic: 'event: civilianFlee, civilian moving while panicked',
  cower: 'state: civilian panicked / fleeing and standing',
}

/** How a figure stands when nothing else is happening: the cover it poses against and the point it aims at. */
export interface Stance { cover: CoverLevel | null; aim: Pt | null }
export const NO_STANCE: Stance = { cover: null, aim: null }

/**
 * Owner: aim around high cover at the closest enemy, take a knee behind low cover. The cover is the engine's cover against the aim
 * target (query.coverFrom: COV rules, Riot Shield included), or, with no target, against an attacker straight ahead. Full cover
 * stands (coverHigh), half cover kneels (cover). A figure with no cover that way (open ground, or cover only behind it) keeps its
 * normal stance and facing.
 */
export function stanceFor(u: AimUnit & { facing: Pt }, units: readonly AimUnit[], awareGroups: ReadonlySet<string>, coverFrom: (from: Pt) => 'none' | 'half' | 'full' | null): Stance {
  if (u.status !== 'active' || u.side === 'civilians') return NO_STANCE
  const target = aimTarget(u, units, awareGroups)
  const level = coverFrom(target ?? { x: u.x + u.facing.x * 5, y: u.y + u.facing.y * 5 })
  const cover: CoverLevel | null = level === 'full' ? 'high' : level === 'half' ? 'low' : null
  return { cover, aim: cover ? target : null }
}
