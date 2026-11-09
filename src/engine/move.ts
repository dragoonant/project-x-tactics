// MOVE / OW / SPR: movement, door opening, step-by-step reactions.
import type { Ctx, Pt, State, Unit } from './types'
import { bfs, dirty, distField, inBounds, pathFrom, tileAt, tilesOfKind } from './grid'
import { sees, squadsightSees } from './fog'
import { checkSight } from './noise'
import { weaponAttack, weaponDef } from './combat'
import { dist, emit, isActive } from './util'

export function faceToward(u: Unit, x: number, y: number): void {
  const dx = x - u.x, dy = y - u.y
  if (dx === 0 && dy === 0) return
  if (Math.abs(dx) >= Math.abs(dy)) u.facing = { x: Math.sign(dx), y: 0 }
  else u.facing = { x: 0, y: Math.sign(dy) }
}

/** Static distance field to the escape tile (ENM-5), or null when the map has none. */
export function escapeField(s: State): Int16Array | null {
  const esc = tilesOfKind(s, 'escape')
  return esc.length ? distField(s, esc) : null
}

export interface MoveCheck { reason: string | null; path: Pt[] }

/** MOVE-4 / ENM-5 / pinned: validates a move and returns the canonical path. */
export function checkMove(s: State, u: Unit, to: Pt): MoveCheck {
  const fail = (reason: string): MoveCheck => ({ reason, path: [] })
  if (!inBounds(s, to.x, to.y)) return fail('destination is off the map')
  if (u.noMove) return fail('unit is pinned and cannot move this phase')
  if (to.x === u.x && to.y === u.y) return fail('already on that tile')
  const b = bfs(s, u.x, u.y, u.mobility)
  const cost = b.cost[to.y * s.map.w + to.x] as number
  if (cost < 1) return fail('destination is not reachable within mobility')
  if (u.fleeing && u.kind === 'bagman') {
    const f = escapeField(s)
    if (f && (f[to.y * s.map.w + to.x] as number) >= (f[u.y * s.map.w + u.x] as number)) return fail('the Bagman is fleeing: moves must end closer to the escape tile')
  }
  return { reason: null, path: pathFrom(s, b, to.x, to.y) }
}

function stepSees(s: State, o: Unit, mover: Unit): boolean {
  return o.overwatch === 'longWatch' ? sees(s, o, mover) || squadsightSees(s, o, mover) : sees(s, o, mover)
}

/** OW-2/3 and SPR-1: reaction shots after a step. */
function reactions(c: Ctx, mover: Unit): void {
  const s = c.s
  const reactors = s.units.filter((o) => o.id !== mover.id && o.side !== mover.side && o.side !== 'civilians' && isActive(o) && o.overwatch).sort((a, b) => (a.id < b.id ? -1 : 1))
  for (const o of reactors) {
    if (!isActive(mover)) return
    const w = weaponDef(o.weapon)
    if (!w || w.melee || !o.armed) continue
    if (dist(o.x, o.y, mover.x, mover.y) > w.maxRange) continue
    if (!stepSees(s, o, mover)) continue
    o.overwatch = null
    emit(c, 'overwatchFire', { unit: o.id, target: mover.id })
    weaponAttack(c, o, mover, { weapon: o.weapon!, overwatch: true, kind: 'overwatch' })
  }
  if (mover.suppressedBy && !mover.suppressReacted && isActive(mover)) {
    const sup = s.units.find((x) => x.id === mover.suppressedBy)
    const w = sup ? weaponDef(sup.weapon) : null
    if (sup && isActive(sup) && w && !w.melee && sup.armed && dist(sup.x, sup.y, mover.x, mover.y) <= w.maxRange && sees(s, sup, mover)) {
      mover.suppressReacted = true
      emit(c, 'suppressionFire', { unit: sup.id, target: mover.id })
      weaponAttack(c, sup, mover, { weapon: sup.weapon!, kind: 'suppressionFire' })
    }
  }
}

/** Executes a validated move step by step (MOVE-6). */
export function runMove(c: Ctx, u: Unit, path: Pt[]): void {
  const s = c.s
  u.actions -= 1
  emit(c, 'move', { unit: u.id, path, cost: path.length })
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!
    const from = { x: u.x, y: u.y }
    faceToward(u, p.x, p.y)
    u.x = p.x; u.y = p.y
    emit(c, 'step', { unit: u.id, from, to: { x: p.x, y: p.y } })
    const t = tileAt(s, p.x, p.y)!
    if (t.k === 'door' && !t.open) { t.open = true; dirty(s); emit(c, 'doorOpened', { x: p.x, y: p.y, by: u.id }) }
    if (u.side === 'squad') checkSight(c)
    reactions(c, u)
    if (!isActive(u)) { emit(c, 'moveInterrupted', { unit: u.id, at: { x: u.x, y: u.y } }); break }
    // ENM-5: a fleeing Bagman who ends his move on the escape tile gets away.
    if (i === path.length - 1 && u.kind === 'bagman' && u.fleeing && t.k === 'escape') {
      u.status = 'escaped'
      emit(c, 'escaped', { unit: u.id, via: 'van' })
    }
  }
}
