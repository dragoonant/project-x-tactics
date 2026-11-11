// Idle pose correction (owner feedback: "hunched over aiming their guns, heads pointed towards the floor"). The A1 bake built the
// gun figures' idle, walk and run upper body from the library's pistol-aim idle: the torso leans forward, the head drops, and the
// gun is held at eye level. This straightens that upper body once at load time, on the clip data itself, so the mixer, the
// crossfades and the cost per frame stay as they were:
//   1. spine_01..03 move part of the way back to the bind pose (the figures were rigged standing upright);
//   2. neck and head go back to the bind pose, so the face looks ahead instead of at the floor;
//   3. the gun arms turn down rigidly about the line through both shoulders (a low ready). Both upper-arm joints lie on that
//      line, so the two hands keep their exact distance and the baked left-hand grip on a two-handed gun stays closed.
// Pistol figures carry the gun in the right hand only, so only that arm turns. Melee and civilian figures already use the
// relaxed library idle and are left alone. The aim and fire clips are not touched: aiming should still look like aiming.
//
// The cover clip (a figure next to a wall or crate) was a deep squat with the back bent and the head at the floor (owner: "like
// they're hunched over taking a poop"; asked for an upright low crouch). fixCoverPose rebuilds it from the same clip:
//   1. legs and pelvis move part of the way to the idle stance (a shallower crouch); the pelvis then shifts so the lower foot
//      stays on the floor where the clip had it;
//   2. the spine stands up: the chest's up axis turns to a small forward lean from vertical;
//   3. both arms turn rigidly about the shoulder line until the gun points where the clip pointed it (ready over the cover);
//   4. the neck and head level the face with the horizon, keeping the direction it looks.
import { AnimationClip, AnimationMixer, Quaternion, QuaternionKeyframeTrack, QuaternionLinearInterpolant, Vector3, VectorKeyframeTrack, type Bone, type Object3D } from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

export interface PoseFix {
  /** 0..1: how far each spine bone goes back to its bind rotation. */
  spine: number
  /** 0..1: how far the neck and head go back to their bind rotation. */
  head: number
  /** Degrees the gun arms turn down about the shoulder line. */
  armsDown: number
  /** Which upper arms turn: both for a two-handed gun, the right one for a pistol. */
  arms: 'both' | 'right'
}

const LONG: PoseFix = { spine: 0.75, head: 1, armsDown: 38, arms: 'both' }
const PISTOL: PoseFix = { spine: 0.75, head: 1, armsDown: 50, arms: 'right' }
/** Per figure kind (the manifest's figure keys; tools/anim/figures.json `arch`). Kinds not listed keep their clips. */
export const POSE_FIX: Readonly<Record<string, PoseFix>> = {
  recruit: LONG, enforcer: LONG, marksman: LONG, 'vox-operator': LONG, 'chem-trooper': LONG, gunman: LONG, heavy: LONG,
  bulwark: PISTOL, recon: PISTOL, 'thug-pistol': PISTOL, fixer: PISTOL, bagman: PISTOL,
}
/** The clips that get the correction. */
export const FIXED_CLIPS: ReadonlySet<string> = new Set(['idle', 'walk', 'run'])

export interface CoverFix {
  /** 0..1: how far legs and pelvis go from the cover squat toward the idle stance. */
  rise: number
  /** Degrees the chest leans forward from vertical. */
  lean: number
}
export const COVER_FIX: CoverFix = { rise: 0.3, lean: 26 }
/** Every figure with a cover clip (tools/anim/figures.json). */
export const COVER_KINDS: ReadonlySet<string> = new Set([...Object.keys(POSE_FIX), 'thug-club'])

const SPINE = ['spine_01', 'spine_02', 'spine_03']
const HEAD = ['neck_01', 'Head']
const FPS = 30

const done = new WeakSet<AnimationClip>()

/**
 * Rewrites the upper-body tracks of `kind`'s idle, walk and run clips in place (once per clip object). `scene` is the loaded
 * skinned scene in its bind pose; it is not changed (a clone is posed instead). Returns the names of the clips it changed.
 */
export function fixIdlePose(kind: string, scene: Object3D, clips: AnimationClip[], fix: PoseFix | undefined = POSE_FIX[kind]): string[] {
  const out = fixStand(scene, clips, fix)
  if (COVER_KINDS.has(kind)) out.push(...fixCoverPose(scene, clips))
  return out
}

function fixStand(scene: Object3D, clips: AnimationClip[], fix: PoseFix | undefined): string[] {
  if (!fix) return []
  const todo = clips.filter((c) => FIXED_CLIPS.has(c.name) && !done.has(c))
  if (todo.length === 0) return []
  const rig = cloneSkinned(scene)
  const bone = (n: string): Bone | null => (rig.getObjectByName(n) as Bone | undefined) ?? null
  const names = [...SPINE, ...HEAD, 'upperarm_l', 'upperarm_r']
  const bones = new Map<string, Bone>()
  for (const n of names) { const b = bone(n); if (b) bones.set(n, b) }
  const ul = bones.get('upperarm_l'), ur = bones.get('upperarm_r')
  if (!ul || !ur) return []
  const rest = new Map<string, Quaternion>()
  for (const [n, b] of bones) rest.set(n, b.quaternion.clone())
  const turned = fix.arms === 'both' ? [ul, ur] : [ur]
  const angle = (fix.armsDown * Math.PI) / 180
  const out: string[] = []
  const pl = new Vector3(), pr = new Vector3(), axis = new Vector3()
  const turn = new Quaternion(), wq = new Quaternion(), pq = new Quaternion()

  for (const clip of todo) {
    const mixer = new AnimationMixer(rig)
    const action = mixer.clipAction(clip)
    action.play()
    const n = Math.max(2, Math.round(clip.duration * FPS) + 1)
    const times = new Float32Array(n)
    const values = new Map<string, Float32Array>()
    for (const name of bones.keys()) values.set(name, new Float32Array(n * 4))
    // The mixer poses the rest of the skeleton (pelvis, clavicles ...). The corrected bones are sampled from their own tracks here,
    // because the mixer does not write a value that has not changed since its last write, and these bones are edited every frame.
    const own = new Map<string, QuaternionLinearInterpolant>()
    for (const tr of clip.tracks) {
      const name = tr.name.replace(/\.quaternion$/, '')
      if (tr.name.endsWith('.quaternion') && bones.has(name)) own.set(name, new QuaternionLinearInterpolant(tr.times, tr.values, 4, new Float32Array(4)))
    }
    for (let i = 0; i < n; i++) {
      const t = (clip.duration * i) / (n - 1)
      times[i] = t
      mixer.setTime(t)
      for (const [name, b] of bones) {
        const it = own.get(name)
        if (it) b.quaternion.fromArray(it.evaluate(t)).normalize()
        else b.quaternion.copy(rest.get(name)!) // a bone the clip does not animate keeps its bind pose
      }
      for (const name of SPINE) bones.get(name)?.quaternion.slerp(rest.get(name)!, fix.spine)
      for (const name of HEAD) bones.get(name)?.quaternion.slerp(rest.get(name)!, fix.head)
      rig.updateMatrixWorld(true)
      ul.getWorldPosition(pl)
      ur.getWorldPosition(pr)
      axis.subVectors(pl, pr)
      if (axis.lengthSq() > 1e-10) {
        axis.normalize()
        if (axis.x < 0) axis.negate() // +X (the figure's left; it faces +Z): a positive turn takes the muzzle down
        turn.setFromAxisAngle(axis, angle)
        for (const b of turned) {
          b.getWorldQuaternion(wq)
          wq.premultiply(turn)
          b.parent!.getWorldQuaternion(pq)
          b.quaternion.copy(pq.invert().multiply(wq))
        }
      }
      for (const [name, b] of bones) b.quaternion.toArray(values.get(name)!, i * 4)
    }
    mixer.stopAllAction()
    mixer.uncacheRoot(rig)
    const keep = new Set([...bones.keys()].map((b) => `${b}.quaternion`))
    clip.tracks = clip.tracks.filter((tr) => !keep.has(tr.name))
    for (const [name, v] of values) clip.tracks.push(new QuaternionKeyframeTrack(`${name}.quaternion`, times, v))
    clip.resetDuration()
    done.add(clip)
    out.push(clip.name)
  }
  return out
}

const LEGS = ['pelvis', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r']
const FEET = ['ball_l', 'ball_r', 'foot_l', 'foot_r']
const UP = new Vector3(0, 1, 0), FWD = new Vector3(0, 0, 1)

/**
 * Rebuilds the cover clip as an upright low crouch (see the header). Uses the figure's idle clip for the stance; does nothing when
 * either clip or a needed bone is missing. Returns ['cover'] when it changed the clip.
 */
export function fixCoverPose(scene: Object3D, clips: AnimationClip[], fix: CoverFix = COVER_FIX): string[] {
  const clip = clips.find((c) => c.name === 'cover')
  const idle = clips.find((c) => c.name === 'idle')
  if (!clip || !idle || done.has(clip)) return []
  const rig = cloneSkinned(scene)
  rig.updateMatrixWorld(true)
  const names = [...LEGS, ...SPINE, ...HEAD, 'upperarm_l', 'upperarm_r']
  const bones = new Map<string, Bone>()
  for (const nm of names) { const b = rig.getObjectByName(nm) as Bone | undefined; if (b) bones.set(nm, b) }
  if (names.some((nm) => !bones.has(nm))) return []
  const get = (nm: string): Bone => bones.get(nm)!
  const feet = FEET.map((nm) => rig.getObjectByName(nm)).filter((b): b is Object3D => !!b)
  const handR = rig.getObjectByName('hand_r')
  if (!handR || feet.length === 0) return []
  // bone-local axes that point up / forward in the bind pose (the figure stands upright facing +Z)
  const localAxis = (b: Object3D, vec: Vector3): Vector3 => vec.clone().applyQuaternion(b.getWorldQuaternion(new Quaternion()).invert())
  const pelvisFwd = localAxis(get('pelvis'), FWD), chestUp = localAxis(get('spine_03'), UP), headFwd = localAxis(get('Head'), FWD)
  const rest = new Map<string, Quaternion>()
  for (const [nm, b] of bones) rest.set(nm, b.quaternion.clone())
  const restPelvisPos = get('pelvis').position.clone()

  const quatAt = (c: AnimationClip, nm: string): QuaternionLinearInterpolant | null => {
    const tr = c.tracks.find((x) => x.name === `${nm}.quaternion`)
    return tr ? new QuaternionLinearInterpolant(tr.times, tr.values, 4, new Float32Array(4)) : null
  }
  const posAt = (c: AnimationClip): ((t: number) => Vector3 | null) => {
    const tr = c.tracks.find((x) => x.name === 'pelvis.position')
    if (!tr) return () => null
    const { times, values } = tr
    return (t) => {
      let k = 0
      while (k < times.length - 1 && times[k + 1]! <= t) k++
      const k2 = Math.min(k + 1, times.length - 1)
      const span = times[k2]! - times[k]!
      const a = span > 0 ? Math.min(1, Math.max(0, (t - times[k]!) / span)) : 0
      return new Vector3(values[k * 3]!, values[k * 3 + 1]!, values[k * 3 + 2]!).lerp(new Vector3(values[k2 * 3]!, values[k2 * 3 + 1]!, values[k2 * 3 + 2]!), a)
    }
  }
  const own = new Map<string, QuaternionLinearInterpolant | null>(), idleOwn = new Map<string, QuaternionLinearInterpolant | null>()
  for (const nm of bones.keys()) { own.set(nm, quatAt(clip, nm)); idleOwn.set(nm, quatAt(idle, nm)) }
  const coverPos = posAt(clip), idlePos = posAt(idle)

  const wq = new Quaternion(), pq = new Quaternion(), d = new Quaternion(), v = new Vector3(), w = new Vector3()
  const setWorld = (b: Object3D, q: Quaternion): void => { b.parent!.getWorldQuaternion(pq); b.quaternion.copy(pq.invert().multiply(q)) }
  const turnWorld = (b: Object3D, delta: Quaternion): void => { b.getWorldQuaternion(wq); setWorld(b, wq.premultiply(delta)); b.updateMatrixWorld(true) }
  const lowestFoot = (): number => Math.min(...feet.map((f) => f.getWorldPosition(v).y))
  const gunElev = (): number => { const s = get('upperarm_r').getWorldPosition(new Vector3()); handR.getWorldPosition(w).sub(s); return Math.atan2(w.y, Math.hypot(w.x, w.z)) }

  const n = Math.max(2, Math.round(clip.duration * FPS) + 1)
  const times = new Float32Array(n)
  const quats = new Map<string, Float32Array>()
  for (const nm of bones.keys()) quats.set(nm, new Float32Array(n * 4))
  const pos = new Float32Array(n * 3)
  const mixer = new AnimationMixer(rig)
  mixer.clipAction(clip).play()
  const pelvis = get('pelvis')
  for (let i = 0; i < n; i++) {
    const t = (clip.duration * i) / (n - 1)
    const ti = idle.duration > 0 ? t % idle.duration : 0
    times[i] = t
    mixer.setTime(t)
    for (const [nm, b] of bones) {
      const it = own.get(nm)
      if (it) b.quaternion.fromArray(it.evaluate(t)).normalize()
      else b.quaternion.copy(rest.get(nm)!)
    }
    pelvis.position.copy(coverPos(t) ?? restPelvisPos)
    rig.updateMatrixWorld(true)
    const floor = lowestFoot()
    const elev = gunElev()
    // 1. a shallower crouch: legs and pelvis toward the idle stance, then the lower foot back on the floor
    for (const nm of LEGS) {
      const it = idleOwn.get(nm)
      if (it) get(nm).quaternion.slerp(d.fromArray(it.evaluate(ti)).normalize(), fix.rise)
    }
    const ip = idlePos(ti)
    if (ip) pelvis.position.lerp(ip, fix.rise)
    rig.updateMatrixWorld(true)
    const lift = lowestFoot() - floor
    if (Math.abs(lift) > 1e-6) {
      pelvis.getWorldPosition(v)
      v.y -= lift
      pelvis.position.copy(pelvis.parent!.worldToLocal(v))
      rig.updateMatrixWorld(true)
    }
    // 2. the chest stands up, leaning forward a little the way the pelvis faces
    for (const nm of SPINE) get(nm).quaternion.copy(rest.get(nm)!)
    rig.updateMatrixWorld(true)
    const facing = pelvisFwd.clone().applyQuaternion(pelvis.getWorldQuaternion(wq)).setY(0)
    if (facing.lengthSq() < 1e-6) facing.copy(FWD)
    facing.normalize()
    const lean = (fix.lean * Math.PI) / 180
    const target = UP.clone().multiplyScalar(Math.cos(lean)).addScaledVector(facing, Math.sin(lean))
    d.setFromUnitVectors(chestUp.clone().applyQuaternion(get('spine_03').getWorldQuaternion(wq)).normalize(), target)
    turnWorld(get('spine_01'), d)
    // 3. the gun back where the clip pointed it: both arms turn about the shoulder line (two passes converge)
    const left = new Vector3().crossVectors(UP, facing)
    for (let pass = 0; pass < 2; pass++) {
      rig.updateMatrixWorld(true)
      const axis = get('upperarm_l').getWorldPosition(new Vector3()).sub(get('upperarm_r').getWorldPosition(new Vector3()))
      if (axis.lengthSq() < 1e-10) break
      axis.normalize()
      if (axis.dot(left) < 0) axis.negate() // the figure's left: a positive turn lowers the muzzle
      d.setFromAxisAngle(axis, gunElev() - elev)
      turnWorld(get('upperarm_l'), d)
      turnWorld(get('upperarm_r'), d)
    }
    // 4. the face level with the horizon: half the pitch in the neck, the rest in the head
    for (const [nm, share] of [['neck_01', 0.5], ['Head', 1]] as const) {
      rig.updateMatrixWorld(true)
      const f = headFwd.clone().applyQuaternion(get('Head').getWorldQuaternion(wq)).normalize()
      const level = f.clone().setY(0)
      if (level.lengthSq() < 1e-4) continue
      d.setFromUnitVectors(f, level.normalize())
      turnWorld(get(nm), new Quaternion().slerp(d, share))
    }
    for (const [nm, b] of bones) b.quaternion.toArray(quats.get(nm)!, i * 4)
    pelvis.position.toArray(pos, i * 3)
  }
  mixer.stopAllAction()
  mixer.uncacheRoot(rig)
  const keep = new Set([...[...bones.keys()].map((b) => `${b}.quaternion`), 'pelvis.position'])
  clip.tracks = clip.tracks.filter((tr) => !keep.has(tr.name))
  for (const [nm, q] of quats) clip.tracks.push(new QuaternionKeyframeTrack(`${nm}.quaternion`, times, q))
  clip.tracks.push(new VectorKeyframeTrack('pelvis.position', times, pos))
  clip.resetDuration()
  done.add(clip)
  return ['cover']
}
