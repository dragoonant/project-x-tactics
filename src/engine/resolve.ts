// DMG health/Resolve application, RES (surrender, ripple), ARR (cuff, flee, rally), DWN (downed).
import type { Ctx, Unit } from './types'
import { bfs, distField, pathFrom, tilesOfKind } from './grid'
import { hasLOS } from './los'
import { dist, emit, isActive, tn } from './util'

export interface Inflict {
  hp: number
  res: number
  /** DMG-3: apply the Mark and wounded multipliers to Resolve damage. */
  mults: boolean
  /** RES-4: ripple on death / surrender (false for ripple damage itself). */
  ripple?: boolean
  cause?: string
}

/** Applies health damage first, then Resolve damage, then status changes. */
export function inflict(c: Ctx, t: Unit, o: Inflict): void {
  const s = c.s
  if (t.status === 'dead' || t.status === 'escaped' || t.status === 'safe') return
  const hpBefore = t.hp
  if (o.hp > 0) t.hp = Math.max(0, t.hp - o.hp)
  let resDealt = 0
  if (t.side === 'syndicate' && o.res > 0 && t.maxResolve > 0) {
    let r = o.res
    if (o.mults) {
      if (t.marked > 0) r = Math.ceil(r * tn(s, 'mark.resolveMult'))
      if (t.hp > 0 && t.hp * 2 < t.maxHp) r = r * tn(s, 'resolve.woundedMult')
    }
    const before = t.resolve
    t.resolve = Math.max(0, t.resolve - r)
    resDealt = before - t.resolve
  }
  if (o.hp > 0 || resDealt > 0) {
    emit(c, 'damage', { target: t.id, hp: hpBefore - t.hp, hpLeft: t.hp, resolve: resDealt, resolveLeft: t.resolve, cause: o.cause ?? null })
  }
  if (t.side === 'civilians') {
    if (t.hp <= 0) { t.status = 'dead'; emit(c, 'civilianCasualty', { unit: t.id }) }
    return
  }
  if (t.side === 'squad') {
    if (t.status === 'active' && t.hp <= 0) {
      t.status = 'downed'; t.bleed = tn(s, 'downed.bleedOut'); t.actions = 0; t.overwatch = null; t.wasDowned = true
      emit(c, 'downed', { unit: t.id, bleed: t.bleed })
    } else if ((t.status === 'downed' || t.status === 'stabilized') && o.hp > 0) {
      t.status = 'dead'; emit(c, 'death', { unit: t.id })
    }
    return
  }
  // syndicate
  if (t.hp <= 0) {
    killEnemy(c, t, o.ripple !== false)
  } else if (t.resolve <= 0 && t.maxResolve > 0 && t.status === 'active') {
    t.status = 'surrendered'; t.armed = false; t.actions = 0; t.overwatch = null; t.hunkered = false
    emit(c, 'surrender', { unit: t.id })
    if (o.ripple !== false) ripple(c, t)
  }
}

function killEnemy(c: Ctx, t: Unit, doRipple: boolean): void {
  t.status = 'dead'; t.actions = 0; t.overwatch = null
  emit(c, 'death', { unit: t.id })
  if (doRipple) ripple(c, t)
}

/** RES-4: nearby active enemies with LOS to the unit lose Resolve; ripples don't chain. */
export function ripple(c: Ctx, src: Unit): void {
  const s = c.s
  const r = tn(s, 'resolve.rippleRadius')
  for (const u of s.units) {
    if (u === src || u.side !== 'syndicate' || !isActive(u)) continue
    if (dist(u.x, u.y, src.x, src.y) > r || !hasLOS(s, u, src)) continue
    emit(c, 'ripple', { source: src.id, unit: u.id })
    inflict(c, u, { hp: 0, res: tn(s, 'resolve.ripple'), mults: false, ripple: false, cause: 'ripple' })
  }
}

/** ARR-3: cuff a surrendered enemy. */
export function cuff(c: Ctx, by: Unit, t: Unit): void {
  t.status = 'cuffed'; t.armed = false; t.actions = 0; t.fleeing = false
  emit(c, 'cuffed', { unit: t.id, by: by.id })
  ripple(c, t)
}

/** ARR-1/2: surrendered, uncuffed enemies with no covering trooper bolt for the nearest exit. */
export function fleePhase(c: Ctx): void {
  const s = c.s
  const exits = tilesOfKind(s, 'exit')
  if (exits.length === 0) return
  const field = distField(s, exits)
  const cr = tn(s, 'arrest.coverRadius')
  for (const u of s.units) {
    if (u.side !== 'syndicate' || u.status !== 'surrendered') continue
    const covered = s.units.some((t) => t.side === 'squad' && isActive(t) && dist(t.x, t.y, u.x, u.y) <= cr && hasLOS(s, t, u))
    if (covered) { emit(c, 'holdsSurrender', { unit: u.id }); continue }
    const b = bfs(s, u.x, u.y, u.mobility)
    const w = s.map.w
    let best = -1
    let bestD = field[u.y * w + u.x] as number
    for (let i = 0; i < b.cost.length; i++) {
      if ((b.cost[i] as number) < 1) continue
      const d = field[i] as number
      if (d === -1) continue
      if (d < bestD || (d === bestD && best !== -1 && (b.cost[i] as number) < (b.cost[best] as number))) { best = i; bestD = d }
    }
    if (best === -1) { emit(c, 'fleeBlocked', { unit: u.id }); continue }
    const tx = best % w, ty = (best - tx) / w
    const path = pathFrom(s, b, tx, ty)
    u.x = tx; u.y = ty
    emit(c, 'flee', { unit: u.id, path })
    if (s.map.tiles[best]!.k === 'exit') { u.status = 'escaped'; emit(c, 'escaped', { unit: u.id, via: 'exit' }) }
  }
}

/** ENM-4: Fixer rally. */
export function rally(c: Ctx, fixer: Unit, t: Unit): void {
  t.resolve = Math.ceil(t.maxResolve / 2)
  t.status = 'active'; t.armed = true
  emit(c, 'rally', { unit: t.id, by: fixer.id, resolve: t.resolve })
}
