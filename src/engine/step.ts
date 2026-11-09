// ARCH-2 step: the pure reducer. Never throws; illegal actions return { ok: false, reason }.
import type { Action, Ctx, State, StepResult } from './types'
import { abilityProblem, actorProblem, attackProblem, runAbility, runAttack } from './abilities'
import { checkMove, runMove } from './move'
import { endPhase } from './phase'
import { checkSight } from './noise'
import { updateKnowledge } from './fog'
import { checkOutcome } from './mission'
import { unitById } from './util'

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n)
const isPt = (p: unknown): boolean => !!p && typeof p === 'object' && isInt((p as { x: unknown }).x) && isInt((p as { y: unknown }).y)

/** Returns a reason when the action is illegal in this state, else null. */
export function actionProblem(s: State, a: unknown): string | null {
  if (s.outcome) return 'the game is over'
  if (!a || typeof a !== 'object') return 'action must be an object'
  const act = a as Record<string, unknown>
  switch (act.type) {
    case 'endPhase':
      return s.phase === 'squad' || s.phase === 'syndicate' ? null : 'cannot end this phase'
    case 'move': {
      if (typeof act.unit !== 'string') return 'move needs a unit id'
      if (!isPt(act.to)) return 'move needs integer destination {x, y}'
      const u = unitById(s, act.unit)
      const p = actorProblem(s, u)
      if (p) return p
      return checkMove(s, u!, act.to as { x: number; y: number }).reason
    }
    case 'attack': {
      if (typeof act.unit !== 'string') return 'attack needs a unit id'
      if (act.target !== undefined && typeof act.target !== 'string') return 'attack target must be a unit id'
      if (act.target === undefined && act.at === undefined) return 'attack needs a target or a lamp tile'
      if (act.at !== undefined && !isPt(act.at)) return 'attack tile must be {x, y}'
      return attackProblem(s, act as Extract<Action, { type: 'attack' }>)
    }
    case 'ability': {
      if (typeof act.unit !== 'string') return 'ability needs a unit id'
      if (typeof act.ability !== 'string') return 'ability needs an ability id'
      if (act.target !== undefined && typeof act.target !== 'string') return 'target must be a unit id'
      if (act.option !== undefined && typeof act.option !== 'string') return 'option must be a string'
      if (act.at !== undefined && !isPt(act.at)) return 'tile must be {x, y}'
      return abilityProblem(s, act as Extract<Action, { type: 'ability' }>)
    }
    default:
      return 'unknown action type'
  }
}

export function step(state: State, action: Action): StepResult {
  try {
    const problem = actionProblem(state, action)
    if (problem) return { ok: false, reason: problem }
    const { log, ...rest } = state
    const s = structuredClone(rest) as State
    const clean = JSON.parse(JSON.stringify(action)) as Action
    s.log = [...log, clean]
    s.steps = state.steps + 1
    const c: Ctx = { s, ev: [] }
    switch (clean.type) {
      case 'endPhase':
        endPhase(c)
        break
      case 'move':
        runMove(c, unitById(s, clean.unit)!, checkMove(s, unitById(s, clean.unit)!, clean.to).path)
        break
      case 'attack':
        runAttack(c, clean)
        break
      case 'ability':
        runAbility(c, clean)
        break
    }
    if (clean.type !== 'endPhase' && s.phase === 'squad') checkSight(c)
    updateKnowledge(c)
    checkOutcome(c)
    return { ok: true, state: s, events: c.ev }
  } catch (e) {
    return { ok: false, reason: `internal error: ${(e as Error).message}` }
  }
}
