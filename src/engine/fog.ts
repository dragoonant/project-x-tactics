// FOG: who sees whom (FOG-1..4), shared sight, knowledge (lastSeen) and view().
import type { Ctx, Side, State, Unit } from './types'
import { hasLOS, isLit } from './los'
import { dist, hasAb, isActive, onBoard, tn } from './util'

/** FOG-1: does observer O see unit U (no scan considered)? */
export function sees(s: State, o: Unit, u: Unit): boolean {
  const d = dist(o.x, o.y, u.x, u.y)
  if (d > tn(s, 'sight.radius')) return false
  if (!hasLOS(s, o, u)) return false
  return isLit(s, u.x, u.y) || d <= tn(s, 'light.darkSightRange') || hasAb(o, 'nightVision')
}
export function scanned(s: State, u: Unit): boolean {
  return s.scans.some((sc) => dist(sc.x, sc.y, u.x, u.y) <= sc.r)
}
/** FOG-2: a side sees what any of its able units sees; Drone Scan reveals to the squad. */
export function sideSees(s: State, side: Side, u: Unit): boolean {
  if (u.side === side) return true
  if (side === 'squad' && scanned(s, u)) return true
  for (const o of s.units) if (o.side === side && isActive(o) && sees(s, o, u)) return true
  return false
}
/** ABL-MRK-3 Squadsight: any teammate's sight plus the marksman's own LOS, ignoring radius and darkness. */
export function squadsightSees(s: State, o: Unit, u: Unit): boolean {
  return sideSees(s, o.side, u) && hasLOS(s, o, u)
}

export function updateKnowledge(c: Ctx): void {
  const s = c.s
  for (const side of ['squad', 'syndicate'] as const) {
    for (const u of s.units) {
      if (u.side === side || !onBoard(u)) continue
      if (sideSees(s, side, u)) s.lastSeen[side][u.id] = { x: u.x, y: u.y, round: s.round }
    }
  }
}

/** FOG-3 / ARCH-5: what `side` may know. Hidden units are removed; ghost records remain in lastSeen. */
export function view(state: State, side: Side): State {
  const s: State = JSON.parse(JSON.stringify(state))
  const visible = new Set<string>()
  s.units = s.units.filter((u) => {
    if (u.side === side) { visible.add(u.id); return true }
    if (!onBoard(u)) return false
    if (sideSees(state, side, state.units.find((x) => x.id === u.id)!)) { visible.add(u.id); return true }
    return false
  })
  s.groups = s.groups.map((g) => ({
    ...g,
    // Unaware groups never reveal their composition; aware groups show only members the side sees.
    members: g.members.filter((m) => visible.has(m) && (g.aware || s.units.find((u) => u.id === m)?.side === side)),
  }))
  const mine = side === 'civilians' ? {} : state.lastSeen[side]
  const ghosts: Record<string, { x: number; y: number; round: number }> = {}
  for (const id of Object.keys(mine)) {
    const u = state.units.find((x) => x.id === id)
    if (u && onBoard(u) && !visible.has(id)) ghosts[id] = { ...mine[id]! }
  }
  s.lastSeen = { squad: side === 'squad' ? ghosts : {}, syndicate: side === 'syndicate' ? ghosts : {} }
  s.rng = [0, 0, 0, 0]
  s.forcedRolls = []
  s.log = []
  return s
}
