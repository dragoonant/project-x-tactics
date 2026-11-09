// Deterministic per-tile prop variants: the same map looks the same on every run (a hash of x, y and whether the tile is inside a
// building), and a variant never depends on game state. Pure functions, unit-tested.
import { hash2 } from '../layout'
import type { PropDef, Where } from './assets'

type Pick = { where: Where; weight: number }

/** Weighted pick among the defs allowed for this side of the wall; null when none is allowed. */
export function pickVariant<T extends Pick>(defs: readonly T[], x: number, y: number, indoor: boolean): T | null {
  const ok = defs.filter((d) => d.where === 'any' || (indoor ? d.where === 'indoor' : d.where === 'outdoor'))
  if (!ok.length) return null
  let total = 0
  for (const d of ok) total += Math.max(0, d.weight)
  if (total <= 0) return ok[0]!
  let r = hash2(x, y, 71) * total
  for (const d of ok) { r -= Math.max(0, d.weight); if (r < 0) return d }
  return ok[ok.length - 1]!
}

/** Quarter-turn yaw 0..3 for a tile (square footprints, so any quarter turn stays inside the tile). */
export function pickYaw(x: number, y: number): number { return Math.floor(hash2(x, y, 61) * 4) % 4 }

export function pickTint(def: Pick & { tints: readonly (readonly [number, number, number])[] }, x: number, y: number): readonly [number, number, number] {
  return def.tints[Math.floor(hash2(x, y, 73) * def.tints.length) % def.tints.length]!
}

export type { PropDef }
