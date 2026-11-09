// MSN: outcome rules and the end-of-mission summary. VAR: the raid objective (cache seized or burned).
import type { Ctx, Outcome, State, Unit } from './types'
import { cheb, emit, isActive, tn } from './util'

function inZone(s: State, u: Unit): boolean {
  return s.map.extraction.some((p) => p.x === u.x && p.y === u.y)
}

/** VAR-3 / VAR-4: after every step (seizing only after squad actions). Seizing is checked before burning. */
export function checkRaid(c: Ctx, squadAction: boolean): void {
  const s = c.s
  const r = s.raid
  if (!r || s.outcome || r.seized || r.burned) return
  if (squadAction) {
    const rad = tn(s, 'raid.seizeRadius')
    const by = s.units.find((u) => u.side === 'squad' && isActive(u) && cheb(u.x, u.y, r.cache.x, r.cache.y) <= rad)
    if (by) { r.seized = true; emit(c, 'cacheSeized', { unit: by.id, x: r.cache.x, y: r.cache.y }); return }
  }
  if (s.alarm >= tn(s, 'raid.burnAlarm')) { r.burned = true; emit(c, 'cacheBurned', { x: r.cache.x, y: r.cache.y, alarm: s.alarm }) }
}

/** MSN-2..5 (bust) and VAR-5 (raid): evaluated after every step. */
export function checkOutcome(c: Ctx): void {
  const s = c.s
  if (s.outcome) return
  const able = s.units.filter((u) => u.side === 'squad' && isActive(u))
  const activeEnemies = s.units.filter((u) => u.side === 'syndicate' && isActive(u))
  let o: Outcome | null = null
  if (s.raid) {
    const zone = able.length > 0 && (able.every((u) => inZone(s, u)) || activeEnemies.length === 0)
    if (able.length === 0) o = 'loss'
    else if (s.raid.seized && zone) o = 'win'
    else if (s.raid.burned && zone) o = 'partial'
  } else {
    const bag = s.units.find((u) => u.kind === 'bagman')
    if (bag && bag.status === 'escaped') o = 'loss'
    else if (able.length === 0) o = 'loss'
    else {
      const zone = able.every((u) => inZone(s, u)) || activeEnemies.length === 0
      if (bag && bag.status === 'cuffed' && zone) o = 'win'
      else if (bag && bag.status === 'dead' && zone) o = 'partial'
    }
  }
  if (o) {
    s.outcome = o
    emit(c, 'missionEnd', { outcome: o })
  }
}

export interface EnemyTally { arrests: number; kills: number; escapes: number; lost: number }
export interface Summary {
  outcome: Outcome | null
  objective: 'bust' | 'raid'
  rounds: number
  peakAlarm: number
  enemies: Record<string, EnemyTally>
  intel: number
  evidence: number
  civilianCasualties: number
  civiliansSafe: number
  troopersDowned: number
  troopersDead: number
  seed: number
}

/** MSN-6 and VAR-6. */
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
    objective: s.raid ? 'raid' : 'bust',
    rounds: s.round,
    peakAlarm: s.alarm,
    enemies,
    intel,
    evidence: s.raid?.seized ? tn(s, 'raid.evidence') : 0,
    civilianCasualties: s.units.filter((u) => u.side === 'civilians' && u.status === 'dead').length,
    civiliansSafe: s.units.filter((u) => u.side === 'civilians' && u.status === 'safe').length,
    troopersDowned: s.units.filter((u) => u.side === 'squad' && u.wasDowned).length,
    troopersDead: s.units.filter((u) => u.side === 'squad' && u.status === 'dead').length,
    seed: s.setup.seed,
  }
}
