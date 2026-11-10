import { describe, expect, it } from 'vitest'
import { AnimationClip, AnimationMixer, Bone, Group, Quaternion, QuaternionKeyframeTrack, Vector3, type Object3D } from 'three'
import { FIXED_CLIPS, POSE_FIX, fixIdlePose } from '../../src/client/anim/posefix'

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
    expect(fixIdlePose('recruit', base, [clip])).toEqual(['idle'])
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

  it('changes only idle, walk and run, only once, and only for gun figures', () => {
    const clips = ['idle', 'walk', 'run', 'aim', 'cover'].map((n) => hunched(n))
    expect(fixIdlePose('gunman', skeleton(), clips).sort()).toEqual(['idle', 'run', 'walk'])
    expect(fixIdlePose('gunman', skeleton(), clips)).toEqual([])
    expect([...FIXED_CLIPS].sort()).toEqual(['idle', 'run', 'walk'])
    for (const k of ['thug-club', 'civilian-a', 'civilian-b', 'civilian-c']) expect(POSE_FIX[k]).toBeUndefined()
    expect(fixIdlePose('civilian-a', skeleton(), [hunched()])).toEqual([])
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
})
