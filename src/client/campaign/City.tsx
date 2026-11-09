// The holo-table city map, drawn in the same persistent <Canvas> as the tactical board. Six district plates with procedural
// skylines, Order pips, incident markers and an optional emblem; the strategy table texture if the manifest has one.
// Picking (rule 25): one invisible plane over the table carries the only pointer handlers; plates, markers and labels have none.
// Every number shown comes from campaignQuery (CMP-4).
import { Html } from '@react-three/drei'
import { useFrame, useLoader, useThree, type ThreeEvent } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { BoxGeometry, CylinderGeometry, EdgesGeometry, type Group, type PerspectiveCamera, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector3 } from 'three'
import { campaignQuery, type CampaignState, type DistrictInfo, type Incident } from '../../campaign'
import { useStore } from '../game/store'
import { useStrategyAssets } from './assets'
import { selectIncident } from './controller'
import { CELL_D, CELL_W, TABLE_D, TABLE_W, blocksFor, districtCenter, pickDistrict } from './layout'

const ORDER_COLORS = ['#ff3a2a', '#ff6a2a', '#ffb000', '#e8d860', '#7dff9a', '#3dff8a']
export function orderColor(d: Pick<DistrictInfo, 'order' | 'fallen'>): string { return d.fallen ? '#ff2a1a' : ORDER_COLORS[Math.max(0, Math.min(5, d.order))]! }
export function incidentColor(i: Pick<Incident, 'kind' | 'role'>): string {
  return i.role === 'kingpin' ? '#ff3df0' : i.role === 'retake' ? '#ff4a3a' : i.kind === 'raid' ? '#59a8ff' : '#ffb000'
}

const box = new BoxGeometry(1, 1, 1)
const boxEdges = new EdgesGeometry(box)
const cyl = new CylinderGeometry(0.5, 0.5, 1, 10)
const cylEdges = new EdgesGeometry(cyl)

function CityCamera(): null {
  const { camera, size, invalidate } = useThree()
  useEffect(() => {
    const cam = camera as PerspectiveCamera
    const aspect = size.width / Math.max(1, size.height)
    const phone = size.width < 700
    const portrait = aspect < 1
    const vfov = (cam.fov * Math.PI) / 180
    // desktop: the brief panel covers the left ~30%, so the table is fitted into (and centred on) the rest of the screen
    const side = !phone && !portrait ? 0.7 : 1
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect * side)
    const needW = portrait ? CELL_W * 3 + 3 : TABLE_W + 2
    const needD = TABLE_D + 9
    const dist = portrait ? (needW / 2) / Math.tan(hfov / 2) : Math.max((needW / 2) / Math.tan(hfov / 2), (needD / 2) / Math.tan(vfov / 2))
    const tilt = portrait ? 1.08 : 0.95 // radians above the horizon
    cam.position.set(0, Math.sin(tilt) * dist, Math.cos(tilt) * dist + 1)
    cam.lookAt(0, 0, 1)
    // the phone's bottom sheet covers the lower screen: draw the table in the upper part
    if (phone && portrait) cam.setViewOffset(size.width, size.height, 0, size.height * 0.07, size.width, size.height)
    else if (side < 1) cam.setViewOffset(size.width, size.height, -size.width * (1 - side) / 2, -size.height * 0.02, size.width, size.height)
    else cam.clearViewOffset()
    cam.updateProjectionMatrix()
    invalidate()
    return () => { cam.clearViewOffset(); cam.updateProjectionMatrix() }
  }, [camera, size.width, size.height, invalidate])
  return null
}

/** Test and review access: the screen point (CSS px) of a table point, while the city is shown. */
export const cityApi = { project: null as null | ((x: number, y: number, z: number) => { x: number; y: number }) }

function Animator({ group }: { group: React.RefObject<Group | null> }): null {
  const lite = useStore((s) => s.settings.lite)
  const { camera, gl } = useThree()
  useEffect(() => {
    cityApi.project = (x, y, z) => {
      const v = new Vector3(x, y, z)
      group.current?.localToWorld(v)
      v.project(camera)
      const r = gl.domElement.getBoundingClientRect()
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }
    }
    return () => { cityApi.project = null }
  }, [camera, gl, group])
  useFrame((state) => {
    if (lite) return
    const t = state.clock.elapsedTime
    const g = group.current
    if (g) {
      g.rotation.y = Math.sin(t * 0.12) * 0.04
      g.traverse((o) => { if (o.userData.bob !== undefined) { o.position.y = o.userData.baseY + Math.sin(t * 2 + o.userData.bob) * 0.18; o.rotation.y = t * 1.3 + o.userData.bob } })
    }
    state.invalidate()
  })
  return null
}

function TableTexture({ url }: { url: string }): React.JSX.Element {
  const tex = useLoader(TextureLoader, url)
  useMemo(() => { tex.colorSpace = SRGBColorSpace; tex.wrapS = tex.wrapT = RepeatWrapping; tex.repeat.set(2, 1.3) }, [tex])
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
      <planeGeometry args={[TABLE_W + 3, TABLE_D + 3]} />
      <meshBasicMaterial map={tex} transparent opacity={0.55} depthWrite={false} />
    </mesh>
  )
}

function Emblem({ url, x, z }: { url: string; x: number; z: number }): React.JSX.Element {
  const tex = useLoader(TextureLoader, url)
  useMemo(() => { tex.colorSpace = SRGBColorSpace }, [tex])
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.06, z]}>
      <planeGeometry args={[1.5, 1.5]} />
      <meshBasicMaterial map={tex} transparent opacity={0.9} depthWrite={false} />
    </mesh>
  )
}

function DistrictPlate({ d, i, incidents, selected, emblem }: { d: DistrictInfo; i: number; incidents: Incident[]; selected: string | null; emblem: string | null }): React.JSX.Element {
  const c = districtCenter(i)
  const blocks = useMemo(() => blocksFor(d.id), [d.id])
  const col = orderColor(d)
  const holo = d.fallen ? '#ff5040' : '#3fe0d0'
  const hot = incidents.some((x) => x.id === selected)
  return (
    <group position={[c.x, 0, c.z]}>
      {/* plate */}
      <mesh position={[0, 0.03, 0]}>
        <boxGeometry args={[CELL_W, 0.06, CELL_D]} />
        <meshBasicMaterial color={col} transparent opacity={hot ? 0.3 : 0.14} depthWrite={false} />
      </mesh>
      <lineSegments position={[0, 0.03, 0]} scale={[CELL_W, 0.06, CELL_D]} geometry={boxEdges}>
        <lineBasicMaterial color={hot ? '#ffffff' : col} transparent opacity={hot ? 1 : 0.8} />
      </lineSegments>
      {/* skyline */}
      {blocks.map((b, k) => (
        <group key={k} position={[b.x, b.h / 2 + 0.06, b.z]} scale={[b.w, b.h, b.d]}>
          <mesh geometry={b.round ? cyl : box}>
            <meshBasicMaterial color={holo} transparent opacity={d.fallen ? 0.22 : 0.13} depthWrite={false} />
          </mesh>
          <lineSegments geometry={b.round ? cylEdges : boxEdges}>
            <lineBasicMaterial color={holo} transparent opacity={0.75} />
          </lineSegments>
        </group>
      ))}
      {/* Order pips along the front edge */}
      {Array.from({ length: d.max }, (_, k) => (
        <mesh key={k} position={[-CELL_W / 2 + 0.6 + k * 0.62, 0.14, CELL_D / 2 - 0.45]}>
          <boxGeometry args={[0.46, 0.16, 0.28]} />
          <meshBasicMaterial color={k < d.order ? col : '#1b2420'} />
        </mesh>
      ))}
      {emblem && <Suspense fallback={null}><Emblem url={emblem} x={CELL_W / 2 - 1.05} z={CELL_D / 2 - 1.05} /></Suspense>}
      {/* incident markers */}
      {incidents.map((inc, k) => {
        const mx = (k - (incidents.length - 1) / 2) * 1.4
        const color = incidentColor(inc)
        const big = inc.id === selected
        return (
          <group key={inc.id} position={[mx, 0, -0.4]}>
            <mesh position={[0, 2.2, 0]} scale={[0.05, 4.2, 0.05]} geometry={cyl}>
              <meshBasicMaterial color={color} transparent opacity={0.45} depthWrite={false} />
            </mesh>
            <mesh position={[0, 4.6, 0]} userData={{ bob: i * 1.7 + k, baseY: 4.6 }} scale={big ? 0.8 : 0.55}>
              <octahedronGeometry args={[1, 0]} />
              <meshBasicMaterial color={color} wireframe={!big} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}>
              <ringGeometry args={[0.55, big ? 0.9 : 0.72, 24]} />
              <meshBasicMaterial color={color} transparent opacity={0.8} depthWrite={false} />
            </mesh>
          </group>
        )
      })}
      <Html position={[0, 0.1, CELL_D / 2 + 0.15]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`dlabel${d.fallen ? ' fallen' : ''}${hot ? ' hot' : ''}`} data-district={d.id}>
          <b>{d.name.toUpperCase()}</b>
          <span>{d.fallen ? 'FALLEN' : `ORDER ${d.order}/${d.max}`}</span>
        </div>
      </Html>
    </group>
  )
}

function PickPlane({ state, group }: { state: CampaignState; group: React.RefObject<Group | null> }): React.JSX.Element {
  const down = useRef<{ x: number; y: number } | null>(null)
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0.01, 0]}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => { down.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY } }}
      onPointerUp={(e: ThreeEvent<PointerEvent>) => {
        const d = down.current
        down.current = null
        if (!d || e.nativeEvent.button !== 0 || Math.hypot(e.nativeEvent.clientX - d.x, e.nativeEvent.clientY - d.y) >= 8) return
        const p = group.current ? group.current.worldToLocal(e.point.clone()) : e.point
        const k = pickDistrict(p.x, p.z, state.districts.length)
        if (k === null) return
        const id = state.districts[k]!.id
        const open = state.incidents.filter((x) => x.district === id && x.result === null)
        const cur = useStore.getState().cincident
        const at = open.findIndex((x) => x.id === cur)
        selectIncident(open.length ? open[(at + 1) % open.length]!.id : null)
      }}
    >
      <planeGeometry args={[TABLE_W + 3, TABLE_D + 3]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  )
}

export function CityScene({ state }: { state: CampaignState }): React.JSX.Element {
  const group = useRef<Group>(null)
  const selected = useStore((s) => s.cincident)
  const assets = useStrategyAssets()
  const districts = campaignQuery.districts(state)
  const open = state.incidents.filter((i) => i.result === null)
  return (
    <>
      <CityCamera />
      <Animator group={group} />
      <ambientLight intensity={0.6} />
      <group ref={group}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
          <planeGeometry args={[TABLE_W + 3, TABLE_D + 3]} />
          <meshBasicMaterial color="#071512" />
        </mesh>
        {assets.table ? <Suspense fallback={null}><TableTexture url={assets.table} /></Suspense> : <gridHelper args={[TABLE_W + 3, 30, '#1d5a52', '#123430']} position={[0, 0.005, 0]} />}
        <lineSegments position={[0, 0, 0]} scale={[TABLE_W + 3, 0.02, TABLE_D + 3]} geometry={boxEdges}>
          <lineBasicMaterial color="#3fe0d0" transparent opacity={0.6} />
        </lineSegments>
        {districts.map((d, i) => (
          <DistrictPlate key={d.id} d={d} i={i} incidents={open.filter((x) => x.district === d.id)} selected={selected} emblem={assets.emblems[d.id] ?? null} />
        ))}
        <PickPlane state={state} group={group} />
      </group>
    </>
  )
}
