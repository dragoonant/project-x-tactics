// Which tiles the squad can see right now (for the fog shading). It asks the engine's own sight rule (FOG-1) about a stand-in
// unit on each tile, so the UI never reimplements line of sight.
import type { State, Unit } from '../../engine'
import { scanned, sees } from '../../engine/fog'
import { isActive } from '../../engine/util'

const cache = new WeakMap<State, Uint8Array>()

export function visibleMask(s: State): Uint8Array {
  const hit = cache.get(s)
  if (hit) return hit
  const w = s.map.w, h = s.map.h
  const mask = new Uint8Array(w * h)
  const observers = s.units.filter((u) => u.side === 'squad' && isActive(u))
  const proto = observers[0] ?? s.units[0]
  if (proto) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const t = s.map.tiles[y * w + x]!
      if (t.k === 'wall') continue
      const ghost: Unit = { ...proto, id: '__tile', side: 'syndicate', x, y }
      let vis = scanned(s, ghost)
      if (!vis) for (const o of observers) if (sees(s, o, ghost)) { vis = true; break }
      if (vis) mask[y * w + x] = 1
    }
    for (const o of observers) mask[o.y * w + o.x] = 1
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (s.map.tiles[y * w + x]!.k !== 'wall') continue
      let near = false
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && mask[ny * w + nx] === 1 && s.map.tiles[ny * w + nx]!.k !== 'wall') { near = true; break }
      }
      if (near) mask[y * w + x] = 2
    }
  } else mask.fill(1)
  cache.set(s, mask)
  return mask
}

/** Ids of units that were in the squad's view before a step and are dead after it (their bodies stay on the board). */
export function newBodies(seenBefore: Iterable<string>, after: State, known: string[]): string[] {
  const out = new Set(known)
  for (const id of seenBefore) {
    const u = after.units.find((x) => x.id === id)
    if (u && u.side !== 'squad' && u.status === 'dead') out.add(id)
  }
  return out.size === known.length ? known : [...out]
}

/** The units the board draws: the squad's view plus the bodies it saw fall (own troopers are always in the view). */
export function boardUnits(state: State, fog: State, bodies: string[]): Unit[] {
  if (bodies.length === 0) return fog.units
  const extra = state.units.filter((u) => bodies.includes(u.id) && u.status === 'dead' && !fog.units.some((f) => f.id === u.id))
  return extra.length ? [...fog.units, ...extra] : fog.units
}
