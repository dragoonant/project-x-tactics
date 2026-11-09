// Camera controller (rule 27). Pointer events only, so one code path serves touch, pen and mouse.
//   mouse: wheel zooms toward the cursor; right drag rotates and tilts; middle drag pans; left picks;
//          left drag pans until the first middle press is seen (remembered in localStorage `px-mouse-3btn`).
//   touch: one finger pans, two fingers twist and pinch.
// A press that moves less than 8 px is a tap; a drag, a second finger or a camera gesture is never a tap.
import { PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three'
import { MOUSE3_KEY } from '../game/persist'
import { wake } from '../game/presentation'

export const TAP_SLOP = 8
export const POL_MIN = 0.25
export const POL_MAX = 1.38
export const POL_DEFAULT = 0.82
export const DIST_MIN = 4.5

export const gesture = { dragged: false }
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

export interface View { x: number; z: number; az: number; pol: number; dist: number }
export interface Insets { left: number; right: number; top: number; bottom: number }

/** Pixels of the window the HUD leaves for the board. */
export function insetsFor(w: number, h: number): Insets {
  if (w >= 900) return { left: 24, right: 300, top: 70, bottom: 150 }
  if (w > h) return { left: 8, right: 8, top: 46, bottom: 128 } // phone landscape
  return { left: 4, right: 4, top: 96, bottom: 200 } // phone portrait
}

/** Distance and pixel shift that place the whole board inside the inset rectangle at the given azimuth and polar angle. */
export function fitBoard(fov: number, w: number, h: number, ins: Insets, az: number, pol: number, bw: number, bh: number): { dist: number; shiftX: number; shiftY: number } {
  const cam = new PerspectiveCamera(fov, w / h, 0.5, 400)
  const corners: [number, number, number][] = []
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0, 1.4]) corners.push([(sx * bw) / 2, y, (sz * bh) / 2])
  const freeW = Math.max(120, w - ins.left - ins.right)
  const freeH = Math.max(120, h - ins.top - ins.bottom)
  const bounds = (dist: number): { minx: number; maxx: number; miny: number; maxy: number } => {
    cam.position.set(Math.sin(az) * Math.sin(pol) * dist, Math.cos(pol) * dist, Math.cos(az) * Math.sin(pol) * dist)
    cam.lookAt(0, 0, 0)
    cam.updateMatrixWorld(true)
    cam.updateProjectionMatrix()
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity
    const v = new Vector3()
    for (const c of corners) { v.set(c[0], c[1], c[2]).project(cam); minx = Math.min(minx, v.x); maxx = Math.max(maxx, v.x); miny = Math.min(miny, v.y); maxy = Math.max(maxy, v.y) }
    return { minx, maxx, miny, maxy }
  }
  let lo = 8, hi = 160
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2
    const b = bounds(mid)
    if (((b.maxx - b.minx) / 2) * w <= freeW && ((b.maxy - b.miny) / 2) * h <= freeH) hi = mid
    else lo = mid
  }
  const b = bounds(hi)
  const cx = w / 2 + ((b.minx + b.maxx) / 2) * (w / 2)
  const cy = h / 2 - ((b.miny + b.maxy) / 2) * (h / 2)
  return { dist: hi, shiftX: ins.left + freeW / 2 - cx, shiftY: ins.top + freeH / 2 - cy }
}

interface Tracked { x: number; y: number; type: string; button: number }

export class CameraController {
  view: View = { x: 0, z: 0, az: 0, pol: POL_DEFAULT, dist: 30 }
  overview = 30
  shiftX = 0
  shiftY = 0
  lim = { x: 11, z: 11 }
  interactive = true
  mouse3 = false
  /** Set when a left button drag panned the map (test and debug aid). */
  private goal: { x: number; z: number; az: number; dist: number } | null = null
  private pointers = new Map<number, Tracked>()
  private down: { x: number; y: number } | null = null
  private panGround: { x: number; z: number } | null = null
  private pinchPrev: [{ x: number; y: number }, { x: number; y: number }] | null = null
  private ray = new Raycaster()
  private ndc = new Vector2()
  private cleanup: (() => void) | null = null

  constructor(readonly camera: PerspectiveCamera, readonly dom: HTMLElement) {
    try { this.mouse3 = localStorage.getItem(MOUSE3_KEY) === '1' } catch { this.mouse3 = false }
  }

  private size(): { w: number; h: number; left: number; top: number } {
    const r = this.dom.getBoundingClientRect()
    return { w: Math.max(1, r.width), h: Math.max(1, r.height), left: r.left, top: r.top }
  }

  apply(): void {
    const v = this.view
    const sp = Math.sin(v.pol)
    this.camera.position.set(v.x + Math.sin(v.az) * sp * v.dist, Math.cos(v.pol) * v.dist, v.z + Math.cos(v.az) * sp * v.dist)
    this.camera.lookAt(v.x, 0, v.z)
    const { w, h } = this.size()
    this.camera.setViewOffset(w, h, -this.shiftX, -this.shiftY, w, h)
    this.camera.updateProjectionMatrix()
    this.camera.updateMatrixWorld(true)
    wake(120)
  }

  setFit(overview: number, shiftX: number, shiftY: number, lim: { x: number; z: number }): void {
    const atOverview = Math.abs(this.view.dist - this.overview) < 0.5
    this.overview = overview
    this.shiftX = shiftX
    this.shiftY = shiftY
    this.lim = lim
    if (atOverview) this.view.dist = overview
    this.view.dist = clamp(this.view.dist, DIST_MIN, overview * 1.15)
    this.apply()
  }

  reset(): void {
    this.view = { x: 0, z: 0, az: this.view.az, pol: POL_DEFAULT, dist: this.overview }
    this.goal = null
    this.apply()
  }
  flyHome(): void { this.goal = { x: 0, z: 0, az: this.view.az, dist: this.overview }; this.view.pol = POL_DEFAULT; wake(900) }
  flyTo(x: number, z: number, dist?: number): void {
    this.goal = { x: clamp(x, -this.lim.x, this.lim.x), z: clamp(z, -this.lim.z, this.lim.z), az: this.view.az, dist: dist ?? this.view.dist }
    wake(900)
  }
  rotateBy(dir: number): void {
    const az = (this.goal?.az ?? this.view.az) + (dir * Math.PI) / 8
    this.goal = { x: this.goal?.x ?? this.view.x, z: this.goal?.z ?? this.view.z, az, dist: this.goal?.dist ?? this.view.dist }
    wake(900)
  }
  setView(p: Partial<View>): void { this.view = this.clampView({ ...this.view, ...p }); this.goal = null; this.apply() }

  private clampView(v: View): View {
    return { x: clamp(v.x, -this.lim.x, this.lim.x), z: clamp(v.z, -this.lim.z, this.lim.z), az: v.az, pol: clamp(v.pol, POL_MIN, POL_MAX), dist: clamp(v.dist, DIST_MIN, this.overview * 1.15) }
  }

  /** The table point (y = 0) under a client pixel, or null. */
  groundAt(pt: { x: number; y: number }): { x: number; z: number } | null {
    const { w, h, left, top } = this.size()
    this.ndc.set(((pt.x - left) / w) * 2 - 1, -((pt.y - top) / h) * 2 + 1)
    this.ray.setFromCamera(this.ndc, this.camera)
    const o = this.ray.ray.origin, d = this.ray.ray.direction
    if (d.y > -0.02) return null
    const t = -o.y / d.y
    if (t < 0 || t > 400) return null
    return { x: o.x + d.x * t, z: o.z + d.z * t }
  }

  /** Client pixel of a world point (for the test hook and for HUD anchors). */
  project(x: number, y: number, z: number): { x: number; y: number } {
    this.camera.updateMatrixWorld(true)
    const v = new Vector3(x, y, z).project(this.camera)
    const r = this.dom.getBoundingClientRect()
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }
  }

  private zoomAt(dist: number, at: { x: number; y: number } | null): void {
    const before = at ? this.groundAt(at) : null
    this.view.dist = clamp(dist, DIST_MIN, this.overview * 1.15)
    this.apply()
    if (before && at) {
      for (let i = 0; i < 2; i++) {
        const after = this.groundAt(at)
        if (!after) break
        this.view.x += before.x - after.x
        this.view.z += before.z - after.z
        this.view = this.clampView(this.view)
        this.apply()
      }
    }
  }

  /** Per frame; returns true while still moving (the render loop stays awake). */
  update(dt: number): boolean {
    const g = this.goal
    if (!g) return false
    const v = this.view
    const k = 1 - Math.exp(-dt * 7)
    v.x += (g.x - v.x) * k
    v.z += (g.z - v.z) * k
    v.az += (g.az - v.az) * k
    v.dist += (g.dist - v.dist) * k
    if (Math.hypot(g.x - v.x, g.z - v.z) < 0.02 && Math.abs(g.az - v.az) < 0.002 && Math.abs(g.dist - v.dist) < 0.02) {
      v.x = g.x; v.z = g.z; v.az = g.az; v.dist = g.dist
      this.goal = null
    }
    this.view = this.clampView(v)
    this.apply()
    return this.goal !== null
  }

  // ---------------------------------------------------------------- input
  private startPan(at: { x: number; y: number }): void { this.panGround = this.groundAt(at); this.goal = null }

  private dragTo(to: { x: number; y: number }): void {
    if (!this.panGround) return
    const g = this.groundAt(to)
    if (!g) return
    this.view.x += this.panGround.x - g.x
    this.view.z += this.panGround.z - g.z
    this.view = this.clampView(this.view)
    this.apply()
    this.panGround = this.groundAt(to) ?? this.panGround
  }

  private onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button === 1) {
      e.preventDefault() // no autoscroll on a middle press
      this.mouse3 = true
      try { localStorage.setItem(MOUSE3_KEY, '1') } catch { /* private mode */ }
    }
    if (!this.interactive) return
    if (this.pointers.size === 0) { gesture.dragged = false; this.down = { x: e.clientX, y: e.clientY } } else gesture.dragged = true
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType, button: e.button })
    try { this.dom.setPointerCapture(e.pointerId) } catch { /* synthetic pointers cannot be captured */ }
    this.goal = null
    if (this.pointers.size === 2) { this.panGround = null; this.pinchPrev = this.pair() }
    if (e.pointerType === 'mouse' && e.button === 1) { gesture.dragged = true; this.startPan({ x: e.clientX, y: e.clientY }) }
  }

  private pair(): [{ x: number; y: number }, { x: number; y: number }] | null {
    const p = [...this.pointers.values()]
    return p.length >= 2 ? [{ x: p[0]!.x, y: p[0]!.y }, { x: p[1]!.x, y: p[1]!.y }] : null
  }

  private onMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId)
    if (!p || !this.interactive) return
    const dx = e.clientX - p.x, dy = e.clientY - p.y
    p.x = e.clientX; p.y = e.clientY
    if (this.pointers.size >= 2) { this.pinchStep(); return }
    const cur = { x: e.clientX, y: e.clientY }
    if (p.type === 'mouse') {
      if (p.button === 2) {
        gesture.dragged = true
        this.view.az -= dx * 0.006
        this.view.pol = clamp(this.view.pol - dy * 0.004, POL_MIN, POL_MAX)
        this.apply()
        return
      }
      if (p.button === 1) { gesture.dragged = true; this.dragTo(cur); return }
      // left button
      if (!gesture.dragged && this.down && Math.hypot(cur.x - this.down.x, cur.y - this.down.y) >= TAP_SLOP) {
        gesture.dragged = true
        if (!this.mouse3) this.startPan(cur)
      }
      if (gesture.dragged && !this.mouse3) { if (!this.panGround) this.startPan(cur); this.dragTo(cur) }
      return
    }
    // touch / pen: one finger pans
    if (!gesture.dragged) {
      if (this.down && Math.hypot(cur.x - this.down.x, cur.y - this.down.y) >= TAP_SLOP) { gesture.dragged = true; this.startPan(cur) }
      return
    }
    if (!this.panGround) this.startPan(cur)
    this.dragTo(cur)
  }

  private pinchStep(): void {
    const cur = this.pair(), prev = this.pinchPrev
    if (!cur || !prev) return
    this.pinchPrev = cur
    const d0 = Math.hypot(prev[1].x - prev[0].x, prev[1].y - prev[0].y)
    const d1 = Math.hypot(cur[1].x - cur[0].x, cur[1].y - cur[0].y)
    let twist = Math.atan2(cur[1].y - cur[0].y, cur[1].x - cur[0].x) - Math.atan2(prev[1].y - prev[0].y, prev[1].x - prev[0].x)
    while (twist > Math.PI) twist -= Math.PI * 2
    while (twist < -Math.PI) twist += Math.PI * 2
    const mid0 = { x: (prev[0].x + prev[1].x) / 2, y: (prev[0].y + prev[1].y) / 2 }
    const mid1 = { x: (cur[0].x + cur[1].x) / 2, y: (cur[0].y + cur[1].y) / 2 }
    const g0 = this.groundAt(mid0)
    if (d0 > 1 && d1 > 1) {
      this.view.az -= twist
      this.apply()
      this.zoomAt(this.view.dist / (d1 / d0), mid0)
    }
    const g1 = g0 ? this.groundAt(mid1) : null
    if (g0 && g1) {
      this.view.x += g0.x - g1.x
      this.view.z += g0.z - g1.z
      this.view = this.clampView(this.view)
      this.apply()
    }
  }

  private onUp = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId)
    if (!p) return
    this.pointers.delete(e.pointerId)
    try { this.dom.releasePointerCapture(e.pointerId) } catch { /* not captured */ }
    this.pinchPrev = null
    if (this.pointers.size === 1) this.startPan([...this.pointers.values()][0]!)
    else if (this.pointers.size === 0) { this.panGround = null; this.down = null }
  }

  private onWheel = (e: WheelEvent): void => {
    if (!this.interactive) return
    e.preventDefault()
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY
    this.goal = null
    this.zoomAt(this.view.dist * Math.exp(px * 0.0012 * (e.ctrlKey ? 2.5 : 1)), { x: e.clientX, y: e.clientY })
  }

  private onContext = (e: Event): void => e.preventDefault()
  private onMouseDown = (e: MouseEvent): void => { if (e.button === 1) e.preventDefault() }

  attach(): void {
    const d = this.dom
    d.style.touchAction = 'none'
    d.addEventListener('pointerdown', this.onDown)
    d.addEventListener('pointermove', this.onMove)
    d.addEventListener('pointerup', this.onUp)
    d.addEventListener('pointercancel', this.onUp)
    d.addEventListener('wheel', this.onWheel, { passive: false })
    d.addEventListener('contextmenu', this.onContext)
    d.addEventListener('mousedown', this.onMouseDown)
    d.addEventListener('auxclick', this.onContext)
    this.cleanup = () => {
      d.removeEventListener('pointerdown', this.onDown)
      d.removeEventListener('pointermove', this.onMove)
      d.removeEventListener('pointerup', this.onUp)
      d.removeEventListener('pointercancel', this.onUp)
      d.removeEventListener('wheel', this.onWheel)
      d.removeEventListener('contextmenu', this.onContext)
      d.removeEventListener('mousedown', this.onMouseDown)
      d.removeEventListener('auxclick', this.onContext)
    }
  }
  detach(): void { this.cleanup?.(); this.cleanup = null; this.pointers.clear() }
}
