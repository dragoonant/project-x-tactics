// Figure lab (A0 spike): a turntable stage for the rigged Enforcer. Rig selector, clip buttons, speed, weapon on the hand socket,
// ground grid at tile scale (the board's tile is 1 world unit, see src/client/board/layout.ts).
// Deterministic frames for review media: ?rig=a&clip=walk&t=0.5&view=tq&ui=0 (t in seconds; with t the clock is frozen).
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { StrictMode, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AnimationMixer, Group, LoopRepeat, Object3D, type AnimationClip, type PerspectiveCamera } from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

// Rule 24: no text selection, callouts or context menus on a long press, except in editable fields.
const editable = (t: EventTarget | null): boolean => t instanceof HTMLElement && /^(input|textarea|select)$/i.test(t.tagName) || (t instanceof HTMLElement && t.isContentEditable)
document.addEventListener('selectstart', (e) => { if (!editable(e.target)) e.preventDefault() })
document.addEventListener('contextmenu', (e) => { if (!editable(e.target)) e.preventDefault() })

const BASE = import.meta.env.BASE_URL + 'assets/anim/'
const TILE = 1

type Hand = { bone: string; matrix: number[][] }
type RigMeta = {
  file: string
  label: string
  rightHand: Hand
  leftHand: { bone: string; weaponLocalGrip: number[] }
  clips: Record<string, { duration: number; speed?: number }>
}
type Sockets = { weapon: string; rigs: Record<string, RigMeta> }

const params = new URLSearchParams(location.search)
const num = (k: string): number | null => { const v = params.get(k); return v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v) }

export const labApi = {
  ready: false,
  time: 0,
  frozen: num('t') !== null,
  setTime: (_t: number): void => { /* set by the stage */ },
  clips: [] as string[],
}
;(window as unknown as { __lab: typeof labApi }).__lab = labApi

function Stage({ sockets, rig, clip, speed, playing, weapon, spin, scale, view }: {
  sockets: Sockets; rig: string; clip: string; speed: number; playing: boolean; weapon: boolean; spin: boolean; scale: number; view: string
}): React.JSX.Element {
  const meta = sockets.rigs[rig]!
  const gltf = useGLTF(BASE + meta.file)
  const gun = useGLTF(BASE + sockets.weapon)
  const { camera, invalidate } = useThree()
  const root = useMemo(() => cloneSkinned(gltf.scene) as Group, [gltf.scene])
  const mixer = useMemo(() => new AnimationMixer(root), [root])
  const figure = useRef<Group>(null)
  const grid = useRef<Group>(null)
  const clock = useRef(num('t') ?? 0)
  const clipObj = useMemo<AnimationClip | undefined>(() => gltf.animations.find((a) => a.name === clip), [gltf.animations, clip])

  useEffect(() => {
    labApi.clips = gltf.animations.map((a) => a.name)
    labApi.ready = true
    return () => { labApi.ready = false }
  }, [gltf.animations])

  // weapon on the right-hand bone through the socket matrix
  useEffect(() => {
    const bone = root.getObjectByName(meta.rightHand.bone)
    if (!bone) return
    const holder = new Object3D()
    holder.matrixAutoUpdate = false
    holder.matrix.set(...(meta.rightHand.matrix.flat() as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]))
    holder.matrixWorldNeedsUpdate = true
    const g = cloneSkinned(gun.scene) as Group
    holder.add(g)
    holder.visible = weapon
    bone.add(holder)
    return () => { bone.remove(holder) }
  }, [root, gun.scene, meta, weapon])

  useEffect(() => {
    mixer.stopAllAction()
    if (!clipObj) return
    const a = mixer.clipAction(clipObj)
    a.setLoop(LoopRepeat, Infinity)
    a.play()
    mixer.setTime(clock.current)
  }, [mixer, clipObj])

  useEffect(() => {
    labApi.setTime = (t: number) => { clock.current = t; labApi.time = t; mixer.setTime(t); invalidate() }
  }, [mixer, invalidate])

  useEffect(() => {
    const cam = camera as PerspectiveCamera
    const s = scale
    const h = 1.8 * s
    const pos = view === 'front' ? [0, h * 0.55, 5.4] : view === 'side' ? [5.4, h * 0.55, 0] : view === 'high' ? [2.2, 4.6, 3.6] : [3.2, h * 0.8 + 0.5, 4.4]
    cam.position.set(pos[0]!, pos[1]!, pos[2]!)
    cam.lookAt(0, h * 0.5, 0)
    cam.fov = 32
    cam.updateProjectionMatrix()
  }, [camera, view, scale])

  useFrame((_, dt) => {
    if (!labApi.frozen && playing) {
      clock.current += dt * speed
      labApi.time = clock.current
      mixer.setTime(clock.current)
    }
    const t = labApi.time
    if (figure.current) figure.current.rotation.y = spin && !labApi.frozen ? t * 0.5 : 0
    // walk treadmill: the ground moves back at the clip's stride speed so planted feet stay planted
    const v = (meta.clips[clip]?.speed ?? 0) * scale
    if (grid.current) grid.current.position.z = -((v * t) % TILE)
  })

  return (
    <>
      <group ref={grid}>
        <gridHelper args={[24, 24 / TILE, '#3a4a44', '#1f2926']} position={[0, 0, 0]} />
      </group>
      <group ref={figure} scale={scale}>
        <primitive object={root} />
      </group>
    </>
  )
}

function Lab(): React.JSX.Element {
  const [sockets, setSockets] = useState<Sockets | null>(null)
  const [err, setErr] = useState('')
  const [rig, setRig] = useState(params.get('rig') ?? 'a')
  const [clip, setClip] = useState(params.get('clip') ?? 'idle')
  const [speed, setSpeed] = useState(num('speed') ?? 1)
  const [playing, setPlaying] = useState(true)
  const [weapon, setWeapon] = useState(params.get('weapon') !== '0')
  const [spin, setSpin] = useState(params.get('spin') === '1')
  const [scale, setScale] = useState(num('scale') ?? 0.6)
  const view = params.get('view') ?? 'tq'
  const showUi = params.get('ui') !== '0'

  useEffect(() => {
    fetch(BASE + 'sockets.json').then((r) => r.json()).then((j: Sockets) => { setSockets(j); if (!j.rigs[rig]) setRig(Object.keys(j.rigs)[0] ?? 'a') }).catch((e: unknown) => setErr(String(e)))
  }, [])

  if (err) return <div style={{ padding: 16 }}>Could not load sockets.json: {err}</div>
  if (!sockets) return <div style={{ padding: 16 }}>Loading</div>
  const meta = sockets.rigs[rig]
  const clipNames = meta ? Object.keys(meta.clips) : []
  return (
    <>
      <Canvas gl={{ antialias: true, preserveDrawingBuffer: true }} dpr={1} style={{ position: 'absolute', inset: 0 }} camera={{ fov: 32, near: 0.1, far: 100 }} onCreated={({ gl }) => gl.setClearColor('#0b0f11')} frameloop="always">
        <hemisphereLight args={['#bcd2ff', '#2a2320', 0.9]} />
        <directionalLight position={[3, 6, 4]} intensity={2.2} />
        <directionalLight position={[-4, 3, -2]} intensity={0.8} color="#ffb870" />
        <Suspense fallback={null}>{meta && <Stage sockets={sockets} rig={rig} clip={clip} speed={speed} playing={playing} weapon={weapon} spin={spin} scale={scale} view={view} />}</Suspense>
      </Canvas>
      {showUi && (
        <div style={{ position: 'absolute', left: 12, top: 12, display: 'grid', gap: 8, background: 'rgba(9,12,14,0.82)', border: '1px solid #2a3330', padding: 10, borderRadius: 6, maxWidth: 'calc(100vw - 48px)' }}>
          <div style={{ fontWeight: 600 }}>Figure lab: Enforcer</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(sockets.rigs).map(([k, r]) => (
              <button key={k} aria-pressed={rig === k} onClick={() => setRig(k)} style={btn(rig === k)}>{r.label}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {clipNames.map((c) => (<button key={c} aria-pressed={clip === c} onClick={() => setClip(c)} style={btn(clip === c)}>{c}</button>))}
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>Speed {speed.toFixed(2)}
            <input type="range" min={0.1} max={2} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>Scale {scale.toFixed(2)}
            <input type="range" min={0.3} max={1.2} step={0.05} value={scale} onChange={(e) => setScale(Number(e.target.value))} />
          </label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={() => setPlaying((p) => !p)} style={btn(false)}>{playing ? 'Pause' : 'Play'}</button>
            <button aria-pressed={weapon} onClick={() => setWeapon((w) => !w)} style={btn(weapon)}>Weapon</button>
            <button aria-pressed={spin} onClick={() => setSpin((s) => !s)} style={btn(spin)}>Turntable</button>
          </div>
        </div>
      )}
    </>
  )
}

const btn = (on: boolean): React.CSSProperties => ({ background: on ? '#27463a' : '#141b19', color: '#cfd8d4', border: '1px solid #2a3330', borderRadius: 4, padding: '4px 10px', cursor: 'pointer' })

createRoot(document.getElementById('root')!).render(<StrictMode><Lab /></StrictMode>)
