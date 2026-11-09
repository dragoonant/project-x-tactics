// CMP-4: every number the campaign UI shows. The UI formats these; it never does campaign maths itself.
import { CAMPAIGN, CLASSES } from '../data'
import type { AutoBreakdown, CampaignState, Incident, Report, Trooper } from './types'
import { autoBreakdown, districtOf, trooperOf } from './rules'
import { campaignActionProblem } from './step'
import { defaultSquad } from './legal'
import { variantFor, type VariantNote } from './bridge'
import { ctn, living, nextRankXp } from './util'

export interface TakeoverInfo { value: number; max: number; pct: number; full: boolean; countdown: number | null; countdownMax: number; nextAdvanceIn: number; nextAdvanceWeek: number; scheduled: number; everyWeeks: number }
export interface FundingInfo { funding: number; nextIncome: number; weeksToIncome: number; incomeWeek: number; base: number; perOrder: number; shares: { district: string; order: number; share: number }[] }
export interface DistrictInfo { id: string; name: string; patron: string; order: number; max: number; fallen: boolean; modifier: { label: string; text: string }; incidents: string[] }
export interface IncidentBrief { incident: Incident; title: string; districtName: string; notes: VariantNote[]; odds: AutoBreakdown; squad: string[] }
export interface TrooperInfo { trooper: Trooper; className: string; nextXp: number | null; canPromote: boolean; promotionRank: number }
export interface CampaignSummary {
  outcome: CampaignState['outcome']
  reason: string | null
  weeks: number
  takeover: number
  takeoverMax: number
  takeoverPct: number
  missions: number
  missionsAuto: number
  missionsDeployed: number
  wins: number
  partials: number
  losses: number
  ignored: number
  districtsFallen: number
  districtsStanding: number
  troopersLost: number
  promotions: number
  recruits: number
  intel: number
  evidence: number
  funding: number
}

export function incidentTitle(inc: Incident): string {
  if (inc.role === 'kingpin') return 'KINGPIN: the ledger run'
  if (inc.role === 'retake') return 'RETAKE: raid the syndicate hold'
  return inc.kind === 'raid' ? 'RAID: evidence cache' : 'BUST: arrest the Bagman'
}

export const campaignQuery = {
  week(s: CampaignState): { week: number; maxWeeks: number; phase: CampaignState['phase']; missionsLeft: number } {
    return { week: s.week, maxWeeks: ctn(s, 'week.max'), phase: s.phase, missionsLeft: Math.max(0, ctn(s, 'week.missions') - s.missionsThisWeek) }
  },

  takeover(s: CampaignState): TakeoverInfo {
    const max = ctn(s, 'takeover.segments')
    const every = ctn(s, 'takeover.everyWeeks')
    const rem = s.week % every
    return {
      value: s.takeover, max, pct: Math.round((s.takeover / max) * 100), full: s.takeover >= max,
      countdown: s.countdown, countdownMax: ctn(s, 'takeover.countdown'),
      nextAdvanceIn: rem === 0 ? 0 : every - rem, nextAdvanceWeek: s.week + (rem === 0 ? 0 : every - rem), scheduled: ctn(s, 'takeover.scheduled'), everyWeeks: every,
    }
  },

  funding(s: CampaignState): FundingInfo {
    const per = ctn(s, 'funding.periodWeeks')
    const rem = s.week % per
    const shares = s.districts.map((d) => ({ district: d.id, order: d.fallen ? 0 : d.order, share: d.fallen ? 0 : d.order * ctn(s, 'funding.perOrder') }))
    return { funding: s.funding, nextIncome: ctn(s, 'funding.base') + shares.reduce((a, x) => a + x.share, 0), weeksToIncome: rem === 0 ? 0 : per - rem, incomeWeek: s.week + (rem === 0 ? 0 : per - rem), base: ctn(s, 'funding.base'), perOrder: ctn(s, 'funding.perOrder'), shares }
  },

  districts(s: CampaignState): DistrictInfo[] {
    return s.districts.map((d) => {
      const m = CAMPAIGN.modifiers[d.modifier]
      return { id: d.id, name: d.name, patron: d.patron, order: d.order, max: ctn(s, 'order.max'), fallen: d.fallen, modifier: { label: m?.label ?? d.modifier, text: m?.text ?? '' }, incidents: s.incidents.filter((i) => i.district === d.id && i.result === null).map((i) => i.id) }
    })
  },

  defaultSquad,

  autoOdds(s: CampaignState, incidentId: string, squad?: string[]): AutoBreakdown | null {
    const inc = s.incidents.find((i) => i.id === incidentId)
    if (!inc) return null
    const ids = squad ?? defaultSquad(s)
    const ts = ids.map((id) => trooperOf(s, id)).filter((t): t is Trooper => !!t)
    return autoBreakdown(s, inc, ts)
  },

  incident(s: CampaignState, incidentId: string, squad?: string[]): IncidentBrief | null {
    const inc = s.incidents.find((i) => i.id === incidentId)
    if (!inc) return null
    const ids = squad ?? defaultSquad(s)
    return { incident: inc, title: incidentTitle(inc), districtName: districtOf(s, inc.district)?.name ?? inc.district, notes: variantFor(s, inc).notes, odds: campaignQuery.autoOdds(s, incidentId, ids)!, squad: ids }
  },

  /** Why a deploy / auto-resolve with this squad is refused (null when it is legal). */
  missionProblem(s: CampaignState, incidentId: string, squad: string[]): string | null {
    return campaignActionProblem(s, { type: 'autoResolve', incident: incidentId, squad })
  },

  trooper(s: CampaignState, id: string): TrooperInfo | null {
    const t = trooperOf(s, id)
    if (!t) return null
    return { trooper: t, className: CLASSES[t.cls]?.name ?? t.cls, nextXp: nextRankXp(s, t.rank), canPromote: t.cls === 'recruit' && living(t) && t.rank >= ctn(s, 'promotion.rank'), promotionRank: ctn(s, 'promotion.rank') }
  },

  roster(s: CampaignState): TrooperInfo[] { return s.roster.map((t) => campaignQuery.trooper(s, t.id)!) },

  costs(s: CampaignState): { recruit: number; treat: number; rosterLiving: number; rosterMax: number; recruitProblem: string | null; specialties: { id: string; name: string }[] } {
    return {
      recruit: ctn(s, 'recruit.cost'), treat: ctn(s, 'treat.cost'), rosterLiving: s.roster.filter(living).length, rosterMax: ctn(s, 'roster.max'),
      recruitProblem: campaignActionProblem(s, { type: 'recruit' }),
      specialties: CAMPAIGN.specialties.map((id) => ({ id, name: CLASSES[id]?.name ?? id })),
    }
  },

  kingpin(s: CampaignState): { unlocked: boolean; intel: number; need: number } {
    return { unlocked: s.kingpinUnlocked, intel: s.intel, need: ctn(s, 'kingpin.intel') }
  },

  report(s: CampaignState): Report | null { return s.report },

  summary(s: CampaignState): CampaignSummary {
    const st = s.stats
    const max = ctn(s, 'takeover.segments')
    return {
      outcome: s.outcome, reason: s.endReason, weeks: s.week, takeover: s.takeover, takeoverMax: max, takeoverPct: Math.round((s.takeover / max) * 100),
      missions: st.missionsAuto + st.missionsDeployed, missionsAuto: st.missionsAuto, missionsDeployed: st.missionsDeployed,
      wins: st.wins, partials: st.partials, losses: st.losses, ignored: st.ignored,
      districtsFallen: s.districts.filter((d) => d.fallen).length, districtsStanding: s.districts.filter((d) => !d.fallen).length,
      troopersLost: st.troopersLost, promotions: st.promotions, recruits: st.recruits, intel: s.intel, evidence: s.evidence, funding: s.funding,
    }
  },
}
