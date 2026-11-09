// CIV: panic and the civilian phase.
import type { Ctx, Unit } from './types'
import { DIRS8, bfs, cornerOk, distField, enterable, inBounds, occupantAt, pathFrom, tileAt, tilesOfKind } from './grid'
import { dist, emit, isActive, tn } from './util'
import { rollInt } from './rng'

/** CIV-2: civilians within `radius` of the origin panic and stay panicked. */
export function panicAround(c: Ctx, x: number, y: number, radius: number, why: string): void {
  for (const u of c.s.units) {
    if (u.side !== 'civilians' || !isActive(u) || u.panicked) continue
    if (dist(u.x, u.y, x, y) <= radius) { u.panicked = true; emit(c, 'panic', { unit: u.id, why }) }
  }
}

function wanderStep(c: Ctx, u: Unit): boolean {
  const s = c.s
  const opts = DIRS8.filter((d) => {
    const nx = u.x + d.x, ny = u.y + d.y
    if (!inBounds(s, nx, ny) || !enterable(s, nx, ny) || occupantAt(s, nx, ny)) return false
    if (tileAt(s, nx, ny)!.k === 'door') return false
    if (d.x !== 0 && d.y !== 0 && (!cornerOk(s, u.x + d.x, u.y) || !cornerOk(s, u.x, u.y + d.y))) return false
    return true
  })
  if (opts.length === 0) return false
  const d = opts[rollInt(s, 0, opts.length - 1)]!
  u.x += d.x; u.y += d.y
  return true
}

/** CIV-3: engine-driven civilian phase. */
export function civilianPhase(c: Ctx): void {
  const s = c.s
  const exits = tilesOfKind(s, 'exit')
  const field = exits.length ? distField(s, exits) : null
  for (const u of s.units) {
    if (u.side !== 'civilians' || !isActive(u)) continue
    if (!u.panicked) {
      const n = rollInt(s, 0, tn(s, 'civilian.wander'))
      const from = { x: u.x, y: u.y }
      for (let i = 0; i < n; i++) if (!wanderStep(c, u)) break
      if (u.x !== from.x || u.y !== from.y) emit(c, 'civilianMove', { unit: u.id, from, to: { x: u.x, y: u.y } })
      continue
    }
    if (!field) continue
    const b = bfs(s, u.x, u.y, tn(s, 'civilian.mobility'))
    const w = s.map.w
    let best = -1
    let bestD = field[u.y * w + u.x] as number
    for (let i = 0; i < b.cost.length; i++) {
      if ((b.cost[i] as number) < 1) continue
      const d = field[i] as number
      if (d === -1) continue
      if (d < bestD || (d === bestD && best !== -1 && (b.cost[i] as number) < (b.cost[best] as number))) { best = i; bestD = d }
    }
    if (best === -1) continue
    const tx = best % w, ty = (best - tx) / w
    const path = pathFrom(s, b, tx, ty)
    u.x = tx; u.y = ty
    emit(c, 'civilianFlee', { unit: u.id, path })
    if (s.map.tiles[best]!.k === 'exit') { u.status = 'safe'; emit(c, 'civilianSafe', { unit: u.id }) }
  }
}
