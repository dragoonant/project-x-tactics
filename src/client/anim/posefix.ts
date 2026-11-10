// Idle pose correction (owner feedback: "hunched over aiming their guns, heads pointed towards the floor"). The A1 bake built the
// gun figures' idle, walk and run upper body from the library's pistol-aim idle: the torso leans forward, the head drops, and the
// gun is held at eye level. This straightens that upper body once at load time, on the clip data itself, so the mixer, the
// crossfades and the cost per frame stay as they were:
//   1. spine_01..03 move part of the way back to the bind pose (the figures were rigged standing upright);
//   2. neck and head go back to the bind pose, so the face looks ahead instead of at the floor;
//   3. the gun arms turn down rigidly about the line through both shoulders (a low ready). Both upper-arm joints lie on that
//      line, so the two hands keep their exact distance and the baked left-hand grip on a two-handed gun stays closed.
// Pistol figures carry the gun in the right hand only, so only that arm turns. Melee and civilian figures already use the
// relaxed library idle and are left alone. The aim, fire and cover clips are not touched: aiming should still look like aiming.
import { AnimationClip, AnimationMixer, Quaternion, QuaternionKeyframeTrack, QuaternionLinearInterpolant, Vector3, type Bone, type Object3D } from 'three'
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

const SPINE = ['spine_01', 'spine_02', 'spine_03']
const HEAD = ['neck_01', 'Head']
const FPS = 30

const done = new WeakSet<AnimationClip>()

/**
 * Rewrites the upper-body tracks of `kind`'s idle, walk and run clips in place (once per clip object). `scene` is the loaded
 * skinned scene in its bind pose; it is not changed (a clone is posed instead). Returns the names of the clips it changed.
 */
export function fixIdlePose(kind: string, scene: Object3D, clips: AnimationClip[], fix: PoseFix | undefined = POSE_FIX[kind]): string[] {
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
