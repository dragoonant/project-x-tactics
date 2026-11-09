// MOVE: grid, tiles, passability, 8-direction pathing.
import type { Cloud, Pt, State, Tile, Unit } from './types'
import { onBoard } from './util'

interface TerrainCache { blocks: Uint8Array | null; lit: Uint8Array | null }
const caches = new WeakMap<State, TerrainCache>()
export function cacheOf(s: State): TerrainCache {
  let c = caches.get(s)
  if (!c) { c = { blocks: null, lit: null }; caches.set(s, c) }
  return c
}
/** Call after any change to doors, cover, lamps, smoke or spotlights. */
export function dirty(s: State): void { caches.delete(s) }

export function idx(s: State, x: number, y: number): number { return y * s.map.w + x }
export function inBounds(s: State, x: number, y: number): boolean { return x >= 0 && y >= 0 && x < s.map.w && y < s.map.h }
export function tileAt(s: State, x: number, y: number): Tile | undefined {
  return inBounds(s, x, y) ? s.map.tiles[y * s.map.w + x] : undefined
}

export const DIRS4: Pt[] = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }]
export const DIRS8: Pt[] = [...DIRS4, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: -1, y: -1 }]

/** MOVE-3: terrain a unit may stand on (doors count: they open when stepped into). */
export function enterable(s: State, x: number, y: number): boolean {
  const t = tileAt(s, x, y)
  return !!t && t.k !== 'wall' && t.o === undefined
}
/** Used for the no-corner-cutting rule (MOVE-2): a closed door is not a free corner. */
export function cornerOk(s: State, x: number, y: number): boolean {
  const t = tileAt(s, x, y)
  return !!t && t.k !== 'wall' && t.o === undefined && !(t.k === 'door' && !t.open)
}
export function isFloorLike(s: State, x: number, y: number): boolean {
  const t = tileAt(s, x, y)
  return !!t && (t.k === 'floor' || t.k === 'exit' || t.k === 'escape') && t.o === undefined
}

export function occupantAt(s: State, x: number, y: number): Unit | undefined {
  for (const u of s.units) if (u.x === x && u.y === y && onBoard(u)) return u
  return undefined
}
function occupancy(s: State): Uint8Array {
  const occ = new Uint8Array(s.map.w * s.map.h)
  for (const u of s.units) if (onBoard(u)) occ[u.y * s.map.w + u.x] = 1
  return occ
}

export function cloudTiles(s: State, cl: Cloud): Pt[] {
  const out: Pt[] = []
  for (let y = cl.y - cl.r; y <= cl.y + cl.r; y++)
    for (let x = cl.x - cl.r; x <= cl.x + cl.r; x++) {
      const t = tileAt(s, x, y)
      if (t && t.k !== 'wall') out.push({ x, y })
    }
  return out
}
export function inCloud(s: State, clouds: Cloud[], x: number, y: number): boolean {
  return clouds.some((cl) => Math.max(Math.abs(cl.x - x), Math.abs(cl.y - y)) <= cl.r && tileAt(s, x, y)?.k !== 'wall')
}

export interface Bfs { cost: Int16Array; parent: Int32Array }

/** Breadth-first search with uniform step cost and MOVE-2 diagonals. Deterministic neighbour order. */
export function bfs(s: State, sx: number, sy: number, maxCost: number, ignoreUnits = false): Bfs {
  const w = s.map.w
  const n = w * s.map.h
  const cost = new Int16Array(n).fill(-1)
  const parent = new Int32Array(n).fill(-1)
  const occ = ignoreUnits ? null : occupancy(s)
  const queue: number[] = [sy * w + sx]
  cost[sy * w + sx] = 0
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi] as number
    const cx = cur % w, cy = (cur - cx) / w
    const cc = cost[cur] as number
    if (cc >= maxCost) continue
    for (const d of DIRS8) {
      const nx = cx + d.x, ny = cy + d.y
      if (!inBounds(s, nx, ny)) continue
      const ni = ny * w + nx
      if (cost[ni] !== -1) continue
      if (!enterable(s, nx, ny)) continue
      if (occ && occ[ni]) continue
      if (d.x !== 0 && d.y !== 0) {
        if (!cornerOk(s, cx + d.x, cy) || !cornerOk(s, cx, cy + d.y)) continue
        if (tileAt(s, nx, ny)?.k === 'door') continue
      }
      cost[ni] = cc + 1
      parent[ni] = cur
      queue.push(ni)
    }
  }
  return { cost, parent }
}

export function pathFrom(s: State, b: Bfs, tx: number, ty: number): Pt[] {
  const w = s.map.w
  const out: Pt[] = []
  let cur = ty * w + tx
  while (cur !== -1 && b.parent[cur] !== -1) {
    out.push({ x: cur % w, y: (cur - (cur % w)) / w })
    cur = b.parent[cur] as number
  }
  return out.reverse()
}

/** Static distance (ignoring units) from every tile to the nearest of `targets`. -1 = unreachable. */
export function distField(s: State, targets: Pt[]): Int16Array {
  const w = s.map.w
  const dist = new Int16Array(w * s.map.h).fill(-1)
  const queue: number[] = []
  for (const t of targets) { const i = t.y * w + t.x; if (dist[i] === -1) { dist[i] = 0; queue.push(i) } }
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi] as number
    const cx = cur % w, cy = (cur - cx) / w
    for (const d of DIRS8) {
      const nx = cx + d.x, ny = cy + d.y
      if (!inBounds(s, nx, ny)) continue
      const ni = ny * w + nx
      if (dist[ni] !== -1) continue
      if (!enterable(s, nx, ny)) continue
      if (d.x !== 0 && d.y !== 0) {
        if (!cornerOk(s, cx + d.x, cy) || !cornerOk(s, cx, cy + d.y)) continue
        if (tileAt(s, nx, ny)?.k === 'door') continue
      }
      dist[ni] = (dist[cur] as number) + 1
      queue.push(ni)
    }
  }
  return dist
}

export function tilesOfKind(s: State, kind: Tile['k']): Pt[] {
  const out: Pt[] = []
  for (let y = 0; y < s.map.h; y++) for (let x = 0; x < s.map.w; x++) if (s.map.tiles[y * s.map.w + x]!.k === kind) out.push({ x, y })
  return out
}
