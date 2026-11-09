// COV and DST: directional cover, flanking, destructible cover.
import type { Ctx, State, Unit } from './types'
import { DIRS4, dirty, tileAt } from './grid'
import { cheb, emit, hasAb, isActive, tn } from './util'

export interface CoverInfo {
  level: 'none' | 'half' | 'full'
  value: number
  flanked: boolean
  hunkered: boolean
  /** What gave the cover: 'object' / 'wall' / 'door' / 'shield', with the tile (objects, walls) or the Bulwark id. */
  source: string | null
  at: { x: number; y: number } | null
}

/** COV-1..5 for a defender attacked from tile (ax, ay). */
export function coverAgainst(s: State, def: Unit, ax: number, ay: number): CoverInfo {
  const vx = ax - def.x, vy = ay - def.y
  let bestLevel: 'none' | 'half' | 'full' = 'none'
  let bestVal = 0
  let source: string | null = null
  let at: { x: number; y: number } | null = null
  const consider = (level: 'half' | 'full', src: string, pos: { x: number; y: number } | null): void => {
    const v = level === 'full' ? tn(s, 'cover.full') : tn(s, 'cover.half')
    if (v > bestVal) { bestVal = v; bestLevel = level; source = src; at = pos }
  }
  for (const d of DIRS4) {
    if (vx * d.x + vy * d.y <= 0) continue
    const nx = def.x + d.x, ny = def.y + d.y
    const t = tileAt(s, nx, ny)
    if (!t) continue
    if (t.k === 'wall') consider('full', 'wall', { x: nx, y: ny })
    else if (t.k === 'door' && !t.open) consider('full', 'door', { x: nx, y: ny })
    else if (t.o === 'fullCover') consider('full', 'object', { x: nx, y: ny })
    else if (t.o === 'halfCover' || t.o === 'rubble') consider('half', 'object', { x: nx, y: ny })
  }
  // ABL-BUL-1 Riot Shield: half cover for the Bulwark and adjacent allies against attackers in front of the shield.
  for (const b of s.units) {
    if (b.side !== def.side || !isActive(b) || !hasAb(b, 'shield')) continue
    if (b.id !== def.id && cheb(b.x, b.y, def.x, def.y) !== 1) continue
    if (vx * b.facing.x + vy * b.facing.y > 0) consider('half', 'shield', { x: b.x, y: b.y })
  }
  const flanked = bestVal === 0
  const hunkered = def.hunkered && !flanked
  return { level: bestLevel, value: hunkered ? bestVal * 2 : bestVal, flanked, hunkered, source, at }
}

function hpFor(s: State, o: string): number { return o === 'fullCover' ? tn(s, 'destruct.fullHp') : tn(s, 'destruct.halfHp') }
export function coverHp(s: State, o: string): number { return hpFor(s, o) }

/** DST-4. */
function breakCover(c: Ctx, x: number, y: number): void {
  const t = tileAt(c.s, x, y)
  if (!t || !t.o) return
  if (t.o === 'fullCover') { t.o = 'rubble'; t.hp = tn(c.s, 'destruct.halfHp'); emit(c, 'coverDestroyed', { x, y, became: 'rubble' }) }
  else if (t.o === 'halfCover' || t.o === 'rubble') { delete t.o; delete t.hp; emit(c, 'coverDestroyed', { x, y, became: 'none' }) }
  dirty(c.s)
}
/** DST-1/2: chip a cover object. Walls, doors, lamps and shields are ignored. */
export function chipCover(c: Ctx, x: number, y: number, n: number): void {
  const t = tileAt(c.s, x, y)
  if (!t || !t.o || t.o === 'lamp') return
  t.hp = (t.hp ?? hpFor(c.s, t.o)) - n
  emit(c, 'coverChipped', { x, y, hp: Math.max(0, t.hp) })
  if (t.hp <= 0) breakCover(c, x, y)
}
/** DST-3: explosions set cover in the area to 0 HP. Lamps are smashed too (R-6). */
export function explodeTerrain(c: Ctx, cx: number, cy: number, r: number): void {
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++) {
      const t = tileAt(c.s, x, y)
      if (!t || !t.o) continue
      if (t.o === 'lamp') { delete t.o; delete t.hp; emit(c, 'lampDestroyed', { x, y }); dirty(c.s) }
      else breakCover(c, x, y)
    }
}
export function destroyLamp(c: Ctx, x: number, y: number): void {
  const t = tileAt(c.s, x, y)
  if (!t || t.o !== 'lamp') return
  delete t.o; delete t.hp
  emit(c, 'lampDestroyed', { x, y })
  dirty(c.s)
}
