// Wall dressing for terrain v2 (T1): roof-edge trim, window frames, storefront neon tubes and awnings, drain pipes, cables, wall-mounted
// power boxes. Everything is attached to a wall tile of the rules grid (never added to the footprint beyond a few centimetres), and
// everything follows the wall's cutaway height so the camera-side walls still drop and fade (Three Kingdoms Tactics lesson).
// One InstancedMesh per kind; no pointer handlers anywhere (rule 25). Neon is unlit colour only: light pools stay the engine's lamps.
import { useLayoutEffect, useMemo, useRef } from 'react'
import { BoxGeometry, Color, CylinderGeometry, DoubleSide, Euler, InstancedMesh, Matrix4, MeshBasicMaterial, MeshStandardMaterial, Quaternion, Vector3 } from 'three'
import type { State } from '../../../engine'
import { wake } from '../../game/presentation'
import { hash2, tx, tz } from '../layout'
import type { PropDef, PropPart } from './assets'
import { exitNear, ventSpots } from './mood'

export type DressKey = 'trim' | 'frame' | 'glass' | 'neon' | 'pipe' | 'cable' | 'awning' | 'hazard' | 'part'
export interface DressItem {
  k: DressKey
  wall: number
  p: [number, number, number]
  s: [number, number, number]
  r?: [number, number, number]
  c: string
  /** index of a wall-box prop part (k === 'part') */
  part?: PropPart
  partKey?: string
}
export interface WallRef { x: number; y: number; wx: number; wz: number; boundary: boolean }

/** Bodycam palette for neon and strips: hazard amber, sodium orange, monitor green. */
export const NEON = ['#ffb000', '#ff8a2a', '#43e08a'] as const
const AWN = ['#5d6f6a', '#7d4a40', '#6e5d3c'] as const
export const WALL_H = 1.5

const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]] as const

/** Pure builder, so the layout is the same on every run and can be unit-tested. `box` is the wall-mounted power-box prop, if any. */
export function buildDressing(state: State, indoor: Uint8Array, walls: WallRef[], box: PropDef | null, low = false): { items: DressItem[]; byWall: number[][] } {
  const { w, h } = state.map
  const tiles = state.map.tiles
  const idx = new Int32Array(w * h).fill(-1)
  walls.forEach((wl, i) => { idx[wl.y * w + wl.x] = i })
  const items: DressItem[] = []
  const add = (it: DressItem): void => { items.push(it) }
  const kindAt = (x: number, y: number): string => (x < 0 || y < 0 || x >= w || y >= h ? 'wall' : tiles[y * w + x]!.k)
  const outdoorAt = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && tiles[y * w + x]!.k !== 'wall' && tiles[y * w + x]!.k !== 'door' && !indoor[y * w + x]
  // storefronts: a door with a street on exactly one side; the wall runs two tiles either way get a neon tube along the roof edge
  const front = new Map<number, number>() // wall tile index in grid -> neon colour index
  const doors: { x: number; y: number; nx: number; nz: number; col: number }[] = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (tiles[y * w + x]!.k !== 'door') continue
    const ew = kindAt(x - 1, y) === 'wall' && kindAt(x + 1, y) === 'wall'
    const outs = DIRS.filter(([dx, dz]) => (ew ? dz !== 0 : dx !== 0) && outdoorAt(x + dx, y + dz))
    if (outs.length !== 1) continue
    const [nx, nz] = outs[0]!
    const col = Math.floor(hash2(x, y, 90) * 3)
    doors.push({ x, y, nx, nz, col })
    const tx_ = nz !== 0 ? 1 : 0, tz_ = nx !== 0 ? 1 : 0
    for (let k = -2; k <= 2; k++) if (k !== 0) front.set((y + k * tz_) * w + (x + k * tx_), col)
  }
  const faceOf = (x: number, y: number, dx: number, dz: number): { X: number; Z: number; ry: number } => ({ X: tx(x, w) + dx * 0.5, Z: tz(y, h) + dz * 0.5, ry: Math.atan2(dx, dz) })
  const at = (f: { X: number; Z: number }, lx: number, ly: number, off: number, dx: number, dz: number): [number, number, number] => {
    // local x runs along the face (tangent), off pushes out along the normal
    const tx_ = dz, tz_ = -dx
    return [f.X + tx_ * lx + dx * off, ly, f.Z + tz_ * lx + dz * off]
  }
  walls.forEach((wl, i) => {
    if (wl.boundary) return
    // roof-edge trim: a slightly wider dark cap on the top of every building wall
    add({ k: 'trim', wall: i, p: [wl.wx, WALL_H + 0.035, wl.wz], s: [1.05, 0.07, 1.05], c: hash2(wl.x, wl.y, 4) > 0.5 ? '#3b3f48' : '#454a54' })
    for (const [dx, dz] of DIRS) {
      const nxx = wl.x + dx, nyy = wl.y + dz
      if (!outdoorAt(nxx, nyy)) continue
      const f = faceOf(wl.x, wl.y, dx, dz)
      const ry = f.ry
      const r1 = hash2(wl.x * 4 + dx, wl.y * 4 + dz, 11)
      const neon = front.get(wl.y * w + wl.x)
      if (neon !== undefined) {
        add({ k: 'neon', wall: i, p: at(f, 0, WALL_H - 0.12, 0.03, dx, dz), s: [1.0, 0.045, 0.045], r: [0, ry, 0], c: NEON[neon]! })
      }
      // window: a dark steel frame with a dark glass pane; every other facade face has one
      if (r1 < 0.55 && neon === undefined) {
        add({ k: 'frame', wall: i, p: at(f, 0, 0.92, 0.025, dx, dz), s: [0.5, 0.52, 0.06], r: [0, ry, 0], c: '#2a2e36' })
        add({ k: 'glass', wall: i, p: at(f, 0, 0.92, 0.045, dx, dz), s: [0.38, 0.4, 0.04], r: [0, ry, 0], c: '#14202e' })
        add({ k: 'frame', wall: i, p: at(f, 0, 0.64, 0.06, dx, dz), s: [0.58, 0.05, 0.12], r: [0, ry, 0], c: '#33373f' }) // sill
      } else if (r1 < 0.7) {
        // drain pipe down the wall
        const side = hash2(wl.x, wl.y, 12) > 0.5 ? 0.36 : -0.36
        add({ k: 'pipe', wall: i, p: at(f, side, WALL_H / 2, 0.05, dx, dz), s: [0.07, WALL_H, 0.07], c: '#4a5059' })
        add({ k: 'pipe', wall: i, p: at(f, side, 1.1, 0.05, dx, dz), s: [0.11, 0.05, 0.11], c: '#5a616b' }) // clamp
      } else if (r1 < 0.8) {
        // cables: three straight segments sagging between two points on the face
        const y0 = WALL_H - 0.2, sag = 0.14
        const pts: [number, number][] = [[-0.5, y0], [-0.17, y0 - sag * 0.8], [0.17, y0 - sag * 0.8], [0.5, y0]]
        for (let k = 0; k < 3; k++) {
          const a = pts[k]!, b = pts[k + 1]!
          const len = Math.hypot(b[0] - a[0], b[1] - a[1])
          add({ k: 'cable', wall: i, p: at(f, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.03, dx, dz), s: [len, 0.025, 0.025], r: [0, ry, Math.atan2(b[1] - a[1], b[0] - a[0])], c: '#16181c' })
        }
      } else if (r1 < 0.86 && box) {
        add({ k: 'part', wall: i, p: [f.X + dx * 0.19, 0, f.Z + dz * 0.19], s: [1, 1, 1], r: [0, ry, 0], c: '#ffffff', part: box.parts[0], partKey: box.slug })
      }
    }
  })
  // storefront doors: awning, neon outline (the door's own frame and strip are drawn with the door in Terrain)
  for (const d of doors) {
    const f = faceOf(d.x, d.y, d.nx, d.nz)
    const nb = idx[(d.y + (d.nx !== 0 ? 1 : 0)) * w + (d.x + (d.nz !== 0 ? 1 : 0))] ?? -1
    const wi = nb >= 0 ? nb : (idx[(d.y - (d.nx !== 0 ? 1 : 0)) * w + (d.x - (d.nz !== 0 ? 1 : 0))] ?? -1)
    if (wi < 0) continue
    const ry = f.ry
    const aw = AWN[Math.floor(hash2(d.x, d.y, 91) * AWN.length)]!
    add({ k: 'awning', wall: wi, p: at(f, 0, 1.12, 0.16, d.nx, d.nz), s: [1.12, 0.045, 0.36], r: [0.42, ry, 0], c: aw })
    add({ k: 'neon', wall: wi, p: at(f, 0, WALL_H - 0.12, 0.03, d.nx, d.nz), s: [1.0, 0.045, 0.045], r: [0, ry, 0], c: NEON[d.col]! })
    for (const side of [-0.47, 0.47]) add({ k: 'neon', wall: wi, p: at(f, side, 0.75, 0.03, d.nx, d.nz), s: [0.04, 1.3, 0.045], r: [0, ry, 0], c: NEON[d.col]! })
  }
  // steam vents: short pipe stacks on the boundary hoarding (the steam itself is drawn by mood.tsx at the same spots)
  for (const v of ventSpots(w, h, (x, y) => exitNear(state, x, y))) {
    const wi = idx[v.y * w + v.x] ?? -1
    if (wi < 0) continue
    add({ k: 'pipe', wall: wi, p: [tx(v.x, w), 0.65, tz(v.y, h)], s: [0.16, 0.3, 0.16], c: '#59606b' })
    add({ k: 'pipe', wall: wi, p: [tx(v.x, w), 0.82, tz(v.y, h)], s: [0.24, 0.05, 0.24], c: '#3a3f47' })
  }
  // Low tier: set dressing (pipes, cables, wall boxes) is dropped first; windows, trim, neon and awnings stay
  const kept = low ? items.filter((it) => it.k !== 'pipe' && it.k !== 'cable' && it.k !== 'part') : items
  const byWall: number[][] = walls.map(() => [])
  kept.forEach((it, n) => byWall[it.wall]!.push(n))
  return { items: kept, byWall }
}

const eul = new Euler(0, 0, 0, 'YXZ')
const qq = new Quaternion(), vv = new Vector3(), ss = new Vector3(), mm = new Matrix4(), pm = new Matrix4()
function compose(it: DressItem, f: number, out: Matrix4): Matrix4 {
  eul.set(it.r?.[0] ?? 0, it.r?.[1] ?? 0, it.r?.[2] ?? 0)
  qq.setFromEuler(eul)
  vv.set(it.p[0], it.p[1] * f, it.p[2])
  ss.set(it.s[0], it.s[1] * f, it.s[2])
  out.compose(vv, qq, ss)
  if (it.part) out.multiply(pm.copy(it.part.matrix))
  return out
}

export interface DressApi { apply: (wall: number, factor: number) => void }

/** Dressing meshes. `api.current.apply(wallIndex, factor)` squashes a wall's dressing with the wall's cutaway factor. */
export function Dressing({ state, indoor, walls, box, seen, api, factors, low }: {
  state: State; indoor: Uint8Array | null; walls: WallRef[]; box: PropDef | null; seen: Uint8Array; low: boolean
  api: React.MutableRefObject<DressApi | null>; factors: React.MutableRefObject<Float32Array>
}): React.JSX.Element | null {
  const { w } = state.map
  const built = useMemo(() => (indoor ? buildDressing(state, indoor, walls, box, low) : null),
    // walls and doors never move during a game
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [indoor, walls, box, low, state.map.id])
  const geo = useMemo(() => ({ box: new BoxGeometry(1, 1, 1), cyl: new CylinderGeometry(0.5, 0.5, 1, 8) }), [])
  const mats = useMemo(() => ({
    trim: new MeshStandardMaterial({ roughness: 0.85, metalness: 0.05 }),
    frame: new MeshStandardMaterial({ roughness: 0.6, metalness: 0.4 }),
    glass: new MeshStandardMaterial({ roughness: 0.12, metalness: 0.5 }),
    neon: new MeshBasicMaterial({ toneMapped: false }),
    pipe: new MeshStandardMaterial({ roughness: 0.5, metalness: 0.55 }),
    cable: new MeshStandardMaterial({ roughness: 0.9, metalness: 0 }),
    awning: new MeshStandardMaterial({ roughness: 0.9, metalness: 0, side: DoubleSide }),
  }), [])
  const refs = useRef<Record<string, InstancedMesh | null>>({})
  const cnt = useMemo(() => {
    const c: Record<string, number> = { trim: 0, frame: 0, glass: 0, neon: 0, pipe: 0, cable: 0, awning: 0 }
    const parts = new Set<string>()
    for (const it of built?.items ?? []) { if (it.k === 'part') parts.add(it.partKey!); else c[it.k] = (c[it.k] ?? 0) + 1 }
    return { c, parts: [...parts] }
  }, [built])
  const slot = useRef<Map<number, number>>(new Map()) // item -> instance index within its mesh

  const col = useRef(new Color())
  useLayoutEffect(() => {
    if (!built) return
    const used: Record<string, number> = {}
    slot.current.clear()
    built.items.forEach((it, n) => {
      const key = it.k === 'part' ? `part-${it.partKey}` : it.k
      const m = refs.current[key]
      if (!m) return
      const j = used[key] = (used[key] ?? -1) + 1
      slot.current.set(n, j)
      const wl = walls[it.wall]!
      const f = factors.current[it.wall] ?? 1
      m.setMatrixAt(j, compose(it, f, mm))
      const shade = seen[wl.y * w + wl.x] ? 1 : 0.55
      m.setColorAt(j, col.current.set(it.c).multiplyScalar(shade))
    })
    for (const [key, m] of Object.entries(refs.current)) {
      if (!m) continue
      m.count = (used[key] ?? -1) + 1
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
    api.current = {
      apply: (wall, f) => {
        for (const n of built.byWall[wall] ?? []) {
          const it = built.items[n]!
          const key = it.k === 'part' ? `part-${it.partKey}` : it.k
          const m = refs.current[key]
          const j = slot.current.get(n)
          if (!m || j === undefined) continue
          m.setMatrixAt(j, compose(it, f, mm))
          m.instanceMatrix.needsUpdate = true
        }
      },
    }
    wake(120)
    return () => { api.current = null }
  }, [built, seen, walls, w, api, factors])

  if (!built) return null
  const cap = (k: string): number => Math.max(1, cnt.c[k] ?? 0)
  const kinds: [string, keyof typeof mats, 'box' | 'cyl'][] = [['trim', 'trim', 'box'], ['frame', 'frame', 'box'], ['glass', 'glass', 'box'], ['neon', 'neon', 'box'], ['pipe', 'pipe', 'cyl'], ['cable', 'cable', 'box'], ['awning', 'awning', 'box']]
  return (
    <group>
      {kinds.map(([k, mk, g]) => (
        <instancedMesh key={k} ref={(el) => { refs.current[k] = el }} args={[geo[g], mats[mk], cap(k)]} frustumCulled={false} raycast={() => null} />
      ))}
      {box && cnt.parts.includes(box.slug) && box.parts.map((p, i) => (
        <instancedMesh key={`part-${box.slug}-${i}`} ref={(el) => { refs.current[`part-${box.slug}`] = el }} args={[p.geometry, p.material, Math.max(1, built.items.filter((it) => it.k === 'part').length)]} frustumCulled={false} raycast={() => null} />
      ))}
    </group>
  )
}
