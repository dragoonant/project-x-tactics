// Transient effects (tracers, flashes, bursts, rings, floating text) and the persistent volumes (gas, smoke, scans, spotlights).
// No pointer handlers. Effects are driven by the presentation director; volumes are drawn straight from the engine state.
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AdditiveBlending, DoubleSide, MeshBasicMaterial, type Group, type Mesh } from 'three'
import type { State } from '../../engine'
import { fxList, onFxChange, pruneFx, wake, type Fx } from '../game/presentation'
import { hash2, tx, tz } from './layout'

const noRay = (): null => null
const TONE: Record<string, string> = { hit: '#ff7a2a', miss: '#9aa3b5', dmg: '#ff5a3a', good: '#3dff8a', fire: '#ffa030', gas: '#9cff4a', scan: '#59a8ff', smoke: '#b9bcc4', light: '#ffe08a', spark: '#ffe08a' }

function Tracer({ fx, w, h }: { fx: Fx; w: number; h: number }): React.JSX.Element {
  const ref = useRef<Mesh>(null)
  const m = useMemo(() => new MeshBasicMaterial({ color: TONE[fx.tone ?? 'hit'], toneMapped: false, transparent: true }), [fx.tone])
  useFrame(() => {
    const me = ref.current
    if (!me || !fx.from || !fx.to) return
    const p = Math.min(1, (performance.now() - fx.t0) / Math.max(1, fx.dur))
    const ax = tx(fx.from.x, w), az = tz(fx.from.y, h), bx = tx(fx.to.x, w), bz = tz(fx.to.y, h)
    const head = Math.min(1, p * 1.15), tail = Math.max(0, p * 1.15 - 0.25)
    const hx = ax + (bx - ax) * head, hz = az + (bz - az) * head, tx0 = ax + (bx - ax) * tail, tz0 = az + (bz - az) * tail
    const len = Math.hypot(hx - tx0, hz - tz0)
    me.position.set((hx + tx0) / 2, 0.75, (hz + tz0) / 2)
    me.rotation.set(0, Math.atan2(-(hz - tz0), hx - tx0), 0)
    me.scale.set(Math.max(0.001, len), 1, 1)
    m.opacity = 1 - p * 0.4
    wake(40)
  })
  return <mesh ref={ref} material={m} raycast={noRay}><boxGeometry args={[1, 0.05, 0.05]} /></mesh>
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
        if (fx.kind === 'tracer') return <Tracer key={fx.id} fx={fx} w={w} h={h} />
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
