// ABL: validation and execution of attacks and abilities (spec section 13 and friends).
import type { Action, Ctx, Pt, State, Unit } from './types'
import { dirty, inBounds, tileAt } from './grid'
import { hasLOS, lineClear, sightOrigins } from './los'
import { sees, squadsightSees } from './fog'
import { canAttackTarget, explode, isUnaware, shootLamp, weaponAttack, weaponDef } from './combat'
import { createGasCloud } from './gas'
import { cuff, inflict, rally, takedown } from './resolve'
import { attackedGroup, makeNoise, raiseAlarm } from './noise'
import { faceToward } from './move'
import { cheb, dist, emit, hasAb, tn, unitById } from './util'

/** Common precondition for every unit action. */
export function actorProblem(s: State, u: Unit | undefined): string | null {
  if (!u) return 'unknown unit'
  if (s.phase !== u.side) return `it is not the ${u.side} phase`
  if (u.status !== 'active') return `unit is ${u.status}`
  if (u.actions < 1) return 'unit has no actions left'
  if (u.side === 'syndicate' && isUnaware(s, u)) return 'unaware enemies take no actions (TURN-8)'
  return null
}

/** FOG-4: own sight, or Squadsight for the Marksman. */
export function canSeeForAttack(s: State, att: Unit, tgt: Unit): boolean {
  if (sees(s, att, tgt)) return true
  return hasAb(att, 'squadsight') && squadsightSees(s, att, tgt)
}

function rangedProblem(s: State, att: Unit, tgt: Unit, weaponId: string | null): string | null {
  const w = weaponDef(weaponId)
  if (!w || !att.armed) return 'unit has no weapon to use'
  if (!canAttackTarget(att, tgt)) return 'not a valid target'
  const d = dist(att.x, att.y, tgt.x, tgt.y)
  if (w.melee) return d <= 1 && cheb(att.x, att.y, tgt.x, tgt.y) === 1 ? null : 'melee target must be adjacent'
  if (d > w.maxRange) return 'target is out of weapon range'
  if (!canSeeForAttack(s, att, tgt)) return 'target is not seen'
  return null
}
function meleeProblem(att: Unit, tgt: Unit, weaponId: string | null): string | null {
  if (!weaponDef(weaponId) || !att.armed) return 'unit has no melee weapon'
  if (!canAttackTarget(att, tgt)) return 'not a valid target'
  if (cheb(att.x, att.y, tgt.x, tgt.y) !== 1) return 'melee target must be adjacent'
  return null
}

/** Does the thrower have a clear line to a tile (any peeking origin)? */
export function throwClear(s: State, u: Unit, at: Pt): boolean {
  return sightOrigins(s, u).some((o) => lineClear(s, o.x, o.y, at.x, at.y))
}
function grenadeProblem(s: State, u: Unit, at: Pt | undefined): string | null {
  if (!at || !Number.isInteger(at.x) || !Number.isInteger(at.y)) return 'needs a target tile'
  const t = tileAt(s, at.x, at.y)
  if (!t || t.k === 'wall') return 'invalid target tile'
  if (dist(u.x, u.y, at.x, at.y) > tn(s, 'grenade.range')) return 'target tile is out of grenade range'
  if (!throwClear(s, u, at)) return 'no clear line to the target tile'
  return null
}

function targetOf(s: State, a: { target?: string }): Unit | undefined {
  return typeof a.target === 'string' ? unitById(s, a.target) : undefined
}

export function abilityCost(u: Unit, ability: string): number {
  if (ability === 'cuff' && hasAb(u, 'quickCuffs') && !u.cuffFreeUsed) return 0
  return 1
}
const ENDS_TURN = new Set(['overwatch', 'longWatch', 'hunker', 'suppress', 'frag', 'breach', 'shieldBash', 'maul', 'baton', 'pinningShot', 'gas', 'takedown'])
export function endsTurn(ability: string): boolean { return ENDS_TURN.has(ability) }

export const SUPPORT_OPTIONS = ['scan', 'smoke', 'spotlight']

/** Validates an `attack` action. */
export function attackProblem(s: State, a: Extract<Action, { type: 'attack' }>): string | null {
  const u = unitById(s, a.unit)
  const p = actorProblem(s, u)
  if (p) return p
  const me = u as Unit
  if (a.at !== undefined) {
    if (!a.at || !Number.isInteger(a.at.x) || !Number.isInteger(a.at.y)) return 'bad lamp tile'
    const t = tileAt(s, a.at.x, a.at.y)
    const w = weaponDef(me.weapon)
    if (!t || t.o !== 'lamp') return 'no lamp on that tile'
    if (!w || w.melee || !me.armed) return 'unit has no ranged weapon'
    if (dist(me.x, me.y, a.at.x, a.at.y) > w.maxRange) return 'lamp is out of weapon range'
    if (!hasLOS(s, me, a.at)) return 'no line of sight to the lamp'
    return null
  }
  const t = targetOf(s, a)
  if (!t) return 'unknown target'
  return rangedProblem(s, me, t, me.weapon)
}

export function runAttack(c: Ctx, a: Extract<Action, { type: 'attack' }>): void {
  const s = c.s
  const u = unitById(s, a.unit)!
  u.actions = 0
  if (a.at !== undefined) {
    faceToward(u, a.at.x, a.at.y)
    emit(c, 'attackAction', { unit: u.id, at: a.at })
    shootLamp(c, u, a.at, u.weapon!)
    return
  }
  const t = targetOf(s, a)!
  faceToward(u, t.x, t.y)
  emit(c, 'attackAction', { unit: u.id, target: t.id })
  weaponAttack(c, u, t, { weapon: u.weapon!, kind: 'attack' })
}

/** Validates an `ability` action (ownership, targets, costs). Returns a reason or null. */
export function abilityProblem(s: State, a: Extract<Action, { type: 'ability' }>): string | null {
  const u = unitById(s, a.unit)
  const p = actorProblem(s, u)
  if (p) return p
  const me = u as Unit
  if (typeof a.ability !== 'string' || !me.abilities.includes(a.ability)) return 'unit does not have that ability'
  const t = targetOf(s, a)
  switch (a.ability) {
    case 'overwatch':
    case 'longWatch': {
      const w = weaponDef(me.weapon)
      return w && !w.melee && me.armed ? null : 'needs a ranged weapon'
    }
    case 'hunker': return null
    case 'cuff':
      if (!t) return 'unknown target'
      if (cheb(me.x, me.y, t.x, t.y) !== 1) return 'target must be adjacent'
      return t.side === 'syndicate' && t.status === 'surrendered' ? null : 'target is not a surrendered enemy'
    case 'takedown':
      if (!t) return 'unknown target'
      if (t.side !== 'syndicate' || t.status !== 'active') return 'target is not an active enemy'
      if (cheb(me.x, me.y, t.x, t.y) !== 1) return 'target must be adjacent'
      return isUnaware(s, t) ? null : 'target is alert: a takedown needs an unaware enemy'
    case 'stabilize':
      if (!t) return 'unknown target'
      if (t.side !== 'squad' || t.status !== 'downed') return 'target is not a downed trooper'
      if (cheb(me.x, me.y, t.x, t.y) === 1) return null
      if (hasAb(me, 'fieldMedic') && dist(me.x, me.y, t.x, t.y) <= tn(s, 'stabilize.chemRange') && hasLOS(s, me, t)) return null
      return 'target is too far to stabilize'
    case 'suppress':
      if (!t) return 'unknown target'
      return rangedProblem(s, me, t, me.weapon)
    case 'frag':
      if ((me.uses.frag ?? 0) < 1) return 'no frag grenades left'
      return grenadeProblem(s, me, a.at)
    case 'gas':
      if ((me.uses.gas ?? 0) < 1) return 'no gas grenades left'
      return grenadeProblem(s, me, a.at)
    case 'breach': {
      if (!a.at || !Number.isInteger(a.at.x) || !Number.isInteger(a.at.y)) return 'needs a door tile'
      const dt = tileAt(s, a.at.x, a.at.y)
      if (!dt || dt.k !== 'door' || dt.open) return 'target is not a closed door'
      if (Math.abs(me.x - a.at.x) + Math.abs(me.y - a.at.y) !== 1) return 'must be orthogonally adjacent to the door'
      return null
    }
    case 'shieldBash':
      if (!t) return 'unknown target'
      return meleeProblem(me, t, me.melee)
    case 'maul':
    case 'baton':
      if (!t) return 'unknown target'
      return meleeProblem(me, t, me.melee)
    case 'pinningShot':
      if (!t) return 'unknown target'
      return rangedProblem(s, me, t, me.weapon)
    case 'relay':
      if (me.relayUsed) return 'Relay Orders already used this phase'
      if (!t || t.id === me.id || t.side !== 'squad' || t.status !== 'active') return 'needs another active trooper'
      return sees(s, me, t) ? null : 'target trooper is not seen'
    case 'callSupport': {
      if (s.supportCharges < 1) return 'no support charges left'
      if (!SUPPORT_OPTIONS.includes(a.option ?? '')) return 'option must be scan, smoke or spotlight'
      if (!a.at || !Number.isInteger(a.at.x) || !Number.isInteger(a.at.y) || !inBounds(s, a.at.x, a.at.y)) return 'needs a target tile'
      return dist(me.x, me.y, a.at.x, a.at.y) <= tn(s, 'support.range') ? null : 'target tile is out of support range'
    }
    case 'stim': {
      if ((me.uses.stim ?? 0) < 1) return 'no stims left'
      const tt = t ?? me
      if (tt.side !== 'squad' || tt.status !== 'active') return 'target must be an able trooper'
      if (cheb(me.x, me.y, tt.x, tt.y) > 1) return 'target must be adjacent or self'
      if (a.option === 'heal') return tt.hp < tt.maxHp ? null : 'target is at full health'
      if (a.option === 'action') return null
      return 'option must be heal or action'
    }
    case 'mark':
      if (!t) return 'unknown target'
      if (t.side !== 'syndicate' || (t.status !== 'active' && t.status !== 'surrendered')) return 'target is not a visible enemy'
      return sees(s, me, t) ? null : 'target is not seen'
    case 'rally':
      if (!t || t.id === me.id) return 'unknown target'
      if (t.side !== 'syndicate' || t.status !== 'surrendered') return 'target is not a surrendered ally'
      if (dist(me.x, me.y, t.x, t.y) > tn(s, 'rally.range')) return 'target is out of Rally range'
      return hasLOS(s, me, t) ? null : 'no line of sight to the target'
    default:
      return 'unknown ability'
  }
}

export function runAbility(c: Ctx, a: Extract<Action, { type: 'ability' }>): void {
  const s = c.s
  const u = unitById(s, a.unit)!
  const t = targetOf(s, a)
  const cost = abilityCost(u, a.ability)
  u.actions -= cost
  emit(c, 'ability', { unit: u.id, ability: a.ability, target: a.target ?? null, at: a.at ?? null, option: a.option ?? null, cost })
  if (t) faceToward(u, t.x, t.y)
  else if (a.at) faceToward(u, a.at.x, a.at.y)
  switch (a.ability) {
    case 'overwatch': u.overwatch = 'overwatch'; break
    case 'longWatch': u.overwatch = 'longWatch'; break
    case 'hunker': u.hunkered = true; break
    case 'cuff':
      if (cost === 0) u.cuffFreeUsed = true
      cuff(c, u, t!)
      break
    case 'takedown':
      takedown(c, u, t!)
      break
    case 'stabilize':
      t!.status = 'stabilized'
      emit(c, 'stabilized', { unit: t!.id, by: u.id })
      break
    case 'suppress': {
      t!.suppressedBy = u.id
      t!.suppressReacted = false
      emit(c, 'suppressed', { unit: t!.id, by: u.id })
      if (t!.side === 'syndicate') {
        inflict(c, t!, { hp: 0, res: tn(s, 'suppress.resolveNow'), mults: false, cause: 'suppress' })
      }
      makeNoise(c, { x: u.x, y: u.y }, true, u, 'suppress')
      // NOI-5 for squad suppression
      attackedGroup(c, u, t!)
      break
    }
    case 'frag':
      u.uses.frag = (u.uses.frag ?? 0) - 1
      explode(c, u, a.at!)
      break
    case 'gas':
      u.uses.gas = (u.uses.gas ?? 0) - 1
      createGasCloud(c, a.at!)
      break
    case 'breach': {
      const dt = tileAt(s, a.at!.x, a.at!.y)!
      dt.open = true
      dirty(s)
      emit(c, 'doorOpened', { x: a.at!.x, y: a.at!.y, by: u.id })
      const w = weaponDef(u.weapon)
      let best: Unit | null = null
      let bestD = Infinity
      if (w && !w.melee && u.armed) {
        for (const e of s.units) {
          if (!canAttackTarget(u, e) || e.status !== 'active') continue
          const d = dist(u.x, u.y, e.x, e.y)
          if (d > w.maxRange || !canSeeForAttack(s, u, e)) continue
          if (d < bestD || (d === bestD && best && e.id < best.id)) { best = e; bestD = d }
        }
      }
      if (best) {
        faceToward(u, best.x, best.y)
        weaponAttack(c, u, best, { weapon: u.weapon!, kind: 'breach', extraAim: { name: 'breach', value: tn(s, 'breach.aim') } })
      } else {
        makeNoise(c, { x: u.x, y: u.y }, true, u, 'breach')
      }
      break
    }
    case 'shieldBash':
      weaponAttack(c, u, t!, { weapon: u.melee!, kind: 'shieldBash', melee: true, fixedDamage: tn(s, 'bash.damage'), resolve: tn(s, 'bash.resolve'), onHit: 'stun' }, true)
      break
    case 'maul':
    case 'baton':
      weaponAttack(c, u, t!, { weapon: u.melee!, kind: a.ability, melee: true })
      break
    case 'pinningShot':
      weaponAttack(c, u, t!, { weapon: u.weapon!, kind: 'pinningShot', fixedDamage: tn(s, 'pin.damage'), resolve: tn(s, 'pin.resolve'), onHit: 'pin' }, true)
      break
    case 'relay':
      u.relayUsed = true
      t!.actions += 1
      emit(c, 'relay', { unit: u.id, target: t!.id })
      break
    case 'callSupport': {
      s.supportCharges -= 1
      const at = a.at!
      if (a.option === 'scan') s.scans.push({ x: at.x, y: at.y, r: tn(s, 'scan.radius'), t: tn(s, 'scan.duration') })
      else if (a.option === 'smoke') s.smoke.push({ x: at.x, y: at.y, r: 1, t: tn(s, 'smoke.duration') })
      else s.spotlights.push({ x: at.x, y: at.y, r: tn(s, 'spotlight.radius'), t: tn(s, 'spotlight.duration') })
      dirty(s)
      emit(c, 'support', { option: a.option, at })
      raiseAlarm(c, tn(s, 'alarm.supportCall'), 'support call')
      break
    }
    case 'stim': {
      u.uses.stim = (u.uses.stim ?? 0) - 1
      const tt = t ?? u
      if (a.option === 'heal') {
        const before = tt.hp
        tt.hp = Math.min(tt.maxHp, tt.hp + tn(s, 'stim.heal'))
        emit(c, 'heal', { unit: tt.id, hp: tt.hp - before })
      } else { tt.actions += 1; emit(c, 'bonusAction', { unit: tt.id }) }
      break
    }
    case 'mark':
      t!.marked = tn(s, 'mark.duration')
      emit(c, 'marked', { unit: t!.id, by: u.id })
      break
    case 'rally':
      rally(c, u, t!)
      break
  }
  if (endsTurn(a.ability)) u.actions = 0
}

