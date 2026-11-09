// MSN: outcome rules and the end-of-mission summary.
import type { Ctx, Outcome, State, Unit } from './types'
import { emit, isActive, tn } from './util'

function inZone(s: State, u: Unit): boolean {
  return s.map.extraction.some((p) => p.x === u.x && p.y === u.y)
}

/** MSN-2..5: evaluated after every step. */
export function checkOutcome(c: Ctx): void {
  const s = c.s
  if (s.outcome) return
  const bag = s.units.find((u) => u.kind === 'bagman')
  const able = s.units.filter((u) => u.side === 'squad' && isActive(u))
  const activeEnemies = s.units.filter((u) => u.side === 'syndicate' && isActive(u))
  let o: Outcome | null = null
  if (bag && bag.status === 'escaped') o = 'loss'
  else if (able.length === 0) o = 'loss'
  else {
    const zone = able.every((u) => inZone(s, u)) || activeEnemies.length === 0
    if (bag && bag.status === 'cuffed' && zone) o = 'win'
    else if (bag && bag.status === 'dead' && zone) o = 'partial'
  }
  if (o) {
    s.outcome = o
    emit(c, 'missionEnd', { outcome: o })
  }
}

export interface EnemyTally { arrests: number; kills: number; escapes: number; lost: number }
export interface Summary {
  outcome: Outcome | null
  rounds: number
  peakAlarm: number
  enemies: Record<string, EnemyTally>
  intel: number
  civilianCasualties: number
  civiliansSafe: number
  troopersDowned: number
  troopersDead: number
  seed: number
}

/** MSN-6. */
export function summarize(s: State): Summary {
  const enemies: Record<string, EnemyTally> = {}
  let intel = 0
  for (const u of s.units) {
    if (u.side !== 'syndicate') continue
    const t = (enemies[u.kind] ??= { arrests: 0, kills: 0, escapes: 0, lost: 0 })
    if (u.status === 'cuffed') {
      t.arrests++
      try { intel += tn(s, `intel.${u.kind}`) } catch { /* no intel value for this type */ }
    } else if (u.status === 'dead') t.kills++
    else if (u.status === 'escaped') t.escapes++
    else if (u.status === 'surrendered') t.lost++
  }
  return {
    outcome: s.outcome,
    rounds: s.round,
    peakAlarm: s.alarm,
    enemies,
    intel,
    civilianCasualties: s.units.filter((u) => u.side === 'civilians' && u.status === 'dead').length,
    civiliansSafe: s.units.filter((u) => u.side === 'civilians' && u.status === 'safe').length,
    troopersDowned: s.units.filter((u) => u.side === 'squad' && u.wasDowned).length,
    troopersDead: s.units.filter((u) => u.side === 'squad' && u.status === 'dead').length,
    seed: s.setup.seed,
  }
}
