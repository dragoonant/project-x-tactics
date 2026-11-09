// ENM-6 placeholder policy: a seeded random legal action. A pure function of the state (no hidden RNG).
import type { Action, State } from './types'
import { legalActions } from './legal'
import { sfc32Next, seedRng } from './rng'

function label(a: Action): string {
  if (a.type === 'ability') return `ability:${a.ability}`
  return a.type
}

/**
 * Picks an action category uniformly, then an action inside it uniformly, so rare actions (attacks, abilities)
 * are not drowned out by the many Move targets. `salt` lets two callers diverge on the same state.
 * `endChance` (default: uniform) is the chance of choosing endPhase when anything else is legal.
 */
export function randomAction(s: State, salt = 0, legal: Action[] = legalActions(s), endChance?: number): Action {
  const st = seedRng((s.setup.seed * 1000003 + s.steps * 7919 + salt) >>> 0)
  const groups = new Map<string, Action[]>()
  for (const a of legal) {
    const k = label(a)
    const g = groups.get(k)
    if (g) g.push(a); else groups.set(k, [a])
  }
  const keys = [...groups.keys()]
  if (keys.length === 0) return { type: 'endPhase' }
  if (endChance !== undefined && keys.length > 1) {
    if (sfc32Next(st) < endChance) return { type: 'endPhase' }
    keys.splice(keys.indexOf('endPhase'), 1)
  }
  const key = keys[Math.floor(sfc32Next(st) * keys.length)] as string
  const list = groups.get(key) as Action[]
  return list[Math.floor(sfc32Next(st) * list.length)] as Action
}
