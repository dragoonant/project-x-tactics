// Stealth layer (STL, ABL-TKD; owner request "I have no idea how to go quiet"): what a player needs to sneak.
//   - dark tiles (LGT-1) get a cold tint and the edge of every lamp pool a thin amber line: inside the dark you are seen only
//     from 2 tiles (LGT-2), or not at all from behind an unaware enemy (STL-1);
//   - the sight cone of every unaware enemy the squad sees (query.unawareSight): step into it and its group wakes;
//   - an UNAWARE tag over each of those enemies with its group's name.
// Every number comes from the engine (query.isLit, query.unawareSight); nothing here has a pointer handler (rule 25).
import { Html } from '@react-three/drei'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { InstancedMesh, Object3D } from 'three'
import { query } from '../../engine'
import type { State, Unit } from '../../engine'
import { tx, tz } from './layout'

const noRay = (): null => null
const dummy = new Object3D()

function Tiles({ tiles, w, h, color, opacity, y, order }: { tiles: { x: number; y: number }[]; w: number; h: number; color: string; opacity: number; y: number; order: number }): React.JSX.Element {
  const ref = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    tiles.forEach((p, i) => {
      dummy.position.set(tx(p.x, w), y, tz(p.y, h))
      dummy.rotation.set(-Math.PI / 2, 0, 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
    })
    m.count = tiles.length
    m.instanceMatrix.needsUpdate = true
  }, [tiles, w, h, y])
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, Math.max(1, w * h)]} frustumCulled={false} raycast={noRay} renderOrder={order}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
    </instancedMesh>
  )
}

/** Thin strips on tile edges: `edges` are tile + side (0 N, 1 E, 2 S, 3 W). */
function Edges({ edges, w, h, color }: { edges: { x: number; y: number; d: number }[]; w: number; h: number; color: string }): React.JSX.Element {
  const ref = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    edges.forEach((e, i) => {
      const ox = e.d === 1 ? 0.5 : e.d === 3 ? -0.5 : 0
      const oz = e.d === 2 ? 0.5 : e.d === 0 ? -0.5 : 0
      dummy.position.set(tx(e.x, w) + ox, 0.03, tz(e.y, h) + oz)
      dummy.rotation.set(-Math.PI / 2, 0, e.d === 1 || e.d === 3 ? Math.PI / 2 : 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
    })
    m.count = edges.length
    m.instanceMatrix.needsUpdate = true
  }, [edges, w, h])
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, Math.max(1, w * h * 2)]} frustumCulled={false} raycast={noRay} renderOrder={2}>
      <planeGeometry args={[0.96, 0.05]} />
      <meshBasicMaterial color={color} transparent opacity={0.75} depthWrite={false} toneMapped={false} />
    </instancedMesh>
  )
}

const D4 = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }]

/** Dark tiles and lamp-pool edges (LGT-1), from the full state: lamps and light are not hidden information. */
function Darkness({ state }: { state: State }): React.JSX.Element {
  const { w, h } = state.map
  const { dark, edges } = useMemo(() => {
    const floor = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && state.map.tiles[y * w + x]!.k !== 'wall'
    const lit = (x: number, y: number): boolean => query.isLit(state, x, y)
    const dark: { x: number; y: number }[] = []
    const edges: { x: number; y: number; d: number }[] = []
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!floor(x, y)) continue
      if (!lit(x, y)) { dark.push({ x, y }); continue }
      D4.forEach((d, i) => { if (floor(x + d.x, y + d.y) && !lit(x + d.x, y + d.y)) edges.push({ x, y, d: i }) })
    }
    return { dark, edges }
    // light only changes with lamps, spotlights and smoke: the state object is a fine key (it is replaced on every step)
  }, [state, w, h])
  return (
    <group>
      <Tiles tiles={dark} w={w} h={h} color="#0b1c3a" opacity={0.32} y={0.022} order={1} />
      <Edges edges={edges} w={w} h={h} color="#ffb347" />
    </group>
  )
}

/** STL-1/STL-3: the cones of unaware enemies the squad sees, and their UNAWARE tags. */
function Cones({ fog }: { fog: State }): React.JSX.Element | null {
  const { w, h } = fog.map
  const { tiles, units } = useMemo(() => {
    const cones = query.unawareSight(fog)
    const seen = new Set<string>()
    const tiles: { x: number; y: number }[] = []
    for (const c of cones) for (const p of c.tiles) { const k = `${p.x},${p.y}`; if (!seen.has(k)) { seen.add(k); tiles.push(p) } }
    const units = cones.map((c) => fog.units.find((u) => u.id === c.unit)).filter((u): u is Unit => !!u)
    return { tiles, units }
  }, [fog])
  if (units.length === 0) return null
  return (
    <group>
      <Tiles tiles={tiles} w={w} h={h} color="#ff1f4b" opacity={0.24} y={0.026} order={1} />
      {units.map((u) => (
        <Html key={u.id} position={[tx(u.x, w), 1.35, tz(u.y, h)]} center style={{ pointerEvents: 'none', userSelect: 'none' }} zIndexRange={[6, 0]}>
          <div className="stealth-tag" data-testid="unaware-tag">UNAWARE{u.group ? ` · ${u.group.toUpperCase()}` : ''}</div>
        </Html>
      ))}
    </group>
  )
}

export function StealthLayer({ state, fog }: { state: State; fog: State }): React.JSX.Element | null {
  if (state.outcome) return null
  return (
    <group>
      <Darkness state={state} />
      <Cones fog={fog} />
    </group>
  )
}
