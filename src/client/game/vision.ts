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
