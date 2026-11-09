// Campaign helpers: tuning reads (ctn), events (CMP-7), the seeded RNG (CMP-6), ranks (PROM-2).
import type { CampaignEvent, CampaignState, CCtx, Trooper } from './types'
import { sfc32Next } from '../engine/rng'

/** Read a campaign tuning number by dotted key, e.g. ctn(s, 'order.max'). */
export function ctn(s: CampaignState, key: string): number {
  let cur: any = s.tuning
  for (const part of key.split('.')) {
    cur = cur?.[part]
    if (cur === undefined) throw new Error(`unknown campaign tuning key ${key}`)
  }
  if (typeof cur !== 'number') throw new Error(`campaign tuning key ${key} is not a number`)
  return cur
}

export function mergeNumbers<T>(base: T, over?: unknown): T {
  const out: any = JSON.parse(JSON.stringify(base))
  const walk = (dst: any, src: any): void => {
    for (const k of Object.keys(src ?? {})) {
      if (typeof src[k] === 'object' && src[k] !== null) { dst[k] = dst[k] ?? {}; walk(dst[k], src[k]) }
      else if (typeof src[k] === 'number' && Number.isFinite(src[k])) dst[k] = src[k]
    }
  }
  walk(out, over)
  return out
}

export function emit(c: CCtx, kind: string, data: Record<string, unknown> = {}): CampaignEvent {
  const e: CampaignEvent = { ...data, kind, week: c.s.week }
  c.ev.push(e)
  return e
}

/** Integer in [lo, hi] from the campaign RNG. */
export function rollInt(s: CampaignState, lo: number, hi: number): number {
  return lo + Math.floor(sfc32Next(s.rng) * (hi - lo + 1))
}
export function d100(s: CampaignState): number { return rollInt(s, 0, 99) }

/** PROM-2: rank for an XP total. */
export function rankFor(s: CampaignState, xp: number): number {
  let r = 0
  const max = ctn(s, 'rank.max')
  const need = [ctn(s, 'rank.r1'), ctn(s, 'rank.r2'), ctn(s, 'rank.r3'), ctn(s, 'rank.r4')]
  for (let i = 0; i < need.length && i < max; i++) if (xp >= (need[i] as number)) r = i + 1
  return r
}
/** XP needed for the next rank, or null at max rank. */
export function nextRankXp(s: CampaignState, rank: number): number | null {
  if (rank >= ctn(s, 'rank.max')) return null
  return ctn(s, `rank.r${rank + 1}`)
}

export const living = (t: Trooper): boolean => t.status !== 'dead'
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
