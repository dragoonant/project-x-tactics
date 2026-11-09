// Bot policies for the clock sim and the fuzz (never used by the game). Each returns one of legalCampaignActions(s) and draws its
// own randomness from `rnd` (the sim's generator), never from the campaign RNG, so a policy cannot change the dice.
import { CAMPAIGN } from '../data'
import type { CampaignAction, CampaignState, Incident } from './types'
import { legalCampaignActions } from './legal'
import { campaignQuery } from './query'
import { ctn } from './util'

export type CampaignPolicy = (s: CampaignState, rnd: () => number) => CampaignAction
const pick = <T>(a: T[], rnd: () => number): T => a[Math.floor(rnd() * a.length)] as T

/** Random: a uniform action category (endWeek less often), then a uniform action in it. Never deploys (auto-resolve only). */
export const randomPolicy: CampaignPolicy = (s, rnd) => {
  const legal = legalCampaignActions(s).filter((a) => a.type !== 'deploy')
  if (s.phase === 'deployed') return { type: 'abort' }
  const groups = new Map<string, CampaignAction[]>()
  for (const a of legal) groups.set(a.type, [...(groups.get(a.type) ?? []), a])
  const kinds = [...groups.keys()].filter((k) => k !== 'endWeek')
  if (!kinds.length || rnd() < 0.25) return { type: 'endWeek' }
  return pick(groups.get(pick(kinds, rnd))!, rnd)
}

/** The specialty the roster has least of (ties in data order). */
function neededSpecialty(s: CampaignState): string {
  const n = (cls: string): number => s.roster.filter((t) => t.status !== 'dead' && t.cls === cls).length
  return [...CAMPAIGN.specialties].sort((a, b) => n(a) - n(b))[0]!
}

/** Promote, treat and recruit as the policy's spending rule allows; null when there is nothing to do. */
function management(s: CampaignState, opts: { treatWhenReadyBelow: number; recruitWhenReadyBelow: number; reserve: number }): CampaignAction | null {
  const legal = legalCampaignActions(s)
  const promo = legal.find((a) => a.type === 'promote')
  if (promo && promo.type === 'promote') return { type: 'promote', trooper: promo.trooper, cls: neededSpecialty(s) }
  const ready = s.roster.filter((t) => t.status === 'ready').length
  const treat = legal.find((a) => a.type === 'treat')
  if (treat && ready < opts.treatWhenReadyBelow && s.funding - ctn(s, 'treat.cost') >= opts.reserve) return treat
  if (legal.some((a) => a.type === 'recruit') && ready < opts.recruitWhenReadyBelow && s.funding - ctn(s, 'recruit.cost') >= opts.reserve) return { type: 'recruit' }
  return null
}

function winChance(s: CampaignState, inc: Incident): number { return campaignQuery.autoOdds(s, inc.id)?.win ?? 0 }
function openIncidents(s: CampaignState): Incident[] {
  return legalCampaignActions(s).filter((a) => a.type === 'autoResolve').map((a) => s.incidents.find((i) => i.id === (a as { incident: string }).incident)!)
}
const resolve = (s: CampaignState, inc: Incident): CampaignAction => ({ type: 'autoResolve', incident: inc.id, squad: campaignQuery.defaultSquad(s) })

/** Greedy: spends everything, then takes the incident with the best odds (the Kingpin first when it is there). */
export const greedyPolicy: CampaignPolicy = (s) => {
  if (s.phase === 'deployed') return { type: 'abort' }
  const size = ctn(s, 'squad.size')
  const m = management(s, { treatWhenReadyBelow: 99, recruitWhenReadyBelow: size + 2, reserve: 0 })
  if (m) return m
  const open = openIncidents(s)
  if (open.length) {
    const kp = open.find((i) => i.role === 'kingpin')
    if (kp) return resolve(s, kp)
    return resolve(s, [...open].sort((a, b) => winChance(s, b) - winChance(s, a))[0]!)
  }
  return { type: 'endWeek' }
}

/**
 * Average: a player who protects the weakest district, sometimes chases whatever looks interesting (1 in 5 weeks), saves Funding
 * for replacements, and goes for the Kingpin once the odds look fair or time is short.
 */
export const averagePolicy: CampaignPolicy = (s, rnd) => {
  if (s.phase === 'deployed') return { type: 'abort' }
  const size = ctn(s, 'squad.size')
  const m = management(s, { treatWhenReadyBelow: size, recruitWhenReadyBelow: size + 1, reserve: ctn(s, 'treat.cost') })
  if (m) return m
  const open = openIncidents(s)
  if (open.length) {
    const kp = open.find((i) => i.role === 'kingpin')
    if (kp && (winChance(s, kp) >= 50 || s.countdown !== null || s.takeover >= ctn(s, 'takeover.segments') - 2)) return resolve(s, kp)
    const regular = open.filter((i) => i.role !== 'kingpin')
    if (regular.length) {
      if (rnd() < 0.2) return resolve(s, pick(regular, rnd))
      const order = (i: Incident): number => s.districts.find((d) => d.id === i.district)?.order ?? 0
      const retake = regular.find((i) => i.role === 'retake' && winChance(s, i) >= 40)
      if (retake) return resolve(s, retake)
      const pool = regular.filter((i) => i.role !== 'retake')
      if (pool.length) return resolve(s, [...pool].sort((a, b) => order(a) - order(b) || winChance(s, b) - winChance(s, a))[0]!)
    }
    if (kp) return resolve(s, kp)
  }
  return { type: 'endWeek' }
}

export const POLICIES: Record<string, CampaignPolicy> = { random: randomPolicy, greedy: greedyPolicy, average: averagePolicy }
