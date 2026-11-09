// ARCH-7: sfc32 RNG whose 4x32-bit state lives in state.rng. forcedRolls (test hook) are consumed first.
import type { State } from './types'

function splitmix(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x9e3779b9) >>> 0
    let t = a ^ (a >>> 16)
    t = Math.imul(t, 0x21f0aaad)
    t ^= t >>> 15
    t = Math.imul(t, 0x735a2d97)
    t ^= t >>> 15
    return t >>> 0
  }
}

export function seedRng(seed: number): number[] {
  const sm = splitmix(Math.floor(seed))
  const st = [sm(), sm(), sm(), sm()]
  for (let i = 0; i < 15; i++) sfc32Next(st)
  return st
}

/** Advances `st` in place and returns a float in [0, 1). */
export function sfc32Next(st: number[]): number {
  let a = st[0]! | 0, b = st[1]! | 0, c = st[2]! | 0, d = st[3]! | 0
  const t = (((a + b) | 0) + d) | 0
  d = (d + 1) | 0
  a = b ^ (b >>> 9)
  b = (c + (c << 3)) | 0
  c = (c << 21) | (c >>> 11)
  c = (c + t) | 0
  st[0] = a >>> 0; st[1] = b >>> 0; st[2] = c >>> 0; st[3] = d >>> 0
  return (t >>> 0) / 4294967296
}

/** Integer in [lo, hi]. A forced roll (if any) is taken as the result, clamped into range. */
export function rollInt(s: State, lo: number, hi: number): number {
  if (s.forcedRolls.length > 0) {
    const f = s.forcedRolls.shift() as number
    return Math.max(lo, Math.min(hi, Math.floor(f)))
  }
  return lo + Math.floor(sfc32Next(s.rng) * (hi - lo + 1))
}
/** d100: 0-99. */
export function rollD100(s: State): number { return rollInt(s, 0, 99) }
