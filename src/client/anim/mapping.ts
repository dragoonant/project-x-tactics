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

/** True when any of the four sides of a tile has cover (wall, closed door, cover object, rubble): the same sources the engine's COV rules use. */
export function hasCoverNear(tileAt: (x: number, y: number) => { k: string; o?: string; open?: boolean } | undefined, x: number, y: number): boolean {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const t = tileAt(x + dx, y + dy)
    if (!t) continue
    if (t.k === 'wall' || (t.k === 'door' && !t.open)) return true
    if (t.o === 'halfCover' || t.o === 'fullCover' || t.o === 'rubble') return true
  }
  return false
}

/** The state-driven clip: death / downed / surrender / cuffed by status, panic and cower for civilians, cover when the tile (or Hunker) gives cover. */
export function baseClip(u: StateLike, o: { cover: boolean; moving: MoveMode }): ClipName {
  switch (u.status) {
    case 'dead': return 'death'
    case 'downed': case 'stabilized': return 'downed'
    case 'surrendered': return 'surrender'
    case 'cuffed': return 'cuffed'
    default: break
  }
  if (o.moving) return o.moving
  if (u.side === 'civilians') return u.panicked || u.fleeing ? 'cower' : 'idle'
  if ((o.cover || u.hunkered) && u.armed !== false) return 'cover'
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
  cover: 'state: standing on a tile with cover (or hunkered)',
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
