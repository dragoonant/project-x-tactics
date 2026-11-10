// Action camera poses (presentation only, no rules): the over-the-shoulder view behind a shooter and the close-up on a unit a shot kills.
// World coordinates (x east, z south, y up; a figure is 1.0 tall). `blocked(wx, wz)` says whether a world point is inside a wall, so the
// camera never starts inside one; the wall cutaway (Terrain) lowers the walls between the camera and the shot.
export type V3 = [number, number, number]

/** Normal-speed beats in ms (the director scales them by its speed factor): the glide in before the shot or the fall, the hold on the
 *  body after the death clip, the cap on the whole close-up, and the hold after a shot that did not kill. */
export const CINE_IN_MS = 450
export const CINE_OUT_MS = 600
export const KILL_HOLD_MS = 600
export const KILL_MAX_MS = 3200
export const CINE_HOLD_MS = 300
export interface Pose { pos: V3; look: V3 }
export interface XZ { x: number; z: number }

/** Shoulder camera: height, sideways offset and the distances behind the shooter it tries, nearest last. */
export const SHOT = { height: 1.2, side: 0.5, backs: [1.6, 1.15, 0.8, 0.5], lookY: 0.55 }
/** Kill close-up: distance from the victim, height, the angles off the shot line it tries (radians) and the look height. */
export const KILL = { dists: [2.3, 1.7], height: 1.05, angles: [0.7, -0.7, 1.3, -1.3, 0, 2.2, -2.2], lookY: 0.3 }

function dirOf(from: XZ, to: XZ): XZ {
  const dx = to.x - from.x, dz = to.z - from.z
  const l = Math.hypot(dx, dz)
  return l < 1e-6 ? { x: 0, z: -1 } : { x: dx / l, z: dz / l }
}

/** True when the segment from a to b (sampled) stays out of walls. */
function clear(a: XZ, b: XZ, blocked: (x: number, z: number) => boolean): boolean {
  for (let i = 1; i <= 4; i++) {
    const t = i / 4
    if (blocked(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false
  }
  return true
}

/** Third person behind the shooter's right shoulder (left when the right side is walled), looking at the target. */
export function shotPose(shooter: XZ, target: XZ, blocked: (x: number, z: number) => boolean): Pose {
  const d = dirOf(shooter, target)
  const r = { x: -d.z, z: d.x } // the shooter's right when facing d
  const look: V3 = [target.x, SHOT.lookY, target.z]
  for (const back of SHOT.backs) {
    for (const side of [1, -1]) {
      const p = { x: shooter.x - d.x * back + r.x * side * SHOT.side, z: shooter.z - d.z * back + r.z * side * SHOT.side }
      if (clear(shooter, p, blocked)) return { pos: [p.x, SHOT.height, p.z], look }
    }
  }
  // boxed in: look down over the shooter's head
  return { pos: [shooter.x - d.x * 0.5, 2.1, shooter.z - d.z * 0.5], look }
}

/** Close on the victim, from the shooter's side of it and a little off the shot line, so the fall reads. */
export function killPose(shooter: XZ, victim: XZ, blocked: (x: number, z: number) => boolean): Pose {
  const u = dirOf(victim, shooter)
  const look: V3 = [victim.x, KILL.lookY, victim.z]
  for (const dist of KILL.dists) {
    for (const a of KILL.angles) {
      const c = Math.cos(a), s = Math.sin(a)
      const p = { x: victim.x + (u.x * c - u.z * s) * dist, z: victim.z + (u.x * s + u.z * c) * dist }
      if (clear(victim, p, blocked)) return { pos: [p.x, KILL.height, p.z], look }
    }
  }
  return { pos: [victim.x + u.x * 1.2, 2.4, victim.z + u.z * 1.2], look }
}
