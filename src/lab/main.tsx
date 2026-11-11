// Figure lab (A1): a stage for the rigged figures of public/assets/anim/manifest.json (spec 30). Figure and clip selectors, items on
// their bones through the manifest matrices, ground grid at tile scale (the board's tile is 1 world unit), a treadmill grid for
// walk and run at the manifest speed, and an overview of every figure.
// Deterministic frames for review media: ?fig=recruit&clip=walk&t=0.5&view=tq&ui=0&scale=1 (t in seconds; with t the clock is frozen).
// ?all=1&clip=idle&t=0 shows every figure in a row.
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { StrictMode, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AnimationMixer, Group, LoopOnce, LoopRepeat, Object3D, type AnimationClip, type PerspectiveCamera } from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { fixIdlePose } from '../client/anim/posefix'

// Rule 24: no text selection, callouts or context menus on a long press, except in editable fields.
const editable = (t: EventTarget | null): boolean => t instanceof HTMLElement && /^(input|textarea|select)$/i.test(t.tagName) || (t instanceof HTMLElement && t.isContentEditable)
document.addEventListener('selectstart', (e) => { if (!editable(e.target)) e.preventDefault() })
document.addEventListener('contextmenu', (e) => { if (!editable(e.target)) e.preventDefault() })

const BASE = import.meta.env.BASE_URL + 'assets/anim/'
const TILE = 1

type Attachment = { id: string; bone: string; matrix: number[]; muzzle: number[] }
type FigureMeta = { file: string; height: number; clips: Record<string, { duration: number; loop: boolean; speed?: number }>; attachments: Attachment[] }
type Manifest = { version: number; skeleton: string; figures: Record<string, FigureMeta>; items: Record<string, { file: string }> }

const params = new URLSearchParams(location.search)
const num = (k: string): number | null => { const v = params.get(k); return v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v) }
const FALLBACK: Record<string, string> = { run: 'walk', cover: 'idle', panic: 'run', cower: 'idle' }
// items that would not be held in these clips (a surrendering unit does not keep a rifle raised): hidden in the lab, the client may do the same
const NO_ITEMS = new Set(['surrender', 'cuffed', 'downed', 'cower'])

export const labApi = {
  ready: false,
  time: 0,
  frozen: num('t') !== null,
  setTime: (_t: number): void => { /* set by the stage */ },
  clips: [] as string[],
}
;(window as unknown as { __lab: typeof labApi }).__lab = labApi

function Item({ bone, att, file, visible }: { bone: Object3D; att: Attachment; file: string; visible: boolean }): null {
  const gltf = useGLTF(BASE + file)
  useEffect(() => {
    const holder = new Object3D()
    holder.matrixAutoUpdate = false
    holder.matrix.fromArray(att.matrix).transpose()   // manifest is row-major
    holder.matrixWorldNeedsUpdate = true
    holder.add(cloneSkinned(gltf.scene) as Group)
    holder.visible = visible
    bone.add(holder)
    return () => { bone.remove(holder) }
  }, [bone, att, gltf.scene, visible])
  return null
}

function Figure({ man, kind, clip, speed, playing, items, spin, scale, x, treadmill }: {
  man: Manifest; kind: string; clip: string; speed: number; playing: boolean; items: boolean; spin: boolean; scale: number; x: number; treadmill: Group | null
}): React.JSX.Element {
  const meta = man.figures[kind]!
  const gltf = useGLTF(BASE + meta.file)
  // the same load-time idle correction the game applies (src/client/anim/posefix.ts); ?posefix=0 shows the raw bake
  useMemo(() => { if (params.get('posefix') !== '0') fixIdlePose(kind, gltf.scene, gltf.animations) }, [kind, gltf])
  const { invalidate } = useThree()
  const root = useMemo(() => cloneSkinned(gltf.scene) as Group, [gltf.scene])
  const mixer = useMemo(() => new AnimationMixer(root), [root])
  const figure = useRef<Group>(null)
  const clock = useRef(num('t') ?? 0)
  const has = (c: string): boolean => !!meta.clips[c] || gltf.animations.some((a) => a.name === c) // coverHigh is built at load (posefix)
  const clipName = has(clip) ? clip : (FALLBACK[clip] && has(FALLBACK[clip]!) ? FALLBACK[clip]! : 'idle')
  const clipObj = useMemo<AnimationClip | undefined>(() => gltf.animations.find((a) => a.name === clipName), [gltf.animations, clipName])
  const bones = useMemo(() => meta.attachments.map((a) => root.getObjectByName(a.bone) ?? null), [root, meta])

  useEffect(() => {
    labApi.clips = gltf.animations.map((a) => a.name)
    labApi.ready = true
    return () => { labApi.ready = false }
  }, [gltf.animations])

  useEffect(() => {
    mixer.stopAllAction()
    if (!clipObj) return
    const a = mixer.clipAction(clipObj)
    const loop = meta.clips[clipName]?.loop ?? true
    a.setLoop(loop ? LoopRepeat : LoopOnce, Infinity)
    a.clampWhenFinished = true
    a.play()
    mixer.setTime(clock.current)
  }, [mixer, clipObj, meta, clipName])

  useEffect(() => {
    labApi.setTime = (t: number) => { clock.current = t; labApi.time = t; mixer.setTime(t); invalidate() }
  }, [mixer, invalidate])

  useFrame((_, dt) => {
    const dur = meta.clips[clipName]?.duration ?? clipObj?.duration ?? 1
    if (!labApi.frozen && playing) {
      clock.current += dt * speed
      labApi.time = clock.current
      mixer.setTime(meta.clips[clipName]?.loop ?? true ? clock.current : Math.min(clock.current % (dur + 1), dur))
    }
    const t = labApi.time
    if (figure.current) figure.current.rotation.y = spin && !labApi.frozen ? t * 0.5 : 0
    const v = (meta.clips[clipName]?.speed ?? 0) * scale
    if (treadmill) treadmill.position.z = -((v * t) % TILE)
  })

  const hidden = NO_ITEMS.has(clipName)
  const swapId = meta.attachments.find((a) => a.id === 'maul' || (a.id === 'baton' && a.bone === 'hand_r'))?.id
  return (
    <group ref={figure} scale={scale} position={[x, 0, 0]}>
      <primitive object={root} />
      {meta.attachments.map((a, i) => {
        const b = bones[i]
        const file = man.items[a.id]?.file
        if (!b || !file) return null
        const isSwap = a.id === swapId && a.id === 'maul'
        const melee = clipName === 'melee' || clipName === 'bash'
        const visible = items && !hidden && (isSwap ? melee : !(melee && meta.attachments.some((o) => o.id === 'maul') && a.bone === 'hand_r'))
        return <Item key={a.id} bone={b} att={a} file={file} visible={visible} />
      })}
    </group>
  )
}

function Cam({ view, scale, span }: { view: string; scale: number; span: number }): null {
  const { camera } = useThree()
  useEffect(() => {
    const cam = camera as PerspectiveCamera
    const h = 1.8 * scale
    const d = span > 1 ? span * 1.05 : (num('dist') ?? 5.4)
    const pos = view === 'front' ? [0, h * 0.55, d] : view === 'side' ? [d, h * 0.55, 0] : view === 'high' ? [2.2, 4.6, 3.6] : [d * 0.6, h * 0.8 + 0.5, d * 0.8]
    cam.position.set(pos[0]!, pos[1]!, pos[2]!)
    cam.lookAt(0, h * 0.5, 0)
    cam.fov = 32
    cam.updateProjectionMatrix()
  }, [camera, view, scale, span])
  return null
}

function Lab(): React.JSX.Element {
  const [man, setMan] = useState<Manifest | null>(null)
  const [err, setErr] = useState('')
  const [kind, setKind] = useState(params.get('fig') ?? 'recruit')
  const [clip, setClip] = useState(params.get('clip') ?? 'idle')
  const [speed, setSpeed] = useState(num('speed') ?? 1)
  const [playing, setPlaying] = useState(true)
  const [items, setItems] = useState(params.get('items') !== '0')
  const [spin, setSpin] = useState(params.get('spin') === '1')
  const [scale, setScale] = useState(num('scale') ?? 0.6)
  const [grid, setGrid] = useState<Group | null>(null)
  const view = params.get('view') ?? 'tq'
  const showUi = params.get('ui') !== '0'
  const all = params.get('all') === '1'

  useEffect(() => {
    fetch(BASE + 'manifest.json').then((r) => r.json()).then((j: Manifest) => { setMan(j); if (!j.figures[kind]) setKind(Object.keys(j.figures)[0] ?? 'recruit') }).catch((e: unknown) => setErr(String(e)))
  }, [])

  if (err) return <div style={{ padding: 16 }}>Could not load manifest.json: {err}</div>
  if (!man) return <div style={{ padding: 16 }}>Loading</div>
  const meta = man.figures[kind]
  const kinds = Object.keys(man.figures)
  const clipNames = meta ? Object.keys(meta.clips) : []
  const spacing = 1.7 * scale / 0.6 * 0.6
  return (
    <>
      <Canvas gl={{ antialias: true, preserveDrawingBuffer: true }} dpr={1} style={{ position: 'absolute', inset: 0 }} camera={{ fov: 32, near: 0.1, far: 100 }} onCreated={({ gl }) => gl.setClearColor(params.get('bg') ?? '#0b0f11')} frameloop="always">
        <hemisphereLight args={['#bcd2ff', '#2a2320', 0.9]} />
        <directionalLight position={[3, 6, 4]} intensity={2.2} />
        <directionalLight position={[-4, 3, -2]} intensity={0.8} color="#ffb870" />
        <Cam view={all ? 'front' : view} scale={scale} span={all ? kinds.length * spacing * 0.5 : 1} />
        <group ref={setGrid}><gridHelper args={[all ? 40 : 24, (all ? 40 : 24) / TILE, '#3a4a44', '#1f2926']} /></group>
        <Suspense fallback={null}>
          {all
            ? kinds.map((k, i) => <Figure key={k} man={man} kind={k} clip={clip} speed={speed} playing={playing} items={items} spin={false} scale={scale} x={(i - (kinds.length - 1) / 2) * spacing} treadmill={null} />)
            : meta && <Figure man={man} kind={kind} clip={clip} speed={speed} playing={playing} items={items} spin={spin} scale={scale} x={0} treadmill={grid} />}
        </Suspense>
      </Canvas>
      {showUi && (
        <div style={{ position: 'absolute', left: 12, top: 12, display: 'grid', gap: 8, background: 'rgba(9,12,14,0.82)', border: '1px solid #2a3330', padding: 10, borderRadius: 6, maxWidth: 'calc(100vw - 48px)' }}>
          <div style={{ fontWeight: 600 }}>Figure lab: {kind}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {kinds.map((k) => (<button key={k} aria-pressed={kind === k} onClick={() => setKind(k)} style={btn(kind === k)}>{k}</button>))}
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
            <button aria-pressed={items} onClick={() => setItems((w) => !w)} style={btn(items)}>Items</button>
            <button aria-pressed={spin} onClick={() => setSpin((s) => !s)} style={btn(spin)}>Turntable</button>
          </div>
        </div>
      )}
    </>
  )
}

const btn = (on: boolean): React.CSSProperties => ({ background: on ? '#27463a' : '#141b19', color: '#cfd8d4', border: '1px solid #2a3330', borderRadius: 4, padding: '4px 10px', cursor: 'pointer' })

createRoot(document.getElementById('root')!).render(<StrictMode><Lab /></StrictMode>)
