// GAS: clouds, per-phase Resolve damage, civilian panic.
import type { Ctx, Pt } from './types'
import { inCloud } from './grid'
import { panicAround } from './civilians'
import { inflict } from './resolve'
import { emit, isActive, tn } from './util'

/** GAS-2 / GAS-4: each non-immune active enemy standing in any gas tile takes the Resolve damage once. */
export function applyGasDamage(c: Ctx): void {
  const s = c.s
  if (s.gas.length === 0) return
  for (const u of s.units) {
    if (u.side !== 'syndicate' || !isActive(u) || u.gasImmune) continue
    if (!inCloud(s, s.gas, u.x, u.y)) continue
    emit(c, 'gasDamage', { unit: u.id })
    inflict(c, u, { hp: 0, res: tn(s, 'gas.resolve'), mults: false, cause: 'gas' })
  }
}

/** GAS-1 / GAS-5. */
export function createGasCloud(c: Ctx, at: Pt): void {
  const s = c.s
  s.gas.push({ x: at.x, y: at.y, r: 1, t: tn(s, 'gas.duration') })
  emit(c, 'gasCloud', { at, duration: tn(s, 'gas.duration') })
  panicAround(c, at.x, at.y, tn(s, 'civilian.gasPanicRadius'), 'gas')
  applyGasDamage(c)
}
