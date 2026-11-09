// Small helpers shared by the syndicate AI and the squad bot. Read-only uses of engine data.
import { WEAPONS, type WeaponDef } from '../data'
import type { State, Unit } from '../engine'

/** A copy of a unit standing on another tile (to ask the engine "what if I were there?"). */
export function placed(u: Unit, x: number, y: number): Unit {
  return u.x === x && u.y === y ? u : { ...u, x, y }
}

export function weapon(id: string | null): WeaponDef | null {
  return id ? (WEAPONS[id] ?? null) : null
}

export function avgDamage(w: WeaponDef): number {
  return (w.damage[0] + w.damage[1]) / 2
}

/** The weapon's best distance band [from, to]: its highest range modifier band, or 1..falloff start. */
export function bestRange(w: WeaponDef): [number, number] {
  if (w.melee) return [1, 1]
  let best = -Infinity
  let band: [number, number] = [1, w.falloff.after]
  for (const b of w.bands) if (b.mod > best) { best = b.mod; band = [b.from, b.to] }
  return band
}

/** Deterministic noise in [0, 1) from the game seed, the step counter and some integers. No Math.random, no clock. */
export function jitter(s: State, ...keys: number[]): number {
  let h = (Math.imul(s.setup.seed | 0, 0x9e3779b1) ^ Math.imul(s.steps, 0x85ebca6b)) >>> 0
  for (const k of keys) {
    h = Math.imul(h ^ (k | 0), 0x45d9f3b) >>> 0
    h ^= h >>> 15
  }
  h = Math.imul(h, 0x2c1b3c6d) >>> 0
  h ^= h >>> 12
  return (h >>> 0) / 4294967296
}

/** Numeric part of a unit id ("e12" -> 12), for seeding. */
export function idNum(id: string): number {
  const n = parseInt(id.replace(/\D+/g, ''), 10)
  return Number.isFinite(n) ? n : 0
}
