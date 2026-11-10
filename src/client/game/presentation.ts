// Presentation state shared between the director (game logic side) and the board (three.js side).
// Mutable module state on purpose: it is read every frame and must not trigger React renders.
import type { Pt } from '../../engine'

import { clearCues } from '../anim/cues'

/** `mode` picks the travel clip of a rigged figure (walk by default; run for a dash or flight, panic for a fleeing civilian). */
export interface Motion { path: Pt[]; t0: number; dur: number; mode?: 'walk' | 'run' | 'panic' }
export const motion = new Map<string, Motion>()

export type FxKind = 'tracer' | 'ring' | 'text' | 'flash' | 'burst'
export interface Fx {
  id: number
  kind: FxKind
  from?: Pt
  to?: Pt
  at?: Pt
  text?: string
  tone?: string
  r?: number
  t0: number
  dur: number
}
let nextFx = 1
export const fxList: Fx[] = []
const subs = new Set<() => void>()
export function onFxChange(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn) } }
export function addFx(f: Omit<Fx, 'id' | 't0'> & { t0?: number }): void {
  fxList.push({ ...f, id: nextFx++, t0: f.t0 ?? performance.now() })
  if (fxList.length > 40) fxList.splice(0, fxList.length - 40)
  wake(f.dur + 100)
  subs.forEach((fn) => fn())
}
export function pruneFx(now: number): boolean {
  const n = fxList.length
  for (let i = fxList.length - 1; i >= 0; i--) if (now - fxList[i]!.t0 > fxList[i]!.dur) fxList.splice(i, 1)
  return fxList.length !== n
}
export function clearPresentation(): void { motion.clear(); clearCues(); fxList.length = 0; focus.cine = null; camApi.release(); subs.forEach((fn) => fn()) }

// ---- render-loop wake-up (the canvas runs in demand mode)
export const loop = { until: 0, invalidate: null as null | (() => void) }
export function wake(ms = 500): void {
  loop.until = Math.max(loop.until, performance.now() + ms)
  loop.invalidate?.()
}

// ---- camera hooks the director uses (set by the CameraRig)
export const camApi = {
  flyTo: (_x: number, _z: number): void => { /* set by CameraRig */ },
  focusTile: (_p: Pt): void => { /* set by CameraRig */ },
  /** Action camera: glide to a world pose (src/client/game/cinematic.ts) in `ms`. */
  shot: (_pos: [number, number, number], _look: [number, number, number], _ms?: number): void => { /* set by CameraRig */ },
  /** Action camera: glide back to the orbit view in `ms`. */
  release: (_ms?: number): void => { /* set by CameraRig */ },
  /** World <-> tile mapping of the board (set by the CameraRig). */
  world: (p: { x: number; y: number }): { x: number; z: number } => ({ x: p.x, z: p.y }),
  tile: (x: number, z: number): Pt => ({ x: Math.floor(x), y: Math.floor(z) }),
}

/** Position along a path for progress t in 0..1 (tile coordinates, fractional). */
export function along(path: Pt[], t: number): { x: number; y: number; dx: number; dy: number } {
  if (path.length === 0) return { x: 0, y: 0, dx: 0, dy: 1 }
  if (path.length === 1) return { x: path[0]!.x, y: path[0]!.y, dx: 0, dy: 1 }
  const segs = path.length - 1
  const f = Math.min(0.9999, Math.max(0, t)) * segs
  const i = Math.floor(f), r = f - i
  const a = path[i]!, b = path[i + 1]!
  return { x: a.x + (b.x - a.x) * r, y: a.y + (b.y - a.y) * r, dx: b.x - a.x, dy: b.y - a.y }
}

/** Tiles the wall cutaway keeps clear: the selected trooper and the hovered tile. */
/** What the action camera played, newest last (`shot:<shooter>:<target>`, `kill:<victim>`): the test hook reads it. */
export const cineLog: string[] = []
export function logCine(entry: string): void { cineLog.push(entry); if (cineLog.length > 40) cineLog.splice(0, cineLog.length - 40) }

/** `cine`: while the action camera runs, the only tiles the cutaway keeps clear (the shooter and its target, or the victim). */
export const focus = { sel: null as Pt | null, hover: null as Pt | null, units: [] as Pt[], cine: null as Pt[] | null }
