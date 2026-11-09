// TURN: phase start, end of phase, civilian phase and end of round.
import type { Ctx, Side } from './types'
import { dirty } from './grid'
import { civilianPhase } from './civilians'
import { applyGasDamage } from './gas'
import { fleePhase, inflict } from './resolve'
import { raiseAlarm } from './noise'
import { emit, isActive, tn, unitById } from './util'

/** TURN-3: give each able unit of the side its actions and reset per-phase state. */
export function startPhase(c: Ctx, side: 'squad' | 'syndicate'): void {
  const s = c.s
  // SPR-1: suppression ends at the start of the suppressor's next phase.
  for (const u of s.units) {
    if (!u.suppressedBy) continue
    const sup = unitById(s, u.suppressedBy)
    if (!sup || sup.side === side) { u.suppressedBy = null; u.suppressReacted = false }
  }
  for (const u of s.units) {
    if (u.side !== side) continue
    u.actions = isActive(u) ? Math.max(0, tn(s, 'actions.perPhase') - (u.stunned ? 1 : 0)) : 0
    u.stunned = false
    u.noMove = u.pinned
    u.pinned = false
    u.overwatch = null
    u.hunkered = false
    u.relayUsed = false
    u.cuffFreeUsed = false
  }
  emit(c, 'phaseStart', { side })
  if (side === 'syndicate') {
    applyGasDamage(c) // GAS-2
    for (const u of s.units) {
      if (u.side === 'syndicate' && isActive(u) && u.suppressedBy) {
        inflict(c, u, { hp: 0, res: tn(s, 'suppress.resolvePerPhase'), mults: false, cause: 'suppress' })
      }
    }
    fleePhase(c) // ARR-1/2
  }
}

function endOfRound(c: Ctx): void {
  const s = c.s
  raiseAlarm(c, tn(s, 'alarm.perRound'), 'end of round') // ALM-2
  s.gas = s.gas.map((g) => ({ ...g, t: g.t - 1 })).filter((g) => g.t > 0)
  const nSm = s.smoke.length, nSp = s.spotlights.length
  s.smoke = s.smoke.map((g) => ({ ...g, t: g.t - 1 })).filter((g) => g.t > 0)
  s.scans = s.scans.map((g) => ({ ...g, t: g.t - 1 })).filter((g) => g.t > 0)
  s.spotlights = s.spotlights.map((g) => ({ ...g, t: g.t - 1 })).filter((g) => g.t > 0)
  if (nSm !== s.smoke.length || nSp !== s.spotlights.length) dirty(s)
  for (const u of s.units) if (u.marked > 0) u.marked -= 1
  for (const u of s.units) {
    if (u.side === 'squad' && u.status === 'downed') {
      u.bleed -= 1
      emit(c, 'bleed', { unit: u.id, left: u.bleed })
      if (u.bleed <= 0) { u.status = 'dead'; emit(c, 'death', { unit: u.id, cause: 'bleedOut' }) }
    }
  }
}

/** TURN-6: end the acting side's phase; the syndicate's endPhase also runs civilians and end of round. */
export function endPhase(c: Ctx): void {
  const s = c.s
  const side: Side = s.phase
  for (const u of s.units) if (u.side === side) u.actions = 0
  emit(c, 'phaseEnd', { side })
  if (side === 'squad') {
    s.phase = 'syndicate'
    startPhase(c, 'syndicate')
    return
  }
  s.phase = 'civilians'
  emit(c, 'phaseStart', { side: 'civilians' })
  civilianPhase(c)
  endOfRound(c)
  emit(c, 'roundEnd', { round: s.round, alarm: s.alarm })
  s.round += 1
  s.phase = 'squad'
  startPhase(c, 'squad')
}
