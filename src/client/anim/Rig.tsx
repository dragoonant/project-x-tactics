// One rigged figure: a SkeletonUtils clone of the loaded skinned scene (materials and geometry shared between clones), its own
// AnimationMixer, attachments parented to their bones with the manifest matrix, a muzzle flash, and the per-frame clip choice.
// No pointer handlers and every mesh is raycast-proof (rule 25): taps resolve by tile.
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { AdditiveBlending, AnimationMixer, Frustum, Group, LoopOnce, LoopRepeat, Matrix4, Mesh, MeshBasicMaterial, Object3D, SphereGeometry, Vector3, type AnimationAction, type Camera } from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { Unit } from '../../engine'
import { FLASH_MS, motion, muzzleFlashes, muzzles, timeRate, wake } from '../game/presentation'
import { useStore } from '../game/store'
import type { AttachmentDef, ClipName } from './contract'
import { HOLDS_LAST, LOOPING, poseFallback, resolveClip, visibleAttachments } from './contract'
import { cueActive, animStats, holds, notePlayed, startCue } from './cues'
import { baseClip, type CoverLevel, type MoveMode } from './mapping'
import { cap, crossfade, idleStep, speedTimeScale } from './tuning'
import type { RigAsset } from './assets'
import { itemScene } from './assets'

const noRay = (): null => null

// ---- shared per-frame view data (filled once per frame by <AnimFrame/>)
const frame = { frustum: new Frustum(), mat: new Matrix4(), cam: new Vector3(), ready: false }
const tmp = new Vector3()
export function updateFrame(camera: Camera): void {
  frame.mat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  frame.frustum.setFromProjectionMatrix(frame.mat)
  camera.getWorldPosition(frame.cam)
  frame.ready = true
}
function onScreen(p: Vector3): boolean {
  if (!frame.ready) return true
  // a figure is about 1 tile tall: test its centre with a 1.2 radius margin
  for (const pl of frame.frustum.planes) if (pl.distanceToPoint(p) < -1.2) return false
  return true
}

// The canvas renders on demand; standing figures ask for a redraw about 10 times a second (not 60) so idle breathing costs little.
let idleTimer: ReturnType<typeof setTimeout> | null = null
function scheduleIdleFrame(): void {
  if (idleTimer !== null) return
  idleTimer = setTimeout(() => { idleTimer = null; wake(10) }, idleStep() * 1000)
}

const flashGeo = new SphereGeometry(0.055, 10, 8)
const flashMat = new MeshBasicMaterial({ color: '#ffb850', toneMapped: false, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false })

interface Att { def: AttachmentDef; holder: Object3D; bone: Object3D; flash: Mesh | null }

/** Attachments that are guns (the others with a muzzle point, maul, shield, handset, never flash). */
const GUNS = new Set(['pistol', 'revolver', 'rifle', 'smg', 'lmg', 'shotgun', 'long-rifle'])

function hashId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10000) / 10000
}

const pathLen = new WeakMap<object, number>()
function lengthOf(path: { x: number; y: number }[], key: object): number {
  let l = pathLen.get(key)
  if (l === undefined) {
    l = 0
    for (let i = 1; i < path.length; i++) l += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y)
    pathLen.set(key, l)
  }
  return l
}

interface RigState {
  cur: ClipName | null
  action: AnimationAction | null
  seq: number
  acc: number
  atts: boolean[]
  want: ClipName
}

/** Once per frame, before the rigs: the camera frustum used to skip off-screen figures. Renders nothing. */
export function AnimFrame(): null {
  const { camera } = useThree()
  useFrame(() => { camera.updateMatrixWorld(); updateFrame(camera); animStats.frames++ })
  return null
}

export function RigModel({ unit, rig, lite, cover = null }: { unit: Unit; rig: RigAsset; lite: boolean; cover?: CoverLevel | null }): React.JSX.Element {
  const unitRef = useRef(unit)
  unitRef.current = unit
  const coverRef = useRef(cover) // which cover the figure poses against (Figures: coverStance toward its aim target)
  coverRef.current = cover
  const liteRef = useRef(lite)
  liteRef.current = lite
  const pose = useRef<Group>(null)
  const root = useMemo(() => cloneSkinned(rig.scene) as Group, [rig])
  const mixer = useMemo(() => new AnimationMixer(root), [root])
  const st = useRef<RigState>({ cur: null, action: null, seq: -1, acc: 0, atts: [], want: 'idle' })
  const atts = useRef<Att[]>([])

  // attachments: parent each item to its bone with the manifest's row-major matrix (item-local -> bone-local)
  useEffect(() => {
    const made: Att[] = []
    for (const def of rig.def.attachments) {
      const bone = root.getObjectByName(def.bone)
      const item = itemScene(def.id)
      if (!bone || !item) continue
      const holder = new Object3D()
      holder.matrixAutoUpdate = false
      holder.matrix.set(...(def.matrix as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]))
      holder.add(cloneSkinned(item))
      holder.traverse((o) => { o.raycast = noRay })
      let flash: Mesh | null = null
      if (def.muzzle) {
        flash = new Mesh(flashGeo, flashMat)
        flash.position.set(...def.muzzle)
        flash.visible = false
        flash.raycast = noRay
        holder.add(flash)
      }
      bone.add(holder)
      made.push({ def, holder, bone, flash })
    }
    atts.current = made
    st.current.atts = []
    return () => { for (const a of made) a.bone.remove(a.holder); atts.current = [] }
  }, [root, rig])

  // the gun muzzle in world coordinates, for the shot effects (the director asks for it when the shot leaves the barrel)
  useEffect(() => {
    const id = unit.id
    const v = new Vector3()
    const get = (): [number, number, number] | null => {
      const guns = atts.current.filter((a) => a.flash && GUNS.has(a.def.id))
      const at = guns.find((a) => a.holder.visible) ?? guns[0]
      if (!at?.flash) return null
      at.flash.updateWorldMatrix(true, false)
      at.flash.getWorldPosition(v)
      return [v.x, v.y, v.z]
    }
    muzzles.set(id, get)
    return () => { if (muzzles.get(id) === get) muzzles.delete(id) }
  }, [unit.id])

  useEffect(() => {
    root.traverse((o) => { o.raycast = noRay })
    return () => { mixer.stopAllAction(); mixer.uncacheRoot(root) }
  }, [root, mixer])

  const tick = (dt: number): void => {
    const u = unitRef.current
    const S = st.current
    const g = pose.current
    if (!g) return
    const now = performance.now()
    const store = useStore.getState()
    const instant = store.settings.speed === 'instant'
    const cue = cueActive(u.id, now)
    if (cue) startCue(cue, now)
    const mo = motion.get(u.id)
    const mode: MoveMode = mo ? (mo.mode ?? 'walk') : null
    const hold = holds.get(u.id)
    const base = baseClip(hold ? { ...u, status: hold.status } : u, { cover: coverRef.current, moving: mode })
    const want: ClipName = cue ? cue.clip : base
    const resolved = resolveClip(want, (c) => rig.clips.has(c))
    S.want = want
    animStats.rigs++

    // ---- switch clip (crossfade) when the wanted clip or the cue changes
    if (resolved && (resolved !== S.cur || (cue && cue.seq !== S.seq))) {
      const clip = rig.clips.get(resolved)!
      const prev = S.action
      const next = mixer.clipAction(clip)
      const loops = LOOPING.has(resolved)
      const first = prev === null
      const fade = first || instant ? 0 : crossfade(resolved)
      next.reset()
      next.setLoop(loops ? LoopRepeat : LoopOnce, Infinity)
      next.clampWhenFinished = true
      next.timeScale = loops ? 1 : cue ? cue.scale : speedTimeScale(store.settings.speed)
      if (first && loops) next.time = hashId(u.id) * clip.duration // idle variation: figures never breathe in sync
      next.setEffectiveWeight(1)
      if (prev && prev !== next) prev.fadeOut(fade)
      if (fade > 0 && prev !== next) next.fadeIn(fade)
      next.play()
      // a state that holds its last frame (death) arrives already finished when nobody watched it happen (mount, Continue, Instant speed)
      if (!cue && !loops && HOLDS_LAST.has(resolved) && (first || instant || !prev)) next.time = clip.duration
      S.cur = resolved
      S.action = next
      S.seq = cue ? cue.seq : S.seq
      if (cue) S.seq = cue.seq
      notePlayed(u.id, resolved)
      S.atts = visibleAttachments(rig.def.attachments, resolved)
      for (let i = 0; i < atts.current.length; i++) {
        const idx = rig.def.attachments.indexOf(atts.current[i]!.def)
        atts.current[i]!.holder.visible = S.atts[idx] ?? true
      }
    }

    // ---- locomotion: stride phase follows the distance travelled (clip rate = ground speed / the clip's stride speed, capped)
    const a = S.action
    if (a && mo && (resolved === 'walk' || resolved === 'run' || resolved === 'panic')) {
      const stride = rig.def.clips[resolved]?.speed ?? rig.def.clips.walk?.speed
      if (stride) {
        const v = lengthOf(mo.path, mo) / Math.max(0.001, mo.dur / 1000)
        a.timeScale = Math.min(cap(), Math.max(0.5, v / (stride * rig.scale)))
      }
    }

    // ---- lying / kneeling fallbacks for figures that lack the clip (the static figures use the same poses)
    const fb = cue ? 'none' : poseFallback(want, resolved)
    if (fb === 'lying') { g.rotation.set(-Math.PI / 2 + 0.1, 0, 0); g.position.set(0, 0.16, 0.18); g.scale.set(1, 1, 1) }
    else if (fb === 'kneel') { g.rotation.set(0, 0, 0); g.position.set(0, 0, 0); g.scale.set(1, 0.74, 1) }
    else { g.rotation.set(0, 0, 0); g.position.set(0, 0, 0); g.scale.set(1, 1, 1) }

    // ---- muzzle flash: once per shot the director booked (a burst flashes per round); else the first instants of a fire cue
    const booked = muzzleFlashes.get(u.id)
    const last = booked?.times[booked.times.length - 1]
    const sched = booked && last !== undefined && now < last + 400 ? booked : null
    const rate = timeRate(now)
    for (const at of atts.current) {
      if (!at.flash) continue
      const gun = GUNS.has(at.def.id) && at.holder.visible
      const on = sched
        ? gun && sched.times.some((t) => now >= t && now < t + FLASH_MS / rate)
        : gun && cue?.clip === 'fire' && now - cue.t0 > cue.dur * 0.05 && now - cue.t0 < cue.dur * 0.05 + 90
      at.flash.visible = on
      if (on) at.flash.scale.setScalar((sched ? Math.min(1.3, 0.6 + 0.4 * sched.size) : 1) * (0.8 + (now % 40) / 100)) // a shotgun flashes bigger, a suppressed rifle barely
    }
    if (sched) wake(60)

    // ---- advance the mixer: visible figures only; idling figures at a low rate (Low tier: not at all when far away)
    S.acc += dt * rate // bullet time slows every figure while rounds are in the air
    g.getWorldPosition(tmp)
    const moving = !!cue || !!mo || !LOOPING.has(resolved ?? 'idle') || mode !== null
    const standing = !moving && (resolved === 'idle' || resolved === 'cover' || resolved === 'cower')
    if (!onScreen(tmp)) { animStats.skippedOffscreen++; S.acc = Math.min(S.acc, 0.5); return }
    animStats.visible++
    if (standing) {
      // Low tier: idle variation is frozen (the pose only changes when something else redraws the board)
      if (liteRef.current) { animStats.skippedFrozen++; S.acc = 0; return }
      scheduleIdleFrame()
      if (S.acc < idleStep()) return
      mixer.update(Math.min(S.acc, 0.5))
      S.acc = 0
      animStats.updated++
      return
    }
    mixer.update(Math.min(S.acc, 0.25))
    S.acc = 0
    animStats.updated++
    wake(60)
  }
  useFrame((_, dt) => { const t0 = performance.now(); tick(dt); animStats.ms += performance.now() - t0 }) // animStats.ms: the rigs' own CPU time (perf.md)

  return <group ref={pose}><primitive object={root} scale={rig.scale} /></group>
}
