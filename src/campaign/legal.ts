// CMP-3: legal campaign actions. Squad-taking actions are listed with the default squad; endWeek / abort are always there.
import { CAMPAIGN } from '../data'
import type { CampaignAction, CampaignState, Trooper } from './types'
import { campaignActionProblem } from './step'
import { isSpecialist } from './rules'
import { ctn } from './util'

/** The default squad: the strongest ready troopers (rank, then specialists, then roster order), up to squad.size. */
export function defaultSquad(s: CampaignState): string[] {
  const ready = s.roster.map((t, i) => ({ t, i })).filter((x) => x.t.status === 'ready')
  ready.sort((a, b) => b.t.rank - a.t.rank || Number(isSpecialist(b.t)) - Number(isSpecialist(a.t)) || a.i - b.i)
  return ready.slice(0, ctn(s, 'squad.size')).map((x) => x.t.id)
}

export function legalCampaignActions(s: CampaignState): CampaignAction[] {
  if (s.outcome) return []
  if (s.phase === 'deployed') return [{ type: 'abort' }]
  const out: CampaignAction[] = []
  const squad = defaultSquad(s)
  for (const inc of s.incidents) {
    for (const a of [{ type: 'autoResolve', incident: inc.id, squad }, { type: 'deploy', incident: inc.id, squad }] as CampaignAction[]) if (!campaignActionProblem(s, a)) out.push(a)
  }
  for (const t of s.roster as Trooper[]) {
    for (const cls of CAMPAIGN.specialties) { const a: CampaignAction = { type: 'promote', trooper: t.id, cls }; if (!campaignActionProblem(s, a)) out.push(a) }
    const tr: CampaignAction = { type: 'treat', trooper: t.id }
    if (!campaignActionProblem(s, tr)) out.push(tr)
  }
  if (!campaignActionProblem(s, { type: 'recruit' })) out.push({ type: 'recruit' })
  out.push({ type: 'endWeek' })
  return out
}
