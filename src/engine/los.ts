// LOS: supercover lines and peeking (LOS-1..4). Light (LGT) lives here too because lamp light uses LOS-1.
import type { Pt, State } from './types'
import { DIRS4, cacheOf, cloudTiles, idx, inBounds, isFloorLike, tileAt } from './grid'
import { dist, tn } from './util'

function computeBlocks(s: State): Uint8Array {
  const b = new Uint8Array(s.map.w * s.map.h)
  for (let y = 0; y < s.map.h; y++)
    for (let x = 0; x < s.map.w; x++) {
      const t = s.map.tiles[y * s.map.w + x]!
      if (t.k === 'wall' || (t.k === 'door' && !t.open) || t.o === 'fullCover') b[y * s.map.w + x] = 1
    }
  for (const cl of s.smoke) for (const p of cloudTiles(s, cl)) b[idx(s, p.x, p.y)] = 1
  return b
}
/** LOS-2: walls, closed doors, full cover, smoke. */
export function blocksSight(s: State, x: number, y: number): boolean {
  if (!inBounds(s, x, y)) return true
  const c = cacheOf(s)
  if (!c.blocks) c.blocks = computeBlocks(s)
  return c.blocks[y * s.map.w + x] === 1
}

/** LOS-1: is the supercover line between two tile centres clear (endpoints excluded)? */
export function lineClear(s: State, ax: number, ay: number, bx: number, by: number): boolean {
  const dx = Math.abs(bx - ax), dy = Math.abs(by - ay)
  const sx = bx > ax ? 1 : -1, sy = by > ay ? 1 : -1
  let x = ax, y = ay, ix = 0, iy = 0
  while (ix < dx || iy < dy) {
    const decision = (1 + 2 * ix) * dy - (1 + 2 * iy) * dx
    if (decision === 0) {
      if (blocksSight(s, x + sx, y) && blocksSight(s, x, y + sy)) return false
      x += sx; y += sy; ix++; iy++
    } else if (decision < 0) { x += sx; ix++ } else { y += sy; iy++ }
    if (!(x === bx && y === by) && blocksSight(s, x, y)) return false
  }
  return true
}

/** LOS-3: the tile itself plus step-out tiles beside any adjacent sight blocker. */
export function sightOrigins(s: State, p: Pt): Pt[] {
  const out: Pt[] = [{ x: p.x, y: p.y }]
  for (const d of DIRS4) {
    if (!blocksSight(s, p.x + d.x, p.y + d.y)) continue
    const perp = { x: d.y, y: d.x }
    for (const sg of [1, -1]) {
      const ox = p.x + perp.x * sg, oy = p.y + perp.y * sg
      if (isFloorLike(s, ox, oy) && !out.some((q) => q.x === ox && q.y === oy)) out.push({ x: ox, y: oy })
    }
  }
  return out
}

/** LOS-4. */
export function hasLOS(s: State, a: Pt, b: Pt): boolean {
  if (lineClear(s, a.x, a.y, b.x, b.y)) return true
  const oa = sightOrigins(s, a), ob = sightOrigins(s, b)
  if (oa.length === 1 && ob.length === 1) return false
  for (const pa of oa) for (const pb of ob) if (lineClear(s, pa.x, pa.y, pb.x, pb.y)) return true
  return false
}

// ---- Light (LGT) ----
function computeLit(s: State): Uint8Array {
  const lit = new Uint8Array(s.map.w * s.map.h)
  const r = tn(s, 'light.lampRadius')
  for (let y = 0; y < s.map.h; y++)
    for (let x = 0; x < s.map.w; x++) {
      if (s.map.tiles[y * s.map.w + x]!.o !== 'lamp') continue
      for (let ty = y - r; ty <= y + r; ty++)
        for (let tx = x - r; tx <= x + r; tx++) {
          if (!inBounds(s, tx, ty) || dist(x, y, tx, ty) > r) continue
          if (lineClear(s, x, y, tx, ty)) lit[ty * s.map.w + tx] = 1
        }
    }
  for (const sp of s.spotlights)
    for (let ty = sp.y - sp.r; ty <= sp.y + sp.r; ty++)
      for (let tx = sp.x - sp.r; tx <= sp.x + sp.r; tx++)
        if (inBounds(s, tx, ty) && dist(sp.x, sp.y, tx, ty) <= sp.r && tileAt(s, tx, ty)!.k !== 'wall') lit[ty * s.map.w + tx] = 1
  return lit
}
/** LGT-1. */
export function isLit(s: State, x: number, y: number): boolean {
  if (!inBounds(s, x, y)) return false
  const c = cacheOf(s)
  if (!c.lit) c.lit = computeLit(s)
  return c.lit[y * s.map.w + x] === 1
}
