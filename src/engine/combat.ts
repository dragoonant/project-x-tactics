// HIT / DMG: hit chance with a full breakdown, attack resolution, grenades and explosions.
import { WEAPONS, type WeaponDef } from '../data'
import type { Ctx, HitBreakdown, Pt, State, Unit } from './types'
import { coverAgainst, chipCover, destroyLamp, explodeTerrain } from './cover'
import { inCloud } from './grid'
import { inflict } from './resolve'
import { rollD100, rollInt } from './rng'
import { cheb, dist, emit, isActive, onBoard, tn } from './util'
import { makeNoise, raiseAlarm, attackedGroup } from './noise'
import { panicAround } from './civilians'

export function weaponDef(id: string | null): WeaponDef | null { return id ? (WEAPONS[id] ?? null) : null }

/** Range modifier from a weapon's band table plus falloff beyond the last band. */
export function rangeMod(w: WeaponDef, d: number): number {
  if (w.melee) return 0
  let mod = 0
  for (const b of w.bands) if (d >= b.from && d <= b.to) mod = b.mod
  if (d > w.falloff.after) mod -= w.falloff.perTile * (d - w.falloff.after)
  return mod
}

export function isUnaware(s: State, u: Unit): boolean {
  if (!u.group) return false
  const g = s.groups.find((x) => x.id === u.group)
  return !!g && !g.aware
}

export interface AttackOpts {
  weapon: string
  overwatch?: boolean
  extraAim?: { name: string; value: number }
  melee?: boolean
}

/** HIT-1..5 (and COV): the chance with its full breakdown. */
export function hitBreakdown(s: State, att: Unit, tgt: Unit, o: AttackOpts): HitBreakdown {
  const w = weaponDef(o.weapon)!
  const melee = o.melee ?? w.melee
  const d = dist(att.x, att.y, tgt.x, tgt.y)
  const cov = coverAgainst(s, tgt, att.x, att.y)
  const mods: { name: string; value: number }[] = []
  if (tgt.marked > 0 && att.side === 'squad') mods.push({ name: 'mark', value: tn(s, 'mark.aim') })
  if (isUnaware(s, tgt)) mods.push({ name: 'ambush', value: tn(s, 'ambush.aim') })
  if (o.overwatch) mods.push({ name: 'overwatch', value: -tn(s, 'overwatch.aimPenalty') })
  if (att.suppressedBy) mods.push({ name: 'suppressed', value: -tn(s, 'suppress.aimPenalty') })
  if (!att.gasImmune && inCloud(s, s.gas, att.x, att.y)) mods.push({ name: 'gas', value: -tn(s, 'gas.aimPenalty') })
  if (o.extraAim) mods.push(o.extraAim)
  const aim = melee ? tn(s, 'melee.base') : att.aim
  const range = melee ? 0 : rangeMod(w, d)
  const coverValue = melee ? 0 : cov.value
  const raw = aim + range + mods.reduce((a, m) => a + m.value, 0) - coverValue - tgt.defense
  const chance = Math.max(tn(s, 'hit.min'), Math.min(tn(s, 'hit.max'), raw))
  const grazeTop = Math.min(100, chance + tn(s, 'hit.grazeBand'))
  return {
    attacker: att.id, target: tgt.id, weapon: o.weapon, distance: d, melee, auto: false,
    aim, range, mods,
    cover: { level: cov.level, value: coverValue, flanked: cov.flanked, hunkered: cov.hunkered, source: cov.source },
    defence: tgt.defense, raw, chance, grazeChance: grazeTop - chance, missChance: 100 - grazeTop,
  }
}

export interface AttackSpec extends AttackOpts {
  kind: string
  /** Fixed health damage instead of the weapon's range (Pinning Shot, Shield Bash). */
  fixedDamage?: number
  /** Resolve damage override (ability value instead of the weapon's). */
  resolve?: number
  onHit?: 'pin' | 'stun'
}

export interface AttackResult { outcome: 'hit' | 'graze' | 'miss'; breakdown: HitBreakdown; roll: number }

/** Rolls and applies one weapon attack (HIT-3, DMG-1..6, DST-2). Noise and group effects are the caller's job. */
export function resolveAttack(c: Ctx, att: Unit, tgt: Unit, spec: AttackSpec): AttackResult {
  const s = c.s
  const w = weaponDef(spec.weapon)!
  const bd = hitBreakdown(s, att, tgt, spec)
  const roll = rollD100(s)
  const outcome: 'hit' | 'graze' | 'miss' = roll < bd.chance ? 'hit' : roll < bd.chance + tn(s, 'hit.grazeBand') ? 'graze' : 'miss'
  emit(c, 'attack', { attacker: att.id, target: tgt.id, via: spec.kind, weapon: spec.weapon, breakdown: bd, roll, outcome })
  if (outcome !== 'miss') {
    const base = spec.fixedDamage ?? rollInt(s, w.damage[0], w.damage[1])
    let dmg = outcome === 'graze' ? Math.ceil(base / 2) : base
    let res = spec.resolve ?? w.resolve
    if (bd.cover.flanked) { dmg += tn(s, 'flank.damage'); res += tn(s, 'flank.resolve') }
    inflict(c, tgt, { hp: dmg, res, mults: true, cause: spec.kind })
    if (onBoard(tgt) && tgt.status !== 'dead' && spec.onHit === 'pin') { tgt.pinned = true; emit(c, 'pinned', { unit: tgt.id }) }
    if (onBoard(tgt) && tgt.status !== 'dead' && spec.onHit === 'stun') { tgt.stunned = true; emit(c, 'stunned', { unit: tgt.id }) }
  } else {
    inflict(c, tgt, { hp: 0, res: tn(s, 'resolve.shotAt'), mults: false, cause: 'shotAt' })
    if (!bd.melee) {
      const cov = coverAgainst(s, tgt, att.x, att.y)
      if (cov.source === 'object' && cov.at) chipCover(c, cov.at.x, cov.at.y, 1)
      strayShot(c, tgt, w)
    }
  }
  return { outcome, breakdown: bd, roll }
}

/** DMG-6: a missed ranged attack may hit a civilian next to the target. */
function strayShot(c: Ctx, tgt: Unit, w: WeaponDef): void {
  const s = c.s
  const civs = s.units.filter((u) => u.side === 'civilians' && isActive(u) && cheb(u.x, u.y, tgt.x, tgt.y) === 1).sort((a, b) => (a.id < b.id ? -1 : 1))
  const civ = civs[0]
  if (!civ) return
  const r = rollD100(s)
  const hit = r < tn(s, 'civilian.strayChance')
  emit(c, 'strayRoll', { civilian: civ.id, roll: r, chance: tn(s, 'civilian.strayChance'), hit })
  if (!hit) return
  const dmg = rollInt(s, w.damage[0], w.damage[1])
  inflict(c, civ, { hp: dmg, res: 0, mults: false, cause: 'stray' })
}

/** Full weapon attack by a unit: roll, noise, group reaction. Returns the result. */
export function weaponAttack(c: Ctx, att: Unit, tgt: Unit, spec: AttackSpec, quietOverride?: boolean): AttackResult {
  const w = weaponDef(spec.weapon)!
  const res = resolveAttack(c, att, tgt, spec)
  const loud = quietOverride === undefined ? w.noise === 'loud' : !quietOverride
  makeNoise(c, { x: att.x, y: att.y }, loud, att, spec.kind)
  attackedGroup(c, att, tgt)
  return res
}

/** HIT-4: attack on a lamp (LGT-3). Always hits; noise follows the weapon. */
export function shootLamp(c: Ctx, att: Unit, at: Pt, weapon: string): void {
  const w = weaponDef(weapon)!
  emit(c, 'lampShot', { attacker: att.id, at, weapon })
  destroyLamp(c, at.x, at.y)
  makeNoise(c, { x: att.x, y: att.y }, w.noise === 'loud', att, 'lamp')
}

/** ABL-RCT-2: frag explosion (radius 1 square). */
export function explode(c: Ctx, thrower: Unit, at: Pt): void {
  const s = c.s
  emit(c, 'explosion', { at, by: thrower.id })
  const targets = s.units.filter((u) => onBoard(u) && cheb(u.x, u.y, at.x, at.y) <= 1)
  for (const u of targets) {
    inflict(c, u, { hp: tn(s, 'frag.damage'), res: tn(s, 'frag.resolve'), mults: true, cause: 'frag' })
    attackedGroup(c, thrower, u)
  }
  explodeTerrain(c, at.x, at.y, 1)
  panicAround(c, at.x, at.y, tn(s, 'civilian.panicRadius'), 'explosion')
  makeNoise(c, at, true, thrower, 'frag')
  if (thrower.side === 'squad') raiseAlarm(c, tn(s, 'alarm.explosion'), 'explosion')
}

export function canAttackTarget(att: Unit, tgt: Unit): boolean {
  if (att.side === 'squad') return tgt.side === 'syndicate' && (tgt.status === 'active' || tgt.status === 'surrendered')
  if (att.side === 'syndicate') return tgt.side === 'squad' && tgt.status === 'active'
  return false
}
export { isActive }
