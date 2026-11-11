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
// Cover (owner, with two reference photos: "aim around high cover ... at the closest enemy", and behind low cover "take a knee"
// instead of the baked squat). buildCoverClips makes two clips from the RAW idle (the library aim idle, gun at eye level), before
// the idle itself is lowered:
//   coverHigh  standing aim: the idle's legs; the chest turned up to a small forward lean; the face level with the horizon; both
//              arms turned rigidly about the shoulder line so the gun keeps the idle's aim;
//   cover      kneel: the same upper body on a kneeling lower body built from the bind-pose leg lengths: right knee on the floor
//              under the hip, right shin back with the toes tucked, left foot flat in front with the shin upright.
// The board turns the figure toward its aim point (Figures: stances), so the gun points at the closest enemy.
import { AnimationClip, AnimationMixer, type KeyframeTrack, Quaternion, QuaternionKeyframeTrack, QuaternionLinearInterpolant, Vector3, VectorKeyframeTrack, type Bone, type Object3D } from 'three'
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
  /** Degrees the chest leans forward from vertical in the standing aim. */
  standLean: number
  /** Degrees the chest leans forward from vertical in the kneel. */
  kneelLean: number
  /** Degrees the right thigh tilts forward from vertical in the kneel (the knee on the floor). */
  kneeTilt: number
}
export const COVER_FIX: CoverFix = { standLean: 6, kneelLean: 8, kneeTilt: 6 }
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
  // the cover clips first: they start from the raw idle, which fixStand then lowers
  const out = COVER_KINDS.has(kind) ? buildCoverClips(scene, clips) : []
  out.push(...fixStand(scene, clips, fix))
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

const LEGS = ['thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r']
const UP = new Vector3(0, 1, 0), FWD = new Vector3(0, 0, 1), LEFT = new Vector3(1, 0, 0)

/**
 * Builds `coverHigh` (added to `clips`) and `cover` (replaced, or added) from the raw idle; see the header. Runs once per idle
 * clip; does nothing when the idle or a needed bone is missing. Returns the names of the clips it made.
 */
export function buildCoverClips(scene: Object3D, clips: AnimationClip[], fix: CoverFix = COVER_FIX): string[] {
  const idle = clips.find((c) => c.name === 'idle')
  if (!idle || done.has(idle) || clips.some((c) => c.name === 'coverHigh')) return []
  const rig = cloneSkinned(scene)
  rig.updateMatrixWorld(true)
  const names = ['pelvis', ...LEGS, 'ball_l', 'ball_r', ...SPINE, ...HEAD, 'upperarm_l', 'upperarm_r', 'hand_r']
  const bones = new Map<string, Object3D>()
  for (const nm of names) { const b = rig.getObjectByName(nm); if (b) bones.set(nm, b) }
  if (names.some((nm) => !bones.has(nm))) return []
  const get = (nm: string): Object3D => bones.get(nm)!
  const P = (nm: string): Vector3 => get(nm).getWorldPosition(new Vector3())
  const W = (nm: string): Quaternion => get(nm).getWorldQuaternion(new Quaternion())

  // ---- bind-pose measures (the figure stands upright on the floor, facing +Z, its left = +X)
  const bindW = new Map<string, Quaternion>(), bindDir = new Map<string, Vector3>()
  const CHILD: Record<string, string> = { thigh_l: 'calf_l', calf_l: 'foot_l', foot_l: 'ball_l', thigh_r: 'calf_r', calf_r: 'foot_r', foot_r: 'ball_r' }
  for (const nm of bones.keys()) bindW.set(nm, W(nm))
  for (const [nm, ch] of Object.entries(CHILD)) bindDir.set(nm, P(ch).sub(P(nm)).normalize())
  const thigh = P('thigh_r').distanceTo(P('calf_r')), shin = P('calf_r').distanceTo(P('foot_r')), foot = P('foot_r').distanceTo(P('ball_r'))
  const floor = Math.min(P('ball_l').y, P('ball_r').y)
  const ankle = P('foot_r').y - floor
  const hipDrop = P('pelvis').y - P('thigh_r').y // the pelvis joint above the hip joints
  const chestUp = UP.clone().applyQuaternion(bindW.get('spine_03')!.clone().invert())
  const headFwd = FWD.clone().applyQuaternion(bindW.get('Head')!.clone().invert())
  const pelvisFwd = FWD.clone().applyQuaternion(bindW.get('pelvis')!.clone().invert())

  const pq = new Quaternion(), wq = new Quaternion(), d = new Quaternion(), v = new Vector3()
  const setWorld = (b: Object3D, q: Quaternion): void => { b.parent!.getWorldQuaternion(pq); b.quaternion.copy(pq.invert().multiply(q)); b.updateMatrixWorld(true) }
  const turnWorld = (b: Object3D, delta: Quaternion): void => { b.getWorldQuaternion(wq); setWorld(b, wq.premultiply(delta)) }
  /** Points a leg bone along `dir` with the least turn from its bind orientation (so the knee keeps hinging forward). */
  const aimBone = (nm: string, dir: Vector3): void => { setWorld(get(nm), new Quaternion().setFromUnitVectors(bindDir.get(nm)!, dir.clone().normalize()).multiply(bindW.get(nm)!)) }
  const gunElev = (): number => { const h = P('hand_r').sub(P('upperarm_r')); return Math.atan2(h.y, Math.hypot(h.x, h.z)) }

  const quatAt = (nm: string): QuaternionLinearInterpolant | null => {
    const tr = idle.tracks.find((x) => x.name === nm + '.quaternion')
    return tr ? new QuaternionLinearInterpolant(tr.times, tr.values, 4, new Float32Array(4)) : null
  }
  const posTr = idle.tracks.find((x) => x.name === 'pelvis.position')
  const pelvisPosAt = (t: number): Vector3 | null => {
    if (!posTr) return null
    const { times, values } = posTr
    let k = 0
    while (k < times.length - 1 && times[k + 1]! <= t) k++
    const k2 = Math.min(k + 1, times.length - 1), span = times[k2]! - times[k]!
    const a = span > 0 ? Math.min(1, Math.max(0, (t - times[k]!) / span)) : 0
    return new Vector3(values[k * 3]!, values[k * 3 + 1]!, values[k * 3 + 2]!).lerp(new Vector3(values[k2 * 3]!, values[k2 * 3 + 1]!, values[k2 * 3 + 2]!), a)
  }
  const edited = ['pelvis', ...LEGS, ...SPINE, ...HEAD, 'upperarm_l', 'upperarm_r']
  const own = new Map(edited.map((nm) => [nm, quatAt(nm)] as const))
  const restLocal = new Map(edited.map((nm) => [nm, get(nm).quaternion.clone()] as const))
  const restPos = get('pelvis').position.clone()

  // The mixer poses every other bone; the edited ones are sampled from the idle's own tracks (the mixer does not rewrite a value
  // it thinks is unchanged, and these are edited every frame).
  const mixer = new AnimationMixer(rig)
  mixer.clipAction(idle).play()
  const poseIdle = (t: number): void => {
    mixer.setTime(t)
    for (const nm of edited) { const it = own.get(nm); get(nm).quaternion.copy(it ? d.fromArray(it.evaluate(t)).normalize() : restLocal.get(nm)!) }
    get('pelvis').position.copy(pelvisPosAt(t) ?? restPos)
    rig.updateMatrixWorld(true)
  }

  // The kneeling lower body uses the idle's pelvis at t = 0, so the legs stay still while the upper body breathes.
  poseIdle(0)
  const pelvis0 = P('pelvis')
  const fwd0 = pelvisFwd.clone().applyQuaternion(W('pelvis')).setY(0)
  const yaw = fwd0.lengthSq() > 1e-6 ? new Quaternion().setFromUnitVectors(FWD, fwd0.normalize()) : new Quaternion()
  const kneel = (): void => {
    const tilt = (fix.kneeTilt * Math.PI) / 180
    const kneeY = floor + ankle * 0.6
    const rThigh = new Vector3(-0.06, -Math.cos(tilt), Math.sin(tilt)).normalize()
    const pelvis = get('pelvis')
    setWorld(pelvis, yaw.clone().multiply(bindW.get('pelvis')!))
    v.set(pelvis0.x, kneeY - rThigh.y * thigh + hipDrop, pelvis0.z)
    pelvis.position.copy(pelvis.parent!.worldToLocal(v.clone()))
    rig.updateMatrixWorld(true)
    // right leg: knee down under the hip, shin back along the floor, toes tucked under
    aimBone('thigh_r', rThigh)
    const knee = P('calf_r')
    const ankleY = floor + foot * 0.8
    const dy = Math.max(-shin * 0.95, Math.min(shin * 0.95, ankleY - knee.y))
    aimBone('calf_r', new Vector3(0, dy, -Math.sqrt(Math.max(0, shin * shin - dy * dy))))
    const ank = P('foot_r'), fy = Math.min(foot * 0.95, Math.max(0, ank.y - floor))
    aimBone('foot_r', new Vector3(0, -fy, -Math.sqrt(Math.max(0, foot * foot - fy * fy))))
    // left leg: foot flat in front, shin upright, thigh forward and a little out
    const hip = P('thigh_l')
    const kneeL = floor + ankle + shin
    const ly = Math.max(-thigh * 0.95, Math.min(thigh * 0.95, kneeL - hip.y))
    const lh = Math.sqrt(Math.max(0, thigh * thigh - ly * ly))
    aimBone('thigh_l', new Vector3(0.18 * lh, ly, lh))
    aimBone('calf_l', new Vector3(0, -1, 0.06))
    setWorld(get('foot_l'), bindW.get('foot_l')!.clone())
  }

  // The upper body over whatever lower body is posed: chest to `leanDeg`, gun back to `elev`, face level with the horizon.
  const upper = (leanDeg: number, elev: number): void => {
    const lean = (leanDeg * Math.PI) / 180
    const target = UP.clone().multiplyScalar(Math.cos(lean)).addScaledVector(FWD, Math.sin(lean))
    for (let k = 0; k < SPINE.length; k++) {
      const up = chestUp.clone().applyQuaternion(W('spine_03')).normalize()
      turnWorld(get(SPINE[k]!), new Quaternion().slerp(new Quaternion().setFromUnitVectors(up, target), 1 / (SPINE.length - k)))
    }
    for (let pass = 0; pass < 2; pass++) {
      const axis = P('upperarm_l').sub(P('upperarm_r'))
      if (axis.lengthSq() < 1e-10) break
      axis.normalize()
      if (axis.dot(LEFT) < 0) axis.negate() // the figure's left: a positive turn lowers the muzzle
      const turn = new Quaternion().setFromAxisAngle(axis, gunElev() - elev)
      turnWorld(get('upperarm_l'), turn)
      turnWorld(get('upperarm_r'), turn)
    }
    for (const [nm, share] of [['neck_01', 0.5], ['Head', 1]] as const) {
      const f = headFwd.clone().applyQuaternion(W('Head')).normalize()
      const level = f.clone().setY(0)
      if (level.lengthSq() < 1e-4) continue
      turnWorld(get(nm), new Quaternion().slerp(new Quaternion().setFromUnitVectors(f, level.normalize()), share))
    }
  }

  const n = Math.max(2, Math.round(idle.duration * FPS) + 1)
  const times = new Float32Array(n)
  const make = (withKneel: boolean): { quats: Map<string, Float32Array>; pos: Float32Array } => {
    const quats = new Map(edited.map((nm) => [nm, new Float32Array(n * 4)] as const))
    const pos = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const t = (idle.duration * i) / (n - 1)
      times[i] = t
      poseIdle(t)
      const elev = gunElev() // the raw idle's aim
      if (withKneel) kneel()
      upper(withKneel ? fix.kneelLean : fix.standLean, elev)
      for (const nm of edited) get(nm).quaternion.toArray(quats.get(nm)!, i * 4)
      get('pelvis').position.toArray(pos, i * 3)
    }
    return { quats, pos }
  }
  const stand = make(false), knelt = make(true)
  mixer.stopAllAction()
  mixer.uncacheRoot(rig)

  const replaced = new Set([...edited.map((b) => b + '.quaternion'), 'pelvis.position'])
  const base = idle.tracks.filter((tr) => !replaced.has(tr.name))
  const tracks = (r: { quats: Map<string, Float32Array>; pos: Float32Array }): KeyframeTrack[] => [
    ...base.map((tr) => tr.clone()),
    ...[...r.quats].map(([nm, q]) => new QuaternionKeyframeTrack(nm + '.quaternion', times.slice(), q)),
    new VectorKeyframeTrack('pelvis.position', times.slice(), r.pos),
  ]
  const high = new AnimationClip('coverHigh', idle.duration, tracks(stand))
  clips.push(high)
  let low = clips.find((c) => c.name === 'cover')
  if (low) { low.tracks = tracks(knelt); low.duration = idle.duration }
  else { low = new AnimationClip('cover', idle.duration, tracks(knelt)); clips.push(low) }
  done.add(high); done.add(low)
  return ['coverHigh', 'cover']
}
