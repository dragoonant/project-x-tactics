// The one persistent <Canvas>. It is mounted once at app start and never recreated (no WebGL context per screen). The start
// screen shows the Night Market behind it; a running game or the end screen shows the live state.
// Picking (rule 25): pointer handlers live ONLY on the tile pick surface below; figures, rings, bars and effects have none.
import { Canvas, type ThreeEvent } from '@react-three/fiber'
import { Suspense, use, useEffect, useMemo, useRef } from 'react'
import type { PointLight } from 'three'
import { MAPS } from '../../data'
import { createGame, view } from '../../engine'
import type { State } from '../../engine'
import { onTileTap, setHover } from '../game/controller'
import { focus } from '../game/presentation'
import { boardUnits } from '../game/vision'
import { DEFAULT_SQUAD, useStore } from '../game/store'
import { CameraRig, boardApi } from './CameraRig'
import { gesture } from './camera'
import { FxLayer, Volumes } from './Effects'
import { Figures, Ghosts } from './Figures'
import { tx, tz, worldToTile } from './layout'
import { HoverOverlay, TileMarks, useHoverUnit } from './Overlays'
import { Terrain } from './terrain/Terrain'
import { CityScene } from '../campaign/City'
import { CacheMarker } from './CacheMarker'
import { StealthLayer } from './Stealth'
import { TERRAIN_V2, preloadTerrain } from '../game/terrainAssets'

let preview: { state: State; fog: State } | null = null
function previewGame(): { state: State; fog: State } {
  if (!preview) { const state = createGame({ mapId: 'bust-01', squad: DEFAULT_SQUAD, seed: 1 }); preview = { state, fog: view(state, 'squad') } }
  return preview
}

function Lights({ state, lamps, refs }: { state: State; lamps: { x: number; y: number }[]; refs: React.MutableRefObject<(PointLight | null)[]> }): React.JSX.Element {
  const { w, h } = state.map
  return (
    <>
      <ambientLight color="#7686b8" intensity={0.55} />
      <hemisphereLight args={['#5a6aa0', '#1d1812', 0.55]} />
      <directionalLight color="#a9b8ff" intensity={0.55} position={[-8, 16, 7]} />
      {lamps.map((l, i) => (
        <pointLight key={i} ref={(el) => { refs.current[i] = el }} color="#ff9a40" intensity={26} distance={10} decay={2} position={[tx(l.x, w), 2.15, tz(l.y, h)]} />
      ))}
    </>
  )
}

function PickSurface({ w, h }: { w: number; h: number }): React.JSX.Element {
  const down = useRef<{ x: number; y: number } | null>(null)
  const tile = (e: ThreeEvent<PointerEvent>): { x: number; y: number } | null => {
    const t = worldToTile(e.point.x, e.point.z, w, h)
    return t.x >= 0 && t.y >= 0 && t.x < w && t.y < h ? t : null
  }
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0.001, 0]}
      onPointerMove={(e) => {
        if (e.nativeEvent.pointerType !== 'mouse') return
        const t = tile(e)
        setHover(t)
        focus.hover = t
      }}
      onPointerDown={(e) => { down.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY } }}
      onPointerUp={(e) => {
        const d = down.current
        down.current = null
        if (!d || e.nativeEvent.button !== 0 || gesture.dragged) return
        if (Math.hypot(e.nativeEvent.clientX - d.x, e.nativeEvent.clientY - d.y) >= 8) return
        const t = tile(e)
        if (t) void onTileTap(t, e.nativeEvent.pointerType)
      }}
    >
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  )
}

/** Terrain v2 suspends until its assets are loaded (null fallback, rule 26); with the flag off this is a plain Terrain. */
function TerrainGate(props: { state: State; fogOn: boolean; lamps: { x: number; y: number }[]; lights: React.MutableRefObject<(PointLight | null)[]> }): React.JSX.Element {
  const assets = TERRAIN_V2 ? use(preloadTerrain()) : null
  return <Terrain {...props} assets={assets} />
}

function Scene({ state, fog, fogOn }: { state: State; fog: State; fogOn: boolean }): React.JSX.Element {
  const { w, h } = state.map
  const selected = useStore((s) => s.selected)
  const hu = useHoverUnit()
  const lamps = useMemo(() => MAPS[state.map.id]?.lamps ?? [], [state.map.id])
  const lights = useRef<(PointLight | null)[]>([])
  useEffect(() => {
    const u = selected ? state.units.find((x) => x.id === selected) : null
    focus.sel = u ? { x: u.x, y: u.y } : null
    focus.units = fog.units.filter((x) => x.status !== 'dead' && x.side !== 'civilians').map((x) => ({ x: x.x, y: x.y }))
  }, [selected, state, fog])
  const hoverId = hu?.id ?? null
  const bodies = useStore((s) => s.bodies)
  const units = useMemo(() => boardUnits(state, fog, bodies), [state, fog, bodies])
  return (
    <Suspense fallback={null}>
      <CameraRig w={w} h={h} />
      <Lights state={state} lamps={lamps} refs={lights} />
      <Suspense fallback={null}><TerrainGate state={state} fogOn={fogOn} lamps={lamps} lights={lights} /></Suspense>
      <Figures units={units} w={w} h={h} selected={selected} hovered={hoverId} state={state} groups={fog.groups} />
      <Ghosts state={state} fog={fog} />
      {fogOn && <StealthLayer state={state} fog={fog} />}
      {fogOn && <TileMarks state={state} />}
      {fogOn && <HoverOverlay state={state} />}
      <Volumes state={state} />
      <CacheMarker state={state} />
      <FxLayer w={w} h={h} />
      <PickSurface w={w} h={h} />
    </Suspense>
  )
}

export function Board(): React.JSX.Element {
  const st = useStore((s) => s.state)
  const fg = useStore((s) => s.fog)
  const screen = useStore((s) => s.screen)
  const lite = useStore((s) => s.settings.lite)
  const campaign = useStore((s) => s.campaign)
  const city = screen === 'city' || screen === 'cend'
  const pv = previewGame()
  const state = st ?? pv.state
  const fog = fg ?? pv.fog
  const phone = typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 600

  useEffect(() => { boardApi.controller?.reset() }, [screen === 'play' ? state.setup.seed : -1, screen === 'start'])
  useEffect(() => {
    const el = document.querySelector('.board-wrap canvas')
    const leave = (e: Event): void => { if ((e as PointerEvent).pointerType !== 'mouse') return; setHover(null); focus.hover = null }
    el?.addEventListener('pointerleave', leave)
    return () => el?.removeEventListener('pointerleave', leave)
  }, [])

  return (
    <div className={`board-wrap${screen === 'start' ? ' dim' : ''}${city ? ' city' : ''}`}>
      <Canvas
        frameloop="demand"
        dpr={lite || phone ? 1 : [1, 1.75]}
        gl={{ antialias: !phone, powerPreference: 'high-performance', alpha: false, stencil: false }}
        camera={{ fov: 38, near: 0.5, far: 400, position: [0, 24, 24] }}
        onCreated={({ gl }) => { gl.setClearColor('#05070a'); (window as unknown as { __pxGl?: unknown }).__pxGl = gl }}
      >
        <fogExp2 attach="fog" args={['#06080c', 0.011]} />
        {city && campaign ? <CityScene state={campaign} /> : <Scene state={state} fog={fog} fogOn={screen !== 'start'} />}
      </Canvas>
    </div>
  )
}
