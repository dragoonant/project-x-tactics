// Transient effects (shot volleys, flashes, bursts, rings, floating text) and the persistent volumes (gas, smoke, scans, spotlights).
// No pointer handlers. Effects are driven by the presentation director; volumes are drawn straight from the engine state.
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AdditiveBlending, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, Quaternion, SphereGeometry, Vector3 } from 'three'
import type { State } from '../../engine'
import { fxList, onFxChange, pruneFx, wake, type Fx } from '../game/presentation'
import { hash2, tx, tz } from './layout'

const noRay = (): null => null
const TONE: Record<string, string> = { hit: '#ff7a2a', miss: '#9aa3b5', dmg: '#ff5a3a', good: '#3dff8a', fire: '#ffa030', gas: '#9cff4a', scan: '#59a8ff', smoke: '#b9bcc4', light: '#ffe08a', spark: '#ffe08a' }

/** A round is a thin cylinder along its flight (seen end-on from behind the shooter it is a dot, not a square). */
const streakGeo = new CylinderGeometry(0.5, 0.5, 1, 8, 1) // unit diameter: scale x and z by the width
const puffGeo = new SphereGeometry(1, 10, 8)
const Y_AXIS = new Vector3(0, 1, 0)
const mid = new Vector3()
interface PuffSpec { c: string; add: boolean; s0: number; s1: number; ms: number; o: number; rise?: number }
/** What a round leaves where it ends: a body hit (a bright spark and a dark red mist), a wall (sparks, grit) or the ground (dust). */
const IMPACTS: Record<'flesh' | 'spark' | 'dust', PuffSpec[]> = {
  flesh: [{ c: '#ffc080', add: true, s0: 0.05, s1: 0.16, ms: 120, o: 1 }, { c: '#7a1410', add: false, s0: 0.08, s1: 0.26, ms: 380, o: 0.65 }],
  spark: [{ c: '#ffe08a', add: true, s0: 0.04, s1: 0.14, ms: 150, o: 1 }, { c: '#8d8f96', add: false, s0: 0.06, s1: 0.22, ms: 420, o: 0.45 }],
  dust: [{ c: '#ffd9a0', add: true, s0: 0.03, s1: 0.09, ms: 100, o: 0.8 }, { c: '#9c8e78', add: false, s0: 0.08, s1: 0.34, ms: 520, o: 0.55, rise: 0.1 }],
}
const mat = (color: string, add: boolean, opacity = 1): MeshBasicMaterial =>
  new MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity, depthWrite: false, ...(add ? { blending: AdditiveBlending } : {}) })
function mesh(geo: CylinderGeometry | SphereGeometry, m: MeshBasicMaterial): Mesh { const me = new Mesh(geo, m); me.visible = false; me.raycast = noRay; return me }

interface Puff { me: Mesh; spec: PuffSpec; at: Vector3; t: number }
/** Show a puff `e` wall ms after it starts (hidden before and after). `time`: wall ms per full-speed ms (bullet time stretches puffs too). */
function drawPuff(p: Puff, e: number, time: number): void {
  const ms = p.spec.ms * time
  const on = e >= 0 && e < ms
  p.me.visible = on
  if (!on) return
  const f = e / ms
  const sz = p.spec.s0 + (p.spec.s1 - p.spec.s0) * Math.sqrt(f)
  p.me.scale.setScalar(sz)
  p.me.position.set(p.at.x, p.at.y + (p.spec.rise ?? 0) * f, p.at.z)
  ;(p.me.material as MeshBasicMaterial).opacity = p.spec.o * (1 - f)
}

/** The rounds of one ranged attack: streaks that fly from the muzzle (tracers longer and hotter), their impacts and the muzzle smoke. */
function VolleyFx({ fx }: { fx: Fx }): React.JSX.Element {
  const v = fx.volley!
  const parts = useMemo(() => {
    const group = new Group()
    const mats: MeshBasicMaterial[] = []
    const keep = (m: MeshBasicMaterial): MeshBasicMaterial => { mats.push(m); return m }
    const rounds = v.rounds.map((r) => {
      const from = new Vector3(...r.from), to = new Vector3(...r.to)
      const dir = to.clone().sub(from)
      const dist = dir.length()
      dir.normalize()
      const q = new Quaternion().setFromUnitVectors(Y_AXIS, dir)
      const core = mesh(streakGeo, keep(mat(r.tracer ? '#ffd2a0' : '#fffaf0', true)))
      const glow = mesh(streakGeo, keep(mat(r.color, true, r.tracer ? 0.3 : 0.32)))
      const trail = v.trail ? mesh(streakGeo, keep(mat('#cfe0ff', true, 0.3))) : null
      for (const m of [core, glow, trail]) if (m) { m.quaternion.copy(q); group.add(m) }
      const impact: Puff[] = (r.impact ? IMPACTS[r.impact] : []).map((spec) => ({ me: mesh(puffGeo, keep(mat(spec.c, spec.add, spec.o))), spec, at: to, t: r.delay + r.flight }))
      for (const p of impact) group.add(p.me)
      return { r, from, dir, dist, core, glow, trail, impact }
    })
    const muzzle = new Vector3(...(v.rounds[0]?.from ?? [0, 0, 0]))
    const extras: Puff[] = []
    for (const t of v.shots) {
      if (v.smoke > 0) extras.push({ me: mesh(puffGeo, keep(mat('#b4b6bc', false, 0.4))), spec: { c: '', add: false, s0: 0.02, s1: 0.04 + 0.1 * v.smoke, ms: 420, o: 0.08 + 0.1 * v.smoke, rise: 0.18 }, at: muzzle, t })
      if (v.worldFlash) extras.push({ me: mesh(puffGeo, keep(mat('#ffe9a0', true))), spec: { c: '', add: true, s0: 0.1 * v.flash, s1: 0.16 * v.flash, ms: 60, o: 1 }, at: muzzle, t })
    }
    for (const p of extras) group.add(p.me)
    return { group, mats, rounds, extras }
  }, [v])
  useEffect(() => () => { for (const m of parts.mats) m.dispose() }, [parts])
  useFrame(({ camera }) => {
    const t = performance.now() - fx.t0
    for (const o of parts.rounds) {
      const { r, from, dir, dist, core, glow, trail } = o
      const e = t - r.delay
      const travelled = e < 0 ? -1 : (e / Math.max(1, r.flight)) * dist
      // a round shows from just past the muzzle (inside the flash it would only be a blob near the camera)
      const head = Math.min(dist, travelled), tail = Math.max(Math.min(0.3, dist * 0.2), travelled - r.len)
      const flying = travelled >= 0 && tail < head
      // far from the camera a round keeps a minimum on-screen thickness (zoomed out it would vanish), close up it is its real size
      const far = flying ? camera.position.distanceTo(mid.copy(from).addScaledVector(dir, (head + tail) / 2)) : 0
      for (const m of [core, glow]) {
        m.visible = flying
        if (!flying) continue
        // tracers stay hair-thin with a faint sleeve at any zoom; plain rounds read as solid slugs
        const w = r.tracer
          ? (m === core ? Math.max(r.width, far * 0.0012) : Math.max(r.width * 1.8, far * 0.0024))
          : (m === core ? Math.max(r.width, far * 0.0042) : Math.max(r.width * 2.2, far * 0.009))
        m.position.copy(mid)
        m.scale.set(w, Math.max(0.001, head - tail), w)
      }
      if (trail) {
        const fade = e < r.flight ? 1 : 1 - (e - r.flight) / (700 * v.time)
        trail.visible = travelled >= 0 && fade > 0
        if (trail.visible) {
          trail.position.copy(from).addScaledVector(dir, head / 2)
          trail.scale.set(r.width * 0.6, Math.max(0.001, head), r.width * 0.6)
          ;(trail.material as MeshBasicMaterial).opacity = 0.3 * fade
        }
      }
      for (const p of o.impact) drawPuff(p, t - p.t, v.time)
    }
    for (const p of parts.extras) drawPuff(p, t - p.t, v.time)
    wake(40)
  })
  return <primitive object={parts.group} />
}

function Burst({ fx, w, h }: { fx: Fx; w: number; h: number }): React.JSX.Element {
  const ref = useRef<Mesh>(null)
  const m = useMemo(() => new MeshBasicMaterial({ color: TONE[fx.tone ?? 'fire'], toneMapped: false, transparent: true, blending: AdditiveBlending, depthWrite: false }), [fx.tone])
  useFrame(() => {
    const me = ref.current
    if (!me) return
    const p = Math.min(1, Math.max(0, (performance.now() - fx.t0) / Math.max(1, fx.dur)))
    const s = (fx.r ?? 1) * (0.3 + p * 0.9)
    me.scale.set(s, s, s)
    m.opacity = (1 - p) * 0.85
    wake(40)
  })
  return <mesh ref={ref} position={[tx(fx.at!.x, w), 0.6, tz(fx.at!.y, h)]} material={m} raycast={noRay}><sphereGeometry args={[1, 14, 10]} /></mesh>
}

function RingFx({ fx, w, h }: { fx: Fx; w: number; h: number }): React.JSX.Element {
  const ref = useRef<Mesh>(null)
  const m = useMemo(() => new MeshBasicMaterial({ color: TONE[fx.tone ?? 'gas'], toneMapped: false, transparent: true, side: DoubleSide, depthWrite: false }), [fx.tone])
  useFrame(() => {
    const me = ref.current
    if (!me) return
    const p = Math.min(1, Math.max(0, (performance.now() - fx.t0) / Math.max(1, fx.dur)))
    const s = (fx.r ?? 1) * (0.2 + p)
    me.scale.set(s, s, s)
    m.opacity = (1 - p) * 0.9
    wake(40)
  })
  return <mesh ref={ref} position={[tx(fx.at!.x, w), 0.07, tz(fx.at!.y, h)]} rotation={[-Math.PI / 2, 0, 0]} material={m} raycast={noRay}><ringGeometry args={[0.85, 1, 40]} /></mesh>
}

function Flash({ fx, w, h }: { fx: Fx; w: number; h: number }): React.JSX.Element {
  const m = useMemo(() => new MeshBasicMaterial({ color: '#ffe9a0', toneMapped: false, transparent: true, blending: AdditiveBlending }), [])
  return <mesh position={[tx(fx.at!.x, w), 0.78, tz(fx.at!.y, h)]} material={m} raycast={noRay}><sphereGeometry args={[0.2, 8, 6]} /></mesh>
}

export function FxLayer({ w, h }: { w: number; h: number }): React.JSX.Element {
  const [, bump] = useState(0)
  useEffect(() => onFxChange(() => bump((n) => n + 1)), [])
  useFrame(() => { if (pruneFx(performance.now())) bump((n) => n + 1) })
  return (
    <group>
      {fxList.map((fx) => {
        if (fx.kind === 'volley' && fx.volley) return <VolleyFx key={fx.id} fx={fx} />
        if (fx.kind === 'burst') return <Burst key={fx.id} fx={fx} w={w} h={h} />
        if (fx.kind === 'ring') return <RingFx key={fx.id} fx={fx} w={w} h={h} />
        if (fx.kind === 'flash') return <Flash key={fx.id} fx={fx} w={w} h={h} />
        if (fx.kind === 'text' && fx.at)
          return (
            <Html key={fx.id} position={[tx(fx.at.x, w), 1.5, tz(fx.at.y, h)]} center style={{ pointerEvents: 'none', userSelect: 'none' }} zIndexRange={[9, 0]}>
              <div className={`fx-text tone-${fx.tone ?? 'hit'}`} style={{ animationDuration: `${Math.max(200, fx.dur)}ms`, animationDelay: `${Math.max(0, fx.t0 - performance.now())}ms` }}>{fx.text}</div>
            </Html>
          )
        return null
      })}
    </group>
  )
}

// ---------------------------------------------------------------------------------------------- volumes
function cloudTiles(s: State, cl: { x: number; y: number; r: number }): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  for (let y = cl.y - cl.r; y <= cl.y + cl.r; y++) for (let x = cl.x - cl.r; x <= cl.x + cl.r; x++) {
    const t = s.map.tiles[y * s.map.w + x]
    if (x >= 0 && y >= 0 && x < s.map.w && y < s.map.h && t && t.k !== 'wall') out.push({ x, y })
  }
  return out
}

function Puff({ x, y, w, h, color, opacity, seed, scale }: { x: number; y: number; w: number; h: number; color: string; opacity: number; seed: number; scale: number }): React.JSX.Element {
  const ref = useRef<Group>(null)
  const m = useMemo(() => new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false }), [color, opacity])
  useFrame(({ clock }) => {
    const g = ref.current
    if (!g) return
    const t = clock.elapsedTime
    g.position.y = 0.55 + Math.sin(t * 0.9 + seed * 6) * 0.07
    const s = scale * (1 + Math.sin(t * 1.3 + seed * 9) * 0.06)
    g.scale.set(s, s * 0.9, s)
    wake(60)
  })
  return (
    <group ref={ref} position={[tx(x, w) + (hash2(x, y, 61) - 0.5) * 0.3, 0.55, tz(y, h) + (hash2(x, y, 62) - 0.5) * 0.3]}>
      <mesh material={m} raycast={noRay}><icosahedronGeometry args={[0.62, 1]} /></mesh>
      <mesh material={m} position={[0.2, 0.25, -0.1]} raycast={noRay}><icosahedronGeometry args={[0.4, 1]} /></mesh>
    </group>
  )
}

export function Volumes({ state }: { state: State }): React.JSX.Element {
  const { w, h } = state.map
  return (
    <group>
      {state.gas.map((c, i) => cloudTiles(state, c).map((p) => <Puff key={`g${i}-${p.x}-${p.y}`} x={p.x} y={p.y} w={w} h={h} color="#9cff4a" opacity={0.34} seed={hash2(p.x, p.y, 3)} scale={1} />))}
      {state.smoke.map((c, i) => cloudTiles(state, c).map((p) => <Puff key={`s${i}-${p.x}-${p.y}`} x={p.x} y={p.y} w={w} h={h} color="#c9ccd4" opacity={0.6} seed={hash2(p.x, p.y, 4)} scale={1.1} />))}
      {state.scans.map((c, i) => (
        <mesh key={`sc${i}`} position={[tx(c.x, w), 0.06, tz(c.y, h)]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRay}>
          <ringGeometry args={[c.r + 0.35, c.r + 0.5, 48]} />
          <meshBasicMaterial color="#59a8ff" transparent opacity={0.85} toneMapped={false} side={DoubleSide} depthWrite={false} />
        </mesh>
      ))}
      {state.scans.map((c, i) => (
        <mesh key={`sd${i}`} position={[tx(c.x, w), 0.05, tz(c.y, h)]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRay}>
          <circleGeometry args={[c.r + 0.5, 48]} />
          <meshBasicMaterial color="#59a8ff" transparent opacity={0.12} toneMapped={false} depthWrite={false} />
        </mesh>
      ))}
      {state.spotlights.map((c, i) => (
        <group key={`sp${i}`} position={[tx(c.x, w), 0, tz(c.y, h)]}>
          <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRay}>
            <circleGeometry args={[c.r + 0.5, 40]} />
            <meshBasicMaterial color="#ffe9a0" transparent opacity={0.28} blending={AdditiveBlending} toneMapped={false} depthWrite={false} />
          </mesh>
          <mesh position={[0, 2.2, 0]} raycast={noRay}>
            <cylinderGeometry args={[0.25, c.r + 0.5, 4.4, 24, 1, true]} />
            <meshBasicMaterial color="#ffe9a0" transparent opacity={0.07} side={DoubleSide} blending={AdditiveBlending} toneMapped={false} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  )
}
