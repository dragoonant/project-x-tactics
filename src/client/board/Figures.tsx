// Figures: GLB models where the manifest has one, otherwise a procedural stand-in (capsule body, helmet, weapon block) in the
// unit's colours. No bases: they stand on the tile. No pointer handlers anywhere here (rule 25): taps resolve by tile.
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { memo, useEffect, useMemo, useRef } from 'react'
import { Color, DoubleSide, MeshBasicMaterial, MeshStandardMaterial, type Group, type Mesh } from 'three'
import type { State, Unit } from '../../engine'
import { callSign } from '../game/names'
import { modelFor } from '../game/models'
import { along, motion, wake } from '../game/presentation'
import { useStore } from '../game/store'
import { rigFor } from '../anim/assets'
import { cueActive } from '../anim/cues'
import { AnimFrame, RigModel } from '../anim/Rig'
import { NO_STANCE, stanceFor, type Stance } from '../anim/mapping'
import { query } from '../../engine'
import { tx, tz } from './layout'

const noRay = (): null => null

interface Palette { body: string; trim: string; helmet: string; weapon: string }
function paletteFor(u: Unit): Palette {
  if (u.side === 'squad') {
    if (u.kind === 'recruit') return { body: '#5d6b32', trim: '#c4352a', helmet: '#4a5628', weapon: '#23262b' }
    return { body: '#202329', trim: '#ffb000', helmet: '#15171b', weapon: '#34373e' }
  }
  if (u.side === 'civilians') return { body: '#8b8f98', trim: '#b9bcc4', helmet: '#c9a98a', weapon: '#8b8f98' }
  if (u.kind === 'bagman') return { body: '#8f3a22', trim: '#ffcf4a', helmet: '#5a2416', weapon: '#2a2220' }
  return { body: '#9b3d25', trim: '#d1704a', helmet: '#5d2518', weapon: '#26211f' }
}

const matCache = new Map<string, MeshStandardMaterial>()
function stdMat(color: string, rough = 0.6, metal = 0.1, emissive?: string): MeshStandardMaterial {
  const key = `${color}|${rough}|${metal}|${emissive ?? ''}`
  let m = matCache.get(key)
  if (!m) { m = new MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive: emissive ?? '#000000', emissiveIntensity: emissive ? 1.4 : 0 }); matCache.set(key, m) }
  return m
}

function StandIn({ u }: { u: Unit }): React.JSX.Element {
  const p = paletteFor(u)
  const heavy = u.kind === 'heavy', civ = u.side === 'civilians', thug = u.kind === 'thug'
  const sx = heavy ? 1.3 : civ ? 0.85 : 1
  const sy = civ ? 0.9 : 1
  const longGun = u.kind === 'marksman' || heavy
  return (
    <group scale={[sx, sy, sx]}>
      <mesh position={[-0.08, 0.2, 0]} material={stdMat(p.trim, 0.7)}><boxGeometry args={[0.1, 0.4, 0.12]} /></mesh>
      <mesh position={[0.08, 0.2, 0]} material={stdMat(p.trim, 0.7)}><boxGeometry args={[0.1, 0.4, 0.12]} /></mesh>
      <mesh position={[0, 0.58, 0]} material={stdMat(p.body, 0.65, 0.1)}><capsuleGeometry args={[0.17, 0.3, 4, 10]} /></mesh>
      <mesh position={[0, 0.66, 0.13]} material={stdMat(p.trim, 0.55)}><boxGeometry args={[0.32, 0.06, 0.06]} /></mesh>
      <mesh position={[0, 0.93, 0]} material={stdMat(p.helmet, 0.45, 0.2)}><sphereGeometry args={[0.14, 12, 10]} /></mesh>
      {!civ && <mesh position={[0, 0.92, 0.1]} material={stdMat('#0b0d10', 0.2, 0.6)}><boxGeometry args={[0.18, 0.06, 0.06]} /></mesh>}
      {!civ && <mesh position={[0.2, 0.6, 0.18]} material={stdMat(p.weapon, 0.5, 0.4)}><boxGeometry args={[0.07, 0.09, longGun ? 0.62 : thug ? 0.12 : 0.42]} /></mesh>}
      {thug && <mesh position={[0.2, 0.62, 0.28]} rotation={[0.5, 0, 0]} material={stdMat('#6b4a2a', 0.8)}><boxGeometry args={[0.06, 0.06, 0.5]} /></mesh>}
      {u.kind === 'bulwark' && <mesh position={[-0.02, 0.58, 0.28]} material={stdMat('#2c3039', 0.4, 0.5)}><boxGeometry args={[0.52, 0.66, 0.06]} /></mesh>}
      {u.kind === 'bulwark' && <mesh position={[-0.02, 0.58, 0.32]} material={stdMat('#ffb000', 0.5, 0.2, '#ff9a00')}><boxGeometry args={[0.3, 0.06, 0.02]} /></mesh>}
    </group>
  )
}

function Model({ kind, variant }: { kind: string; variant: string | null }): React.JSX.Element | null {
  const m = modelFor(kind, variant)
  const obj = useMemo(() => (m ? m.scene.clone(true) : null), [m])
  if (!m || !obj) return null
  return <group rotation={[0, m.yaw, 0]}><primitive object={obj} /></group>
}

const barBg = new MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.7, side: DoubleSide, depthTest: false })
const hpGood = new MeshBasicMaterial({ color: '#3dff8a', side: DoubleSide, depthTest: false })
const hpHurt = new MeshBasicMaterial({ color: '#ffb000', side: DoubleSide, depthTest: false })
const hpBad = new MeshBasicMaterial({ color: '#ff4a3a', side: DoubleSide, depthTest: false })
const resMat = new MeshBasicMaterial({ color: '#59a8ff', side: DoubleSide, depthTest: false })
const pipOn = new MeshBasicMaterial({ color: '#ffb000', side: DoubleSide, depthTest: false })
const pipOff = new MeshBasicMaterial({ color: '#4a3a1a', side: DoubleSide, depthTest: false })

/** HP / Resolve bars and action pips, billboarded. */
function Bars({ u }: { u: Unit }): React.JSX.Element | null {
  const ref = useRef<Group>(null)
  const { camera } = useThree()
  useFrame(() => { if (ref.current) ref.current.quaternion.copy(camera.quaternion) })
  if (u.status === 'dead') return null
  const frac = Math.max(0, Math.min(1, u.hp / Math.max(1, u.maxHp)))
  const rf = u.maxResolve > 0 ? Math.max(0, Math.min(1, u.resolve / u.maxResolve)) : 0
  const W = 0.62
  const showPips = u.side === 'squad' && u.status === 'active'
  return (
    <group ref={ref} position={[0, 1.28, 0]} renderOrder={20}>
      <mesh position={[0, 0, 0]} material={barBg} raycast={noRay} renderOrder={20}><planeGeometry args={[W + 0.04, 0.1]} /></mesh>
      <mesh position={[-(W * (1 - frac)) / 2, 0, 0.001]} material={frac > 0.6 ? hpGood : frac > 0.3 ? hpHurt : hpBad} raycast={noRay} renderOrder={21}><planeGeometry args={[Math.max(0.001, W * frac), 0.07]} /></mesh>
      {u.maxResolve > 0 && (
        <>
          <mesh position={[0, -0.085, 0]} material={barBg} raycast={noRay} renderOrder={20}><planeGeometry args={[W + 0.04, 0.07]} /></mesh>
          <mesh position={[-(W * (1 - rf)) / 2, -0.085, 0.001]} material={resMat} raycast={noRay} renderOrder={21}><planeGeometry args={[Math.max(0.001, W * rf), 0.04]} /></mesh>
        </>
      )}
      {showPips && [0, 1].map((i) => (
        <mesh key={i} position={[(i - 0.5) * 0.16, 0.12, 0]} material={u.actions > i ? pipOn : pipOff} raycast={noRay} renderOrder={21}><planeGeometry args={[0.12, 0.07]} /></mesh>
      ))}
    </group>
  )
}

function Marker({ color, y = 1.55, shape = 'diamond' }: { color: string; y?: number; shape?: 'diamond' | 'cone' }): React.JSX.Element {
  const ref = useRef<Mesh>(null)
  useFrame((_, dt) => { if (ref.current) { ref.current.rotation.y += dt * 2; wake(50) } })
  return (
    <mesh ref={ref} position={[0, y, 0]} raycast={noRay} material={stdMat(color, 0.3, 0.6, color)}>
      {shape === 'diamond' ? <octahedronGeometry args={[0.1, 0]} /> : <coneGeometry args={[0.09, 0.2, 5]} />}
    </mesh>
  )
}

function FigureImpl({ unit, w, h, selected, hovered, lite, stance = NO_STANCE }: { unit: Unit; w: number; h: number; selected: boolean; hovered: boolean; lite: boolean; stance?: Stance }): React.JSX.Element {
  const ref = useRef<Group>(null)
  const stanceRef = useRef(stance)
  stanceRef.current = stance
  const inner = useRef<Group>(null)
  const yaw = useRef(Math.atan2(unit.facing.x, unit.facing.y))
  const m = modelFor(unit.kind, unit.weapon)
  const rig = rigFor(unit.kind, unit.weapon) // a rigged figure (spec 30) wins over the static one; neither: the stand-in
  const lying = !rig && (unit.status === 'downed' || unit.status === 'dead' || unit.status === 'stabilized')
  const kneel = !rig && (unit.status === 'surrendered' || unit.status === 'cuffed')

  useFrame((_, dt) => {
    const g = ref.current
    if (!g) return
    let px = unit.x, py = unit.y
    let want = Math.atan2(unit.facing.x, unit.facing.y)
    const aim = stanceRef.current.aim
    if (aim && (aim.x !== unit.x || aim.y !== unit.y)) want = Math.atan2(aim.x - unit.x, aim.y - unit.y)
    let hop = 0
    const cue = cueActive(unit.id)
    if (cue?.face) want = Math.atan2(cue.face.x - unit.x, cue.face.y - unit.y)
    const mo = motion.get(unit.id)
    if (mo) {
      const t = (performance.now() - mo.t0) / Math.max(1, mo.dur)
      if (t >= 1) motion.delete(unit.id)
      else {
        const a = along(mo.path, t)
        px = a.x; py = a.y
        if (a.dx !== 0 || a.dy !== 0) want = Math.atan2(a.dx, a.dy)
        if (!rig) hop = Math.abs(Math.sin(t * (mo.path.length - 1) * Math.PI)) * 0.09 // static figures hop; a rig walks
        wake(40)
      }
    }
    g.position.set(tx(px, w), hop, tz(py, h))
    let d = want - yaw.current
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    // time-based turn: about 0.1 s to close most of a half turn while moving, 0.06 s standing (frame-rate independent)
    yaw.current += d * (1 - Math.exp(-Math.min(dt, 0.1) * (mo ? 14 : 20)))
    if (Math.abs(d) > 0.01) wake(40)
    if (inner.current) inner.current.rotation.y = yaw.current
  })

  return (
    <group ref={ref} position={[tx(unit.x, w), 0, tz(unit.y, h)]}>
      <group ref={inner} rotation={[0, yaw.current, 0]}>
        <group rotation={lying ? [-Math.PI / 2 + 0.1, 0, 0] : [0, 0, 0]} position={lying ? [0, 0.16, 0.18] : [0, 0, 0]} scale={kneel ? [1, 0.74, 1] : [1, 1, 1]}>
          {rig ? <RigModel unit={unit} rig={rig} lite={lite} cover={stance.cover} /> : m ? <Model kind={unit.kind} variant={unit.weapon} /> : <StandIn u={unit} />}
        </group>
      </group>
      {selected && (
        <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRay} material={stdMat('#ffb000', 0.3, 0, '#ffb000')}>
          <ringGeometry args={[0.46, 0.56, 28]} />
        </mesh>
      )}
      {hovered && !selected && (
        <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRay} material={stdMat(unit.side === 'squad' ? '#3dff8a' : '#ff5a3a', 0.3, 0, unit.side === 'squad' ? '#3dff8a' : '#ff5a3a')}>
          <ringGeometry args={[0.44, 0.5, 28]} />
        </mesh>
      )}
      {unit.kind === 'bagman' && unit.status !== 'dead' && <Marker color="#ffcf4a" />}
      {unit.overwatch && unit.status === 'active' && <Marker color="#59a8ff" y={1.5} shape="cone" />}
      {unit.hunkered && unit.status === 'active' && <Marker color="#3dff8a" y={1.5} shape="cone" />}
      {(unit.status === 'surrendered' || unit.status === 'cuffed') && <Marker color="#ffffff" y={1.35} />}
      {unit.suppressedBy && unit.status === 'active' && <Marker color="#ff4a3a" y={1.5} />}
      <Bars u={unit} />
    </group>
  )
}
const sameStance = (a: Stance | undefined, b: Stance | undefined): boolean =>
  a === b || (!!a && !!b && a.cover === b.cover && a.aim?.x === b.aim?.x && a.aim?.y === b.aim?.y)
export const Figure = memo(FigureImpl, (a, b) => a.unit === b.unit && a.selected === b.selected && a.hovered === b.hovered && a.w === b.w && a.h === b.h && a.lite === b.lite && sameStance(a.stance, b.stance))

/** Every figure's stance (mapping.stanceFor): targets from the units on the board, cover from the engine's rules on the full state. */
export function stances(units: readonly Unit[], state: State, groups: readonly { id: string; aware: boolean }[]): Map<string, Stance> {
  const aware = new Set(groups.filter((g) => g.aware).map((g) => g.id))
  const out = new Map<string, Stance>()
  for (const u of units) {
    const st = stanceFor(u, units, aware, (from) => query.coverFrom(state, u.id, from)?.level ?? null)
    if (st.cover) out.set(u.id, st)
  }
  return out
}

export function Figures({ units, w, h, selected, hovered, state, groups }: { units: Unit[]; w: number; h: number; selected: string | null; hovered: string | null; state: State; groups: readonly { id: string; aware: boolean }[] }): React.JSX.Element {
  const lite = useStore((s) => s.settings.lite) // Low quality tier: far and off-screen figures stop animating
  const st = useMemo(() => stances(units, state, groups), [units, state, groups])
  return (
    <group>
      <AnimFrame />
      {units.filter((u) => u.status !== 'escaped' && u.status !== 'safe').map((u) => (
        <Figure key={u.id} unit={u} w={w} h={h} selected={u.id === selected} hovered={u.id === hovered} lite={lite} stance={st.get(u.id)} />
      ))}
    </group>
  )
}

/** Ghost markers: where the squad last saw an enemy that is not in sight now. */
export function Ghosts({ state, fog }: { state: State; fog: State }): React.JSX.Element | null {
  const { w, h } = state.map
  const ghosts = Object.entries(fog.lastSeen.squad)
  const mat = useMemo(() => new MeshBasicMaterial({ color: new Color('#ff8a1f'), transparent: true, opacity: 0.35, wireframe: true }), [])
  useEffect(() => () => mat.dispose(), [mat])
  if (ghosts.length === 0) return null
  return (
    <group>
      {ghosts.map(([id, g]) => (
        <group key={id} position={[tx(g.x, w), 0, tz(g.y, h)]}>
          <mesh position={[0, 0.55, 0]} material={mat} raycast={noRay}><capsuleGeometry args={[0.2, 0.55, 3, 8]} /></mesh>
          <Html position={[0, 1.15, 0]} center style={{ pointerEvents: 'none', userSelect: 'none' }} zIndexRange={[5, 0]}>
            <div className="ghost-tag">LAST SEEN R{g.round}</div>
          </Html>
        </group>
      ))}
    </group>
  )
}

export { callSign }
