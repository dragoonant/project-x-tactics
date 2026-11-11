import { describe, expect, it } from 'vitest'
import { AnimationClip, AnimationMixer, Bone, Group, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack, type Object3D } from 'three'
import { COVER_FIX, COVER_KINDS, FIXED_CLIPS, POSE_FIX, buildCoverClips, fixIdlePose } from '../../src/client/anim/posefix'

// A small skeleton with the UAL bone names: upright in its bind pose, figure facing +Z, left = +X.
function skeleton(): Group {
  const root = new Group()
  const mk = (name: string, parent: Object3D, x: number, y: number, z: number): Bone => { const b = new Bone(); b.name = name; b.position.set(x, y, z); parent.add(b); return b }
  const pelvis = mk('pelvis', root, 0, 1, 0)
  const s1 = mk('spine_01', pelvis, 0, 0.1, 0), s2 = mk('spine_02', s1, 0, 0.15, 0), s3 = mk('spine_03', s2, 0, 0.15, 0)
  const neck = mk('neck_01', s3, 0, 0.15, 0)
  mk('Head', neck, 0, 0.1, 0)
  for (const [side, sx] of [['l', 1], ['r', -1]] as const) {
    const cl = mk(`clavicle_${side}`, s3, 0.05 * sx, 0.1, 0)
    const ua = mk(`upperarm_${side}`, cl, 0.12 * sx, 0, 0)
    const la = mk(`lowerarm_${side}`, ua, 0.1 * sx, -0.2, 0)
    mk(`hand_${side}`, la, -0.05 * sx, 0, 0.25)
    const th = mk(`thigh_${side}`, pelvis, 0.1 * sx, -0.05, 0)
    const ca = mk(`calf_${side}`, th, 0, -0.45, 0)
    const ft = mk(`foot_${side}`, ca, 0, -0.42, 0)
    mk(`ball_${side}`, ft, 0, -0.06, 0.12)
  }
  root.updateMatrixWorld(true)
  return root
}
const q = (axis: Vector3, deg: number): number[] => new Quaternion().setFromAxisAngle(axis, (deg * Math.PI) / 180).toArray()
const X = new Vector3(1, 0, 0)
/** The hunched aim idle: spine and neck bent forward, head down. */
function hunched(name = 'idle'): AnimationClip {
  const tr = (bone: string, deg: number): QuaternionKeyframeTrack => new QuaternionKeyframeTrack(`${bone}.quaternion`, [0, 1], [...q(X, deg), ...q(X, deg)])
  return new AnimationClip(name, 1, [tr('spine_01', 12), tr('spine_02', 10), tr('spine_03', 8), tr('neck_01', 15), tr('Head', 20)])
}
function posed(root: Group, clip: AnimationClip, t: number): Group {
  const m = new AnimationMixer(root)
  m.clipAction(clip).play()
  m.setTime(t)
  root.updateMatrixWorld(true)
  return root
}
const world = (root: Object3D, n: string): Vector3 => root.getObjectByName(n)!.getWorldPosition(new Vector3())

describe('idle pose correction (owner feedback: hunched, heads to the floor)', () => {
  it('stands the spine up, levels the head and lowers the gun, keeping both hands the same distance apart', () => {
    const before = posed(skeleton(), hunched(), 0.5)
    const gripBefore = world(before, 'hand_l').distanceTo(world(before, 'hand_r'))
    const clip = hunched()
    const base = skeleton()
    expect(fixIdlePose('recruit', base, [clip])).toEqual(['coverHigh', 'peekLeft', 'peekRight', 'cover', 'idle']) // the cover clips are built from the raw idle first
    const after = posed(skeleton(), clip, 0.5)
    // the grip on a two-handed gun is unchanged
    expect(world(after, 'hand_l').distanceTo(world(after, 'hand_r'))).toBeCloseTo(gripBefore, 5)
    // the head sits higher and further back (less forward lean)
    expect(world(after, 'Head').y).toBeGreaterThan(world(before, 'Head').y)
    expect(world(after, 'Head').z).toBeLessThan(world(before, 'Head').z)
    // neck and head are back in their bind rotation (face ahead, not at the floor)
    const head = after.getObjectByName('Head')!.quaternion
    expect(head.angleTo(new Quaternion())).toBeLessThan(1e-4)
    // the gun arm points further down than before (the shoulders themselves rise as the chest straightens)
    const drop = (r: Object3D): number => { const v = world(r, 'hand_r').sub(world(r, 'upperarm_r')); return Math.atan2(-v.y, Math.hypot(v.x, v.z)) }
    expect(drop(after)).toBeGreaterThan(drop(before) + 0.2)
    // the bind pose itself was not touched
    expect(base.getObjectByName('spine_01')!.quaternion.angleTo(new Quaternion())).toBeLessThan(1e-9)
  })

  it('lowers only idle, walk and run, builds the cover clips, only once, and only for gun figures', () => {
    const clips = ['idle', 'walk', 'run', 'aim', 'cover'].map((n) => hunched(n))
    expect(fixIdlePose('gunman', skeleton(), clips).sort()).toEqual(['cover', 'coverHigh', 'idle', 'peekLeft', 'peekRight', 'run', 'walk'])
    expect(fixIdlePose('gunman', skeleton(), clips)).toEqual([])
    expect([...FIXED_CLIPS].sort()).toEqual(['idle', 'run', 'walk'])
    for (const k of ['thug-club', 'civilian-a', 'civilian-b', 'civilian-c']) expect(POSE_FIX[k]).toBeUndefined()
    expect(fixIdlePose('civilian-a', skeleton(), [hunched(), hunched('cover')])).toEqual([])
    // the club thug keeps its idle but gets the cover clips; civilians have no cover clip
    expect(COVER_KINDS.has('thug-club')).toBe(true)
    expect(fixIdlePose('thug-club', skeleton(), ['idle', 'cover'].map((n) => hunched(n)))).toEqual(['coverHigh', 'peekLeft', 'peekRight', 'cover'])
    for (const k of ['civilian-a', 'civilian-b', 'civilian-c']) expect(COVER_KINDS.has(k)).toBe(false)
  })

  it('a pistol figure turns only its gun arm', () => {
    const before = posed(skeleton(), hunched(), 0.5)
    const clip = hunched()
    fixIdlePose('recon', skeleton(), [clip])
    const after = posed(skeleton(), clip, 0.5)
    const drop = (r: Object3D, s: 'l' | 'r'): number => { const v = world(r, `hand_${s}`).sub(world(r, `upperarm_${s}`)); return Math.atan2(-v.y, Math.hypot(v.x, v.z)) }
    // both arms hang alike before; afterwards only the right (gun) arm has turned down, by the pistol angle
    expect(drop(before, 'r')).toBeCloseTo(drop(before, 'l'), 6)
    expect(drop(after, 'r') - drop(after, 'l')).toBeGreaterThan(0.5)
  })

  it('cover clips from the raw idle: a standing aim and a kneel, chest near upright, face level, gun aimed as in the idle', () => {
    const raw = posed(skeleton(), hunched(), 0.5)
    const gun = (r: Object3D): number => { const v = world(r, 'hand_r').sub(world(r, 'upperarm_r')); return Math.atan2(v.y, Math.hypot(v.x, v.z)) }
    const up = (r: Object3D): Vector3 => new Vector3(0, 1, 0).applyQuaternion(r.getObjectByName('spine_03')!.getWorldQuaternion(new Quaternion()))
    const tilt = (r: Object3D): number => (Math.acos(Math.min(1, up(r).y)) * 180) / Math.PI
    const faceY = (r: Object3D): number => new Vector3(0, 0, 1).applyQuaternion(r.getObjectByName('Head')!.getWorldQuaternion(new Quaternion())).y
    const bind = skeleton()
    const floor = Math.min(world(bind, 'ball_l').y, world(bind, 'ball_r').y)

    const clips = [hunched('idle'), hunched('cover')]
    expect(buildCoverClips(skeleton(), clips)).toEqual(['coverHigh', 'peekLeft', 'peekRight', 'cover'])
    expect(buildCoverClips(skeleton(), clips)).toEqual([]) // once
    expect(clips.map((c) => c.name)).toEqual(['idle', 'cover', 'coverHigh', 'peekLeft', 'peekRight'])
    expect(tilt(raw)).toBeGreaterThan(25)

    // standing aim: legs as in the idle, chest at the small lean, face level, gun where the idle aimed it
    const high = posed(skeleton(), clips.find((c) => c.name === 'coverHigh')!, 0.5)
    expect(tilt(high)).toBeCloseTo(COVER_FIX.standLean, 0)
    expect(Math.abs(faceY(high))).toBeLessThan(1e-3)
    expect(gun(high)).toBeCloseTo(gun(raw), 2)
    expect(world(high, 'pelvis').y).toBeCloseTo(world(raw, 'pelvis').y, 5)

    // peeking: the standing aim with the chest leaning out sideways (left = +X), the head partly back upright, face level, gun aimed
    const side = (r: Object3D): number => (Math.asin(Math.max(-1, Math.min(1, up(r).x))) * 180) / Math.PI
    const headRoll = (r: Object3D): number => (Math.asin(Math.max(-1, Math.min(1, new Vector3(0, 1, 0).applyQuaternion(r.getObjectByName('Head')!.getWorldQuaternion(new Quaternion())).x))) * 180) / Math.PI
    for (const [nm, sign] of [['peekLeft', 1], ['peekRight', -1]] as const) {
      const pk = posed(skeleton(), clips.find((c) => c.name === nm)!, 0.5)
      expect(side(pk) * sign).toBeCloseTo(COVER_FIX.peekLean, 0)
      expect(Math.abs(headRoll(pk))).toBeLessThan(COVER_FIX.peekLean * 0.6)
      expect(Math.abs(faceY(pk))).toBeLessThan(1e-3)
      const dir = (r: Object3D): Vector3 => world(r, 'hand_r').sub(world(r, 'upperarm_r')).normalize()
      expect(dir(pk).angleTo(dir(high))).toBeLessThan(1e-3) // the gun points exactly where the standing aim points it
      expect(world(pk, 'Head').x * sign).toBeGreaterThan(world(high, 'Head').x * sign + 0.08) // the head goes out to that side
      expect(world(pk, 'foot_l').distanceTo(world(high, 'foot_l'))).toBeLessThan(1e-4) // the feet stay put
    }

    // kneel: right knee near the floor under the hip, left knee up with the foot flat in front, much lower pelvis
    const low = posed(skeleton(), clips.find((c) => c.name === 'cover')!, 0.5)
    expect(tilt(low)).toBeCloseTo(COVER_FIX.kneelLean, 0)
    expect(Math.abs(faceY(low))).toBeLessThan(1e-3)
    expect(gun(low)).toBeCloseTo(gun(raw), 2)
    const ankle = world(bind, 'foot_r').y - floor
    expect(world(low, 'calf_r').y).toBeCloseTo(floor + ankle * 0.6, 3)
    expect(world(low, 'calf_l').y).toBeGreaterThan(world(low, 'calf_r').y + 0.2)
    expect(world(low, 'foot_l').z).toBeGreaterThan(world(low, 'thigh_l').z + 0.2) // the left foot is in front
    expect(world(low, 'foot_r').z).toBeLessThan(world(low, 'calf_r').z - 0.2) // the right shin lies back
    expect(world(low, 'foot_l').y).toBeCloseTo(world(bind, 'foot_l').y, 2) // the front foot stands on the floor
    expect(world(low, 'pelvis').y).toBeLessThan(world(raw, 'pelvis').y - 0.3)
    const footQ = low.getObjectByName('foot_l')!.getWorldQuaternion(new Quaternion())
    expect(footQ.angleTo(bind.getObjectByName('foot_l')!.getWorldQuaternion(new Quaternion()))).toBeLessThan(1e-3)
  })
})
