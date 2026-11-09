// CINV-1..5: cheap per-step campaign invariants (CINV-6, the save round trip and replay, is checked by the sim).
import type { CampaignState } from './types'
import { legalCampaignActions } from './legal'
import { ctn, living, rankFor } from './util'

export function checkCampaignInvariants(s: CampaignState): string[] {
  const bad: string[] = []
  // CINV-1
  if (!s.outcome && legalCampaignActions(s).length === 0) bad.push('CINV-1: no legal action while the campaign runs')
  // CINV-2
  for (const d of s.districts) {
    if (!Number.isInteger(d.order) || d.order < 0 || d.order > ctn(s, 'order.max')) bad.push(`CINV-2: ${d.id} Order ${d.order}`)
    if (d.fallen && d.order !== 0) bad.push(`CINV-2: fallen ${d.id} has Order ${d.order}`)
  }
  // CINV-3
  if (!Number.isInteger(s.takeover) || s.takeover < 0 || s.takeover > ctn(s, 'takeover.segments')) bad.push(`CINV-3: Takeover ${s.takeover}`)
  for (const [k, v] of [['funding', s.funding], ['intel', s.intel], ['evidence', s.evidence]] as const) if (!Number.isInteger(v) || v < 0) bad.push(`CINV-3: ${k} ${v}`)
  if (s.countdown !== null && (s.countdown < (s.outcome ? 0 : 1) || s.countdown > ctn(s, 'takeover.countdown'))) bad.push(`CINV-3: countdown ${s.countdown}`)
  // CINV-4
  const ids = new Set<string>()
  for (const t of s.roster) {
    if (ids.has(t.id)) bad.push(`CINV-4: duplicate trooper id ${t.id}`)
    ids.add(t.id)
    if (t.status === 'injured' && t.injuryWeeks < 1) bad.push(`CINV-4: ${t.id} injured with ${t.injuryWeeks} weeks`)
    if (t.status !== 'injured' && t.injuryWeeks !== 0) bad.push(`CINV-4: ${t.id} ${t.status} with ${t.injuryWeeks} injury weeks`)
    if (t.rank !== rankFor(s, t.xp)) bad.push(`CINV-4: ${t.id} rank ${t.rank} does not match XP ${t.xp}`)
  }
  if (s.roster.filter(living).length > ctn(s, 'roster.max')) bad.push('CINV-4: living roster over the maximum')
  // CINV-5
  if (s.week < 1 || s.week > ctn(s, 'week.max')) bad.push(`CINV-5: week ${s.week}`)
  if (s.missionsThisWeek > ctn(s, 'week.missions')) bad.push(`CINV-5: ${s.missionsThisWeek} missions this week`)
  if ((s.phase === 'deployed') !== (s.deployment !== null)) bad.push(`CINV-5: phase ${s.phase} with deployment ${s.deployment ? 'set' : 'empty'}`)
  if ((s.phase === 'over') !== (s.outcome !== null)) bad.push(`CINV-5: phase ${s.phase} with outcome ${s.outcome}`)
  return bad
}
