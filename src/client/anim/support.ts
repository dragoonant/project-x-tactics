// Support hand on a long gun (owner: "the left hand should be underneath the shotgun, holding the barrel"). The A1 bake put the left
// hand on the gun with the library pose's hand orientation, so on the shotgun it grips the fore-end from above. This pass rewrites
// the left arm of every clip once at load time, on the clip data itself (like posefix.ts), so the mixer and the per-frame cost
// stay as they were:
//   1. the gun's frame follows the right hand (hand_r world x the manifest attachment matrix);
//   2. the left hand turns palm up under the fore-end, fingers across its underside and a little forward;
//   3. a two-bone solve on upperarm_l / lowerarm_l puts the wrist there, keeping the baked elbow plane;
//   4. frames where the baked left hand is off the gun (throw, point, the fall in death) keep their bake: the pass fades out with the
//      distance between the baked hand and the gun.
// It runs after fixIdlePose, so the cover clips and the lowered idle get it too.
import { AnimationMixer, Matrix4, Quaternion, QuaternionKeyframeTrack, QuaternionLinearInterpolant, Vector3, type AnimationClip, type Bone, type Object3D } from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { AttachmentDef } from './contract'

export interface SupportGrip {
  /** Contact point on the underside of the fore-end, item-local (glTF: x along the length, front at -X; y up). */
  point: [number, number, number]
  /** Where the A1 bake put the left hand (figures.json grip_l), item-local: the wrist near it means the hand is on the gun. */
  baked: [number, number, number]
  /** Degrees the fingers turn from straight across the gun toward the muzzle. */
  forward: number
  /** Gap between the palm surface and the bone line of the hand (figure units). */
  palm: number
}

/** Per right-hand item. The shotgun's fore-end spans 0.30..0.55 of its length with its underside at y 0.157 (item frame). */
export const SUPPORT_GRIP: Readonly<Record<string, SupportGrip>> = {
  shotgun: { point: [-0.09, 0.157, 0], baked: [0.091, 0.167, 0], forward: 30, palm: 0.025 },
}
/** The clips the pass rewrites (the library clips that ship in the GLB are never played). */
export const SUPPORT_CLIPS: ReadonlySet<string> = new Set(['idle', 'walk', 'run', 'aim', 'fire', 'hit', 'cover', 'coverHigh', 'peekLeft', 'peekRight'])
/** Baked wrist within NEAR of the baked grip point: full correction; beyond FAR: none (figure units). */
const NEAR = 0.16, FAR = 0.3
const FPS = 30
const ARM = ['upperarm_l', 'lowerarm_l', 'hand_l']

const done = new WeakSet<AnimationClip>()

/** Rewrites the left-arm tracks of `clips` for a figure whose right-hand item has a support grip. Returns the names of the clips it changed. */
export function fixSupportHand(scene: Object3D, clips: AnimationClip[], attachments: readonly Pick<AttachmentDef, 'id' | 'bone' | 'matrix'>[]): string[] {
  const att = attachments.find((a) => a.bone === 'hand_r' && SUPPORT_GRIP[a.id])
  if (!att) return []
  const grip = SUPPORT_GRIP[att.id]!
  const todo = clips.filter((c) => SUPPORT_CLIPS.has(c.name) && !done.has(c))
  if (todo.length === 0) return []
  const rig = cloneSkinned(scene)
  rig.updateMatrixWorld(true)
  const get = (n: string): Bone | null => (rig.getObjectByName(n) as Bone | undefined) ?? null
  const ua = get('upperarm_l'), la = get('lowerarm_l'), hl = get('hand_l'), hr = get('hand_r'), mid = get('middle_01_l'), idx = get('index_01_l'), pinky = get('pinky_01_l')
  if (!ua || !la || !hl || !hr || !mid || !idx || !pinky) return []
  const P = (o: Object3D): Vector3 => o.getWorldPosition(new Vector3())

  // ---- bind-pose hand basis: fingers (wrist -> middle knuckle), thumb side (pinky -> index), palm normal (toward the body: -X for the left hand)
  const hand0 = P(hl)
  const f0 = P(mid).sub(hand0).normalize()
  const s0 = P(idx).sub(P(pinky)).projectOnPlane(f0).normalize()
  let n0 = new Vector3().crossVectors(s0, f0).normalize()
  if (n0.x > 0) n0.negate()
  const t0 = new Vector3().crossVectors(f0, n0)
  const bindBasis = new Matrix4().makeBasis(f0, n0, t0)
  const bindHandW = hl.getWorldQuaternion(new Quaternion())
  // the palm centre from the wrist (bind, world): part way to the knuckles, out on the palm side
  const palm0 = P(mid).sub(hand0).multiplyScalar(0.55).addScaledVector(n0, grip.palm)
  const rest = new Map(ARM.map((n) => [n, get(n)!.quaternion.clone()] as const))
  const lenA = P(ua).distanceTo(P(la)), lenB = P(la).distanceTo(hand0)

  const attM = new Matrix4().set(...(att.matrix as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]))
  const point = new Vector3(...grip.point), bakedAt = new Vector3(...grip.baked)
  const fwdA = (grip.forward * Math.PI) / 180
  const gunM = new Matrix4(), gq = new Quaternion(), pq = new Quaternion(), wq = new Quaternion(), tmpS = new Vector3(), tmpP = new Vector3()
  const setWorld = (b: Object3D, q: Quaternion): void => { b.parent!.getWorldQuaternion(pq); b.quaternion.copy(pq.invert().multiply(q)); b.updateMatrixWorld(true) }
  const swing = (b: Object3D, from: Vector3, to: Vector3): void => {
    b.getWorldQuaternion(wq)
    setWorld(b, wq.premultiply(new Quaternion().setFromUnitVectors(from.normalize(), to.normalize())))
  }

  const out: string[] = []
  for (const clip of todo) {
    const mixer = new AnimationMixer(rig)
    mixer.clipAction(clip).play()
    const own = new Map<string, QuaternionLinearInterpolant>()
    for (const tr of clip.tracks) {
      const name = tr.name.replace(/\.quaternion$/, '')
      if (tr.name.endsWith('.quaternion') && ARM.includes(name)) own.set(name, new QuaternionLinearInterpolant(tr.times, tr.values, 4, new Float32Array(4)))
    }
    const n = Math.max(2, Math.round(clip.duration * FPS) + 1)
    const times = new Float32Array(n)
    const values = new Map(ARM.map((nm) => [nm, new Float32Array(n * 4)] as const))
    let changed = false
    for (let i = 0; i < n; i++) {
      const t = (clip.duration * i) / (n - 1)
      times[i] = t
      mixer.setTime(t)
      for (const nm of ARM) { const b = get(nm)!; const it = own.get(nm); if (it) b.quaternion.fromArray(it.evaluate(t)).normalize(); else b.quaternion.copy(rest.get(nm)!) }
      rig.updateMatrixWorld(true)
      const baked = ARM.map((nm) => get(nm)!.quaternion.clone())

      // the gun frame and the contact point under the fore-end
      gunM.multiplyMatrices(hr.matrixWorld, attM)
      gunM.decompose(tmpP, gq, tmpS)
      const contact = point.clone().applyMatrix4(gunM)
      const w = 1 - Math.min(1, Math.max(0, (P(hl).distanceTo(bakedAt.clone().applyMatrix4(gunM)) - NEAR) / (FAR - NEAR)))
      if (w > 0) {
        const up = new Vector3(0, 1, 0).applyQuaternion(gq)
        const fwd = new Vector3(-1, 0, 0).applyQuaternion(gq)
        // across the gun, away from the left shoulder (toward the figure's right), turned a little toward the muzzle
        const across = new Vector3().crossVectors(up, fwd).normalize()
        if (across.dot(contact.clone().sub(P(ua))) < 0) across.negate()
        const f = across.multiplyScalar(Math.cos(fwdA)).addScaledVector(fwd, Math.sin(fwdA)).projectOnPlane(up).normalize()
        const nn = up.clone().negate() // the palm faces the gun: up from below
        const tt = new Vector3().crossVectors(f, nn)
        const turn = new Matrix4().makeBasis(f, nn, tt).multiply(bindBasis.clone().transpose())
        const handQ = new Quaternion().setFromRotationMatrix(turn).multiply(bindHandW)
        const wrist = contact.clone().sub(palm0.clone().applyMatrix4(turn))

        // two-bone solve, elbow in the baked plane
        const A = P(ua), B = P(la)
        const toW = wrist.clone().sub(A)
        const L = Math.min(lenA + lenB - 1e-4, Math.max(Math.abs(lenA - lenB) + 1e-4, toW.length()))
        const d = toW.normalize()
        const pole = B.clone().sub(A).projectOnPlane(d)
        if (pole.lengthSq() < 1e-8) pole.set(0, -1, 0).projectOnPlane(d)
        pole.normalize()
        const cosA = (lenA * lenA + L * L - lenB * lenB) / (2 * lenA * L)
        const elbow = A.clone().addScaledVector(d, lenA * cosA).addScaledVector(pole, lenA * Math.sqrt(Math.max(0, 1 - cosA * cosA)))
        swing(ua, B.clone().sub(A), elbow.clone().sub(A))
        const E = P(la)
        swing(la, P(hl).sub(E), A.clone().addScaledVector(d, L).sub(E))
        setWorld(hl, handQ)
        for (let k = 0; k < ARM.length; k++) { const b = get(ARM[k]!)!; b.quaternion.copy(baked[k]!.slerp(b.quaternion, w)) }
        changed = true
      }
      for (const nm of ARM) get(nm)!.quaternion.toArray(values.get(nm)!, i * 4)
    }
    mixer.stopAllAction()
    mixer.uncacheRoot(rig)
    done.add(clip)
    if (!changed) continue
    const keep = new Set(ARM.map((b) => `${b}.quaternion`))
    clip.tracks = clip.tracks.filter((tr) => !keep.has(tr.name))
    for (const [name, v] of values) clip.tracks.push(new QuaternionKeyframeTrack(`${name}.quaternion`, times, v))
    clip.resetDuration()
    out.push(clip.name)
  }
  return out
}
