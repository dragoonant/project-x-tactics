import type { Ctx, GameEvent, State, Unit, Tuning, DeepPartial } from './types'

/** Read a tuning number by dotted key, e.g. tn(s, 'cover.half'). */
export function tn(s: State, key: string): number {
  let cur: any = s.tuning
  for (const part of key.split('.')) {
    cur = cur?.[part]
    if (cur === undefined) throw new Error(`unknown tuning key ${key}`)
  }
  return cur as number
}

export function mergeTuning(base: Tuning, over?: DeepPartial<Tuning>): Tuning {
  const out: any = JSON.parse(JSON.stringify(base))
  const walk = (dst: any, src: any): void => {
    for (const k of Object.keys(src ?? {})) {
      if (typeof src[k] === 'object' && src[k] !== null) { dst[k] = dst[k] ?? {}; walk(dst[k], src[k]) }
      else if (typeof src[k] === 'number') dst[k] = src[k]
    }
  }
  walk(out, over)
  return out
}

export function emit(c: Ctx, kind: string, data: Record<string, unknown> = {}): GameEvent {
  const e: GameEvent = { kind, round: c.s.round, ...data }
  c.ev.push(e)
  return e
}

export function unitById(s: State, id: string): Unit | undefined {
  for (const u of s.units) if (u.id === id) return u
  return undefined
}

/** MOVE-7: floor of euclidean distance between tile centres. */
export function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx, dy = ay - by
  return Math.floor(Math.sqrt(dx * dx + dy * dy))
}
export function cheb(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by))
}
export function udist(a: Unit, b: Unit): number { return dist(a.x, a.y, b.x, b.y) }

export function hasAb(u: Unit, ab: string): boolean { return u.abilities.includes(ab) }

/** On the map and taking up a tile. */
export function onBoard(u: Unit): boolean { return u.status !== 'dead' && u.status !== 'escaped' && u.status !== 'safe' }
export function isActive(u: Unit): boolean { return u.status === 'active' }
export function isTrooper(u: Unit): boolean { return u.side === 'squad' }
export function isEnemy(u: Unit): boolean { return u.side === 'syndicate' }
