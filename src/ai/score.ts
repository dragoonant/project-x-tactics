// Tile and shot scoring for the syndicate AI. Everything here reads the syndicate's own VIEW of the game
// (`view(s, 'syndicate')`): troopers it cannot see do not exist in it. Hit chances come from the engine's own
// `hitBreakdown` on "what if this unit stood there" copies, so the AI never does its own rules maths.
import type { State, Unit } from '../engine'
import { hitBreakdown } from '../engine/combat'
import { coverAgainst } from '../engine/cover'
import { sees } from '../engine/fog'
import { inCloud } from '../engine/grid'
import { dist, cheb } from '../engine/util'
import { avgDamage, bestRange, placed, weapon } from './geo'
import { weights as W } from './weights'

export interface Ctx {
  /** The real state (used only to validate chosen actions and to read the AI's own units). */
  s: State
  /** The syndicate's view: hidden troopers removed. All perception goes through this. */
  v: State
  /** Troopers the syndicate currently sees and that can fight. */
  troopers: Unit[]
  /** Memo of tile evaluations for this decision, keyed by unit id and tile. */
  tiles: Map<string, TileInfo>
}

export interface TileInfo {
  x: number
  y: number
  /** Number of troopers that can see and shoot this tile. */
  seers: number
  /** Expected Health damage per trooper phase on this tile. */
  exposure: number
  /** 0 (no cover) to 1 (full cover): mean best cover against the troopers that see the tile; 1 when none does. */
  coverNorm: number
  /** Troopers that would shoot this tile with no cover at all. */
  flankedBy: number
  /** No cover piece next to the tile in any direction. */
  open: boolean
  inGas: boolean
  /** An overwatching trooper can see and shoot this tile. */
  overwatched: boolean
  /** Distance to the nearest visible trooper, or Infinity. */
  nearest: number
}

export interface Shot {
  kind: 'attack' | 'suppress'
  target: Unit
  value: number
  chance: number
  flanked: boolean
  kills: number
}

const FULL_COVER = 40

function key(u: Unit, x: number, y: number): string { return `${u.id}:${x},${y}` }

/** Does this tile have a cover piece on any side (static terrain, ignoring units)? */
function hasAnyCover(c: Ctx, u: Unit, x: number, y: number): boolean {
  const me = placed(u, x, y)
  for (const [dx, dy] of [[0, -5], [5, 0], [0, 5], [-5, 0]] as const) if (coverAgainst(c.v, me, x + dx, y + dy).value > 0) return true
  return false
}

/** How exposed, covered and hidden a unit would be standing on (x, y). */
export function tileInfo(c: Ctx, u: Unit, x: number, y: number): TileInfo {
  const k = key(u, x, y)
  const hit = c.tiles.get(k)
  if (hit) return hit
  const me = placed(u, x, y)
  let seers = 0, exposure = 0, coverSum = 0, flankedBy = 0, overwatched = false, nearest = Infinity
  for (const t of c.troopers) {
    const d = dist(x, y, t.x, t.y)
    if (d < nearest) nearest = d
    const w = weapon(t.weapon)
    if (!w || w.melee || !t.armed || d > w.maxRange) continue
    if (!sees(c.v, t, me)) continue
    const bd = hitBreakdown(c.v, t, me, { weapon: t.weapon! })
    seers++
    exposure += (bd.chance / 100) * (avgDamage(w) + (bd.cover.flanked ? 1 : 0)) + (bd.grazeChance / 100) * (avgDamage(w) / 2)
    coverSum += bd.cover.value / FULL_COVER
    if (bd.cover.flanked) flankedBy++
    if (t.overwatch) overwatched = true
  }
  const info: TileInfo = {
    x, y, seers, exposure,
    coverNorm: seers === 0 ? 1 : Math.min(1, coverSum / seers),
    flankedBy, open: seers > 0 && !hasAnyCover(c, u, x, y),
    inGas: !u.gasImmune && inCloud(c.v, c.v.gas, x, y),
    overwatched, nearest,
  }
  c.tiles.set(k, info)
  return info
}

export interface TileOpts {
  /** Multiplier for cover, hidden and exposure terms (retreating units care more, melee rushers less). */
  safety: number
  /** True if the unit is moving to this tile (not standing still on it). */
  moving: boolean
}

/** The standing value of a tile: cover first, then exposure, flanks, open ground, gas, overwatch and range. */
export function tileScore(u: Unit, info: TileInfo, o: TileOpts): number {
  let sc = o.safety * (W.cover * info.coverNorm + (info.seers === 0 ? W.hidden : 0) - W.exposure * info.exposure)
  sc -= o.safety * W.flankedBy * info.flankedBy
  if (info.open) sc -= o.safety * W.openGround
  if (info.inGas) sc -= W.gas
  if (info.overwatched && o.moving) sc -= W.overwatchTile
  const w = weapon(u.weapon)
  if (w && info.nearest < Infinity) {
    const [lo, hi] = bestRange(w)
    const off = Math.max(0, lo - info.nearest, info.nearest - hi)
    sc -= W.rangeOff * Math.min(W.rangeOffCap, off)
  }
  return sc
}

/** P(damage >= hp) over the weapon's uniform damage range, for a hit (halved on a graze) with the flank bonus. */
function killShare(w: { damage: [number, number] }, hp: number, graze: boolean, flank: number, fixed?: number): number {
  const lo = fixed ?? w.damage[0], hi = fixed ?? w.damage[1]
  let n = 0, tot = 0
  for (let d = lo; d <= hi; d++) { tot++; if ((graze ? Math.ceil(d / 2) : d) + flank >= hp) n++ }
  return tot ? n / tot : 0
}

/** Value of attacking `t` with the unit's weapon from (x, y); null when there is no legal shot from there. */
export function shotFrom(c: Ctx, u: Unit, x: number, y: number, t: Unit): Shot | null {
  const w = weapon(u.weapon)
  if (!w || !u.armed) return null
  const me = placed(u, x, y)
  const d = dist(x, y, t.x, t.y)
  if (w.melee) {
    if (cheb(x, y, t.x, t.y) !== 1) return null
  } else {
    if (d > w.maxRange || !sees(c.v, me, t)) return null
  }
  const bd = hitBreakdown(c.v, me, t, { weapon: u.weapon! })
  const pHit = bd.chance / 100, pGraze = bd.grazeChance / 100
  const flank = bd.cover.flanked ? 1 : 0
  const avg = avgDamage(w)
  const ev = pHit * (avg + flank) + pGraze * (Math.ceil(avg / 2) + flank)
  const kills = pHit * killShare(w, t.hp, false, flank) + pGraze * killShare(w, t.hp, true, flank)
  let value = W.damage * ev + W.kill * kills + W.finish * (1 - t.hp / t.maxHp) * (pHit + pGraze)
  value += W.flankedTarget * flank * (pHit + pGraze) + W.threat * (t.aim / 100) * (pHit + pGraze)
  if (w.melee) value += W.charge * pHit
  return { kind: 'attack', target: t, value, chance: bd.chance, flanked: bd.cover.flanked, kills }
}

/** The Heavy's Suppress: worth more against the most exposed (easiest to hit) trooper that is not yet suppressed. */
export function suppressFrom(c: Ctx, u: Unit, x: number, y: number, t: Unit): Shot | null {
  if (!u.abilities.includes('suppress')) return null
  const base = shotFrom(c, u, x, y, t)
  if (!base) return null
  let value = W.suppressBase + W.suppressExposure * (base.chance / 100)
  if (t.suppressedBy) value -= W.suppressRepeat
  return { ...base, kind: 'suppress', value }
}

/** Every shot (attacks and suppression) available from a tile, best first. */
export function shotsFrom(c: Ctx, u: Unit, x: number, y: number): Shot[] {
  const out: Shot[] = []
  for (const t of c.troopers) {
    const a = shotFrom(c, u, x, y, t)
    if (a) out.push(a)
    const sp = suppressFrom(c, u, x, y, t)
    if (sp) out.push(sp)
  }
  return out.sort((a, b) => b.value - a.value || (a.target.id < b.target.id ? -1 : 1))
}
