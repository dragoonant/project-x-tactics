// Board overlays: move range (blue 1 action, yellow 2), armed-ability targets, hover frame, cover shields on the hovered tile's
// edges, cover lines from a move tile to each known enemy (red full, yellow half, green none), target brackets and hit readout, line of fire, noise radius ring, path preview. All numbers come from query.*.
// Nothing here has a pointer handler (rule 25).
import { Html } from '@react-three/drei'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { Color, DoubleSide, InstancedMesh, MeshBasicMaterial, Object3D } from 'three'
import { query } from '../../engine'
import type { Pt, State, Unit } from '../../engine'
import { useStore } from '../game/store'
import { TERRAIN_V2 } from '../game/terrainAssets'
import { armedTargets, legalFor, reachFor, withUnitAt } from '../game/tap'
import { tx, tz } from './layout'

const noRay = (): null => null
const dummy = new Object3D()
const col = new Color()

const mat = (color: string, opacity: number, side = DoubleSide): MeshBasicMaterial => new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side, toneMapped: false })

export interface Hovered { unit: Unit | null; tile: Pt }

/** The hovered unit (fog-aware: only units the squad can see). */
export function useHoverUnit(): Unit | null {
  const hover = useStore((s) => s.hover)
  const fog = useStore((s) => s.fog)
  if (!hover || !fog) return null
  return fog.units.find((u) => u.x === hover.x && u.y === hover.y && u.status !== 'dead' && u.status !== 'escaped' && u.status !== 'safe') ?? null
}

export function TileMarks({ state }: { state: State }): React.JSX.Element {
  const sel = useStore((s) => s.selected)
  const armed = useStore((s) => s.armed)
  const busy = useStore((s) => s.busy)
  const { w, h } = state.map
  const ref = useRef<InstancedMesh>(null)
  const marks = useMemo(() => {
    const out: { x: number; y: number; color: string; a: number }[] = []
    if (!sel || busy || state.phase !== 'squad' || state.outcome) return out
    const u = state.units.find((x) => x.id === sel)
    if (!u || u.side !== 'squad' || u.status !== 'active') return out
    if (armed) {
      const hot = armed.ability === 'attack' || ['suppress', 'pinningShot', 'frag', 'shieldBash', 'maul', 'baton', 'breach', 'takedown'].includes(armed.ability)
      for (const p of armedTargets(state, legalFor(state), sel, armed)) out.push({ x: p.x, y: p.y, color: hot ? '#ff5a3a' : '#3dff8a', a: 0.45 })
      return out
    }
    const r = reachFor(state, sel)
    for (const key of r.one.keys()) { const [x, y] = key.split(',').map(Number); out.push({ x: x!, y: y!, color: '#3b8cff', a: 0.4 }) }
    for (const d of r.two.values()) out.push({ x: d.x, y: d.y, color: '#ffd23a', a: 0.34 })
    return out
  }, [state, sel, armed, busy])
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    marks.forEach((p, i) => {
      dummy.position.set(tx(p.x, w), 0.035, tz(p.y, h))
      dummy.rotation.set(-Math.PI / 2, 0, 0)
      dummy.scale.set(0.92, 0.92, 1)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
      m.setColorAt(i, col.set(p.color))
    })
    m.count = marks.length
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [marks, w, h])
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, w * h]} frustumCulled={false} raycast={noRay} renderOrder={2}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial transparent opacity={TERRAIN_V2 ? 0.26 : 0.4} depthWrite={false} toneMapped={false} />
    </instancedMesh>
  )
}

function Frame({ x, y, w, h, color, size = 1, y0 = 0.045, thick = 0.05 }: { x: number; y: number; w: number; h: number; color: string; size?: number; y0?: number; thick?: number }): React.JSX.Element {
  const m = useMemo(() => mat(color, 0.95), [color])
  const half = size / 2
  return (
    <group position={[tx(x, w), y0, tz(y, h)]} raycast={noRay}>
      {[[0, -half, size, thick], [0, half, size, thick], [-half, 0, thick, size], [half, 0, thick, size]].map((b, i) => (
        <mesh key={i} position={[b[0]!, 0, b[1]!]} rotation={[-Math.PI / 2, 0, 0]} material={m} raycast={noRay}><planeGeometry args={[b[2]!, b[3]!]} /></mesh>
      ))}
    </group>
  )
}

function Brackets({ x, y, w, h, color }: { x: number; y: number; w: number; h: number; color: string }): React.JSX.Element {
  const m = useMemo(() => mat(color, 1), [color])
  const s = 0.56, L = 0.26, t = 0.05
  const out: React.JSX.Element[] = []
  let key = 0
  for (const yy of [0.06, 1.1]) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    out.push(<mesh key={key++} position={[sx * (s - L / 2), yy, sz * s]} rotation={[-Math.PI / 2, 0, 0]} material={m} raycast={noRay}><planeGeometry args={[L, t]} /></mesh>)
    out.push(<mesh key={key++} position={[sx * s, yy, sz * (s - L / 2)]} rotation={[-Math.PI / 2, 0, 0]} material={m} raycast={noRay}><planeGeometry args={[t, L]} /></mesh>)
  }
  return <group position={[tx(x, w), 0, tz(y, h)]}>{out}</group>
}

const COVER_DIRS: { k: 'N' | 'E' | 'S' | 'W'; dx: number; dz: number }[] = [
  { k: 'N', dx: 0, dz: -1 }, { k: 'E', dx: 1, dz: 0 }, { k: 'S', dx: 0, dz: 1 }, { k: 'W', dx: -1, dz: 0 },
]

function CoverShields({ x, y, w, h, sides }: { x: number; y: number; w: number; h: number; sides: Record<'N' | 'E' | 'S' | 'W', { level: 'none' | 'half' | 'full' }> }): React.JSX.Element {
  const half = useMemo(() => mat('#ffb000', 0.8), [])
  const full = useMemo(() => mat('#5ad0ff', 0.85), [])
  return (
    <group position={[tx(x, w), 0, tz(y, h)]}>
      {COVER_DIRS.map((d) => {
        const lv = sides[d.k].level
        if (lv === 'none') return null
        const hgt = lv === 'full' ? 0.8 : 0.42
        return (
          <mesh key={d.k} position={[d.dx * 0.5, hgt / 2 + 0.04, d.dz * 0.5]} rotation={[0, d.dx !== 0 ? Math.PI / 2 : 0, 0]} material={lv === 'full' ? full : half} raycast={noRay}>
            <planeGeometry args={[0.8, hgt]} />
          </mesh>
        )
      })}
    </group>
  )
}

function Line3({ a, b, w, h, color, opacity = 0.9, thick = 0.03 }: { a: Pt; b: Pt; w: number; h: number; color: string; opacity?: number; thick?: number }): React.JSX.Element {
  const ax = tx(a.x, w), az = tz(a.y, h), bx = tx(b.x, w), bz = tz(b.y, h)
  const len = Math.hypot(bx - ax, bz - az)
  const m = useMemo(() => mat(color, opacity), [color, opacity])
  return (
    <mesh position={[(ax + bx) / 2, 0.75, (az + bz) / 2]} rotation={[0, Math.atan2(-(bz - az), bx - ax), 0]} material={m} raycast={noRay} renderOrder={5}>
      <boxGeometry args={[len, thick, thick]} />
    </mesh>
  )
}

/** Move preview: the cover each known enemy would have against the trooper standing on the hovered tile (query.coverLines). */
export const COVER_LINE_COLORS = { full: '#ff3b30', half: '#ffd23a', none: '#3dff8a' } as const

function Ring({ x, y, r, w, h, color }: { x: number; y: number; r: number; w: number; h: number; color: string }): React.JSX.Element {
  const m = useMemo(() => mat(color, 0.7), [color])
  return (
    <mesh position={[tx(x, w), 0.05, tz(y, h)]} rotation={[-Math.PI / 2, 0, 0]} material={m} raycast={noRay} renderOrder={3}>
      <ringGeometry args={[r + 0.5 - 0.07, r + 0.5, 72]} />
    </mesh>
  )
}

export function PathLine({ path, w, h }: { path: Pt[]; w: number; h: number }): React.JSX.Element {
  const m = useMemo(() => mat('#9cc9ff', 0.9), [])
  return (
    <group>
      {path.map((p, i) => (
        <mesh key={i} position={[tx(p.x, w), 0.06, tz(p.y, h)]} rotation={[-Math.PI / 2, 0, 0]} material={m} raycast={noRay} renderOrder={4}>
          <circleGeometry args={[i === path.length - 1 ? 0.2 : 0.1, 12]} />
        </mesh>
      ))}
    </group>
  )
}

/** Everything driven by the hovered tile and the selected trooper. */
export function HoverOverlay({ state }: { state: State }): React.JSX.Element | null {
  const hover = useStore((s) => s.hover)
  const sel = useStore((s) => s.selected)
  const armed = useStore((s) => s.armed)
  const busy = useStore((s) => s.busy)
  const fog = useStore((s) => s.fog)
  const { w, h } = state.map
  const hu = useHoverUnit()
  const data = useMemo(() => {
    if (!hover || !fog) return null
    const selU = sel ? state.units.find((u) => u.id === sel) : undefined
    const canAct = !!selU && selU.side === 'squad' && selU.status === 'active' && state.phase === 'squad' && !busy && !state.outcome
    let sides = null as null | ReturnType<typeof query.coverPerSide>
    let path: Pt[] | null = null
    let lines: ReturnType<typeof query.coverLines> = []
    if (hu && hu.side !== 'civilians') sides = query.coverPerSide(state, hu.id)
    else if (!hu && canAct) {
      const r = reachFor(state, selU!.id)
      const key = `${hover.x},${hover.y}`
      const p1 = r.one.get(key)
      const p2 = r.two.get(key)
      if (p1 || p2) {
        sides = query.coverPerSide(withUnitAt(state, selU!.id, hover.x, hover.y), selU!.id)
        path = p1 ?? (p2 ? [{ x: p2.via.x, y: p2.via.y }, { x: p2.x, y: p2.y }] : null)
        // the fog view, so the lines never point at an enemy the squad cannot see
        if (!armed) lines = query.coverLines(fog, selU!.id, hover)
      }
    }
    let prev: ReturnType<typeof query.preview> = null
    let noise: { loud: boolean; radius: number; groups: string[] } | null = null
    // ABL-TKD-1: the takedown readout when it is armed, or when a plain tap on this enemy would take it down (tap.ts)
    const takedown = canAct && !!hu && hu.side === 'syndicate' && (armed ? armed.ability === 'takedown' : true) &&
      legalFor(state).some((a) => a.type === 'ability' && a.ability === 'takedown' && a.unit === selU!.id && a.target === hu.id)
    if (canAct && hu && hu.side === 'syndicate' && !takedown) {
      const ability = armed && armed.ability !== 'attack' ? armed.ability : undefined
      prev = query.preview(state, selU!.id, hu.id, ability)
      noise = query.noiseInfo(state, selU!.id, ability)
    }
    if (canAct && armed && !prev) {
      noise = query.noiseInfo(state, selU!.id, armed.ability === 'attack' ? undefined : armed.ability)
    }
    return { selU: canAct ? selU! : null, sides, path, lines, prev, noise, takedown }
  }, [hover, fog, sel, state, armed, busy, hu])
  if (!hover || !data) return null
  const enemy = hu && hu.side === 'syndicate' ? hu : null
  const fireColor = data.prev ? (data.prev.breakdown.chance >= 60 ? '#3dff8a' : data.prev.breakdown.chance >= 35 ? '#ffb000' : '#ff5a3a') : '#ff5a3a'
  return (
    <group>
      <Frame x={hover.x} y={hover.y} w={w} h={h} color={enemy ? '#ff5a3a' : '#ffffff'} />
      {data.sides && <CoverShields x={hover.x} y={hover.y} w={w} h={h} sides={data.sides} />}
      {data.path && <PathLine path={data.path} w={w} h={h} />}
      {data.lines.map((l) => (
        <Line3 key={l.target} a={hover} b={l.at} w={w} h={h} color={COVER_LINE_COLORS[l.level]} opacity={l.sees ? 1 : 0.4} thick={l.sees ? 0.08 : 0.04} />
      ))}
      {enemy && data.selU && data.prev && (
        <>
          <Brackets x={enemy.x} y={enemy.y} w={w} h={h} color={fireColor} />
          <Line3 a={{ x: data.selU.x, y: data.selU.y }} b={{ x: enemy.x, y: enemy.y }} w={w} h={h} color={fireColor} />
          <Html position={[tx(enemy.x, w), 1.65, tz(enemy.y, h)]} center style={{ pointerEvents: 'none', userSelect: 'none' }} zIndexRange={[8, 0]}>
            <div className="readout">
              <b>HIT {data.prev.breakdown.chance}%</b>
              <span>GRAZE {data.prev.breakdown.grazeChance}%</span>
              <span>RES {Math.min(...data.prev.resolve.hit) === Math.max(...data.prev.resolve.hit) ? data.prev.resolve.hit[0] : `${Math.min(...data.prev.resolve.hit)}-${Math.max(...data.prev.resolve.hit)}`}</span>
              {data.prev.flanked && <em>FLANK</em>}
            </div>
          </Html>
        </>
      )}
      {enemy && data.selU && data.takedown && (
        <>
          <Brackets x={enemy.x} y={enemy.y} w={w} h={h} color="#3dff8a" />
          <Html position={[tx(enemy.x, w), 1.65, tz(enemy.y, h)]} center style={{ pointerEvents: 'none', userSelect: 'none' }} zIndexRange={[8, 0]}>
            <div className="readout" data-testid="takedown-readout"><b>TAKEDOWN</b><span>SURRENDERS</span><span>SILENT</span></div>
          </Html>
        </>
      )}
      {data.noise?.loud && data.selU && <Ring x={data.selU.x} y={data.selU.y} r={data.noise.radius} w={w} h={h} color="#ff8a1f" />}
    </group>
  )
}
