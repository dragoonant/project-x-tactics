// Campaign test helpers. Dice are steered through tuning (e.g. auto.min = auto.max = 100 always wins), never by editing the RNG.
import { expect } from 'vitest'
import { createCampaign, stepCampaign } from '../../src/campaign'
import type { CampaignAction, CampaignEvent, CampaignState, MissionResult, MOutcome } from '../../src/campaign'

export const ALWAYS_WIN = { auto: { min: 100, max: 100, death: { win: 0 }, injury: { win: 0 }, casualty: { win: 0 } } }
export const ALWAYS_LOSE = { auto: { min: 0, max: 0, partialBand: 0, death: { loss: 0 }, injury: { loss: 0 }, casualty: { loss: 0 } } }

export function fresh(seed = 1, tuning?: Record<string, unknown>): CampaignState {
  return createCampaign(tuning ? { seed, tuning: tuning as never } : { seed })
}

export interface Out { s: CampaignState; ev: CampaignEvent[] }
export function go(s: CampaignState, a: CampaignAction): Out {
  const r = stepCampaign(s, a)
  if (!r.ok) throw new Error(`campaign action ${JSON.stringify(a)} was rejected: ${r.reason}`)
  return { s: r.state, ev: r.events }
}
export function refused(s: CampaignState, a: unknown): string {
  const r = stepCampaign(s, a as CampaignAction)
  expect(r.ok).toBe(false)
  return r.ok ? '' : r.reason
}
export const kinds = (ev: CampaignEvent[]): string[] => ev.map((e) => e.kind)
export const find = (ev: CampaignEvent[], kind: string): CampaignEvent | undefined => ev.find((e) => e.kind === kind)
export const all = (ev: CampaignEvent[], kind: string): CampaignEvent[] => ev.filter((e) => e.kind === kind)
export const ids = (s: CampaignState, n = 4): string[] => s.roster.filter((t) => t.status === 'ready').slice(0, n).map((t) => t.id)
export const dist = (s: CampaignState, id: string) => s.districts.find((d) => d.id === id)!

/** A plain mission result for the current deployment. */
export function result(s: CampaignState, outcome: MOutcome, o: Partial<MissionResult> = {}, per: Record<string, Partial<MissionResult['troopers'][number]>> = {}): MissionResult {
  const squad = s.deployment!.squad
  return {
    outcome, intel: 0, evidence: 0, civilianCasualties: 0,
    troopers: squad.map((id) => ({ id, dead: false, downed: false, hp: 6, maxHp: 6, arrests: 0, ...(per[id] ?? {}) })),
    ...o,
  }
}

/** Deploy into the first open incident (or the given one) with the first ready troopers. */
export function deployFirst(s: CampaignState, incident?: string, n = 4): Out {
  const inc = incident ?? s.incidents.find((i) => i.result === null)!.id
  return go(s, { type: 'deploy', incident: inc, squad: ids(s, n) })
}

/** End weeks until the given week number (no missions). */
export function toWeek(s: CampaignState, week: number): CampaignState {
  while (s.week < week && !s.outcome) s = go(s, { type: 'endWeek' }).s
  return s
}
