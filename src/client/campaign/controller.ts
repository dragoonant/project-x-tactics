// The campaign controller: every transition of the strategy layer (new / continue, city actions, deploy and return).
// It calls the campaign engine (stepCampaign, campaignQuery) and never does campaign maths itself (spec 20 CMP-4).
import {
  campaignQuery, createCampaign, deserializeCampaign, legalCampaignActions, resultFromTactical, serializeCampaign, stepCampaign,
} from '../../campaign'
import type { CampaignAction, CampaignEvent, CampaignState } from '../../campaign'
import type { State } from '../../engine'
import { CAMPAIGN_MISSION_KEY, campaignHooks, continueCampaignMission, leaveBoard, startGame, toStart } from '../game/controller'
import { clearSave, storage } from '../game/persist'
import { setCallSignNames } from '../game/names'
import { get, set, type CampaignSaveRead } from '../game/store'
import { loadStrategyAssets } from './assets'
import { cityMusic, cue } from './sound'

export const CAMPAIGN_KEY = 'px-campaign'

// ------------------------------------------------------------------------------------------------ save (rule 22)
export function readCampaignSave(): CampaignSaveRead {
  let raw: string | null = null
  try { raw = storage()?.getItem(CAMPAIGN_KEY) ?? null } catch (e) { return { kind: 'bad', reason: `storage refused the read: ${(e as Error).message}` } }
  if (raw === null) return { kind: 'none' }
  const d = deserializeCampaign(raw)
  if (!d.ok) return { kind: 'bad', reason: d.reason }
  try {
    // prove the snapshot opens: the queries the city map reads and the legal actions
    campaignQuery.takeover(d.state); campaignQuery.districts(d.state); campaignQuery.roster(d.state)
    if (!d.state.outcome) legalCampaignActions(d.state)
    const j = JSON.parse(raw) as { savedAt?: number }
    return { kind: 'ok', state: d.state, savedAt: typeof j.savedAt === 'number' ? j.savedAt : 0 }
  } catch (e) {
    return { kind: 'bad', reason: `campaign snapshot cannot be opened: ${(e as Error).message}` }
  }
}

function persist(s: CampaignState): void {
  const st = storage()
  if (s.outcome) { try { st?.removeItem(CAMPAIGN_KEY) } catch { /* nothing */ } return }
  if (!st) { set({ cerror: 'Campaign autosave unavailable: browser storage is unavailable' }); return }
  try { st.setItem(CAMPAIGN_KEY, JSON.stringify({ ...serializeCampaign(s), savedAt: Date.now() })); if (get().cerror?.startsWith('Campaign autosave')) set({ cerror: null }) } catch (e) {
    set({ cerror: `Campaign autosave unavailable: ${(e as Error).message || 'storage refused the save'}` })
  }
}

export function discardCampaign(): void {
  try { storage()?.removeItem(CAMPAIGN_KEY) } catch { /* nothing */ }
  clearSave(CAMPAIGN_MISSION_KEY)
  set({ campaignSave: { kind: 'none' }, confirmNewCampaign: false })
}

// ------------------------------------------------------------------------------------------------ boot, new, continue
export function bootCampaign(): void {
  set({ campaignSave: readCampaignSave() })
  void loadStrategyAssets()
  campaignHooks.missionEnd = onMissionEnd
}

function enterCity(s: CampaignState, panel: 'none' | 'aar' = 'none'): void {
  leaveBoard()
  setCallSignNames(null)
  const open = s.incidents.find((i) => i.result === null)
  set({ screen: s.outcome ? 'cend' : 'city', mode: 'single', campaign: s, cincident: s.missionsThisWeek === 0 ? open?.id ?? null : null, csquad: null, cpanel: panel, cerror: null, confirmNewCampaign: false })
  cityMusic(!s.outcome)
}

export function newCampaign(seed: number): void {
  let s: CampaignState
  try { s = createCampaign({ seed }) } catch (e) { set({ cerror: `Could not start the campaign: ${(e as Error).message}` }); return }
  clearSave(CAMPAIGN_MISSION_KEY)
  persist(s) // rule 22: write the save before the first render
  enterCity(s)
  cue('incident')
}

export function continueCampaign(): void {
  const r = readCampaignSave()
  set({ campaignSave: r })
  if (r.kind !== 'ok') return
  const s = r.state
  if (s.phase === 'deployed' && s.deployment) { set({ campaign: s }); resumeMission(s); return }
  enterCity(s)
}

/** A deployed mission reopens from its own save if it is the same mission, else it starts again from the deployment. */
function resumeMission(s: CampaignState): void {
  const dep = s.deployment!
  cityMusic(false)
  setCallSignNames(dep.squad.map((id) => campaignQuery.trooper(s, id)?.trooper.name ?? id))
  const same = (t: State): boolean => JSON.stringify(t.setup) === JSON.stringify(dep.setup)
  if (!continueCampaignMission(same)) startGame(dep.setup, 'campaign')
}

export function toStandby(): void {
  cityMusic(false)
  setCallSignNames(null)
  toStart()
  set({ campaignSave: readCampaignSave(), campaign: null, cpanel: 'none', cerror: null })
}

// ------------------------------------------------------------------------------------------------ actions
const CUES: [string, string][] = [['districtFell', 'district-fall'], ['kingpinUnlocked', 'case-reveal'], ['deployed', 'deploy'], ['weekStart', 'week'], ['countdownStarted', 'takeover']]
function playCues(ev: CampaignEvent[]): void {
  for (const [k, id] of CUES) if (ev.some((e) => e.kind === k)) { cue(id); return }
  if (ev.some((e) => e.kind === 'takeover' && e.to > e.from)) cue('takeover')
}

export function cdispatch(a: CampaignAction): CampaignState | null {
  const s = get().campaign
  if (!s) return null
  const r = stepCampaign(s, a)
  if (!r.ok) { set({ cerror: r.reason.charAt(0).toUpperCase() + r.reason.slice(1) }); return null }
  persist(r.state)
  set({ campaign: r.state, cerror: null, campaignSave: { kind: 'none' } })
  playCues(r.events)
  if (r.state.outcome) { set({ screen: 'cend', cpanel: 'none' }); cityMusic(false) }
  return r.state
}

export function selectIncident(id: string | null): void { set({ cincident: id, csquad: null, cerror: null }) }

/** The squad the brief shows: the player's pick, or the engine's default squad. */
export function currentSquad(s: CampaignState): string[] { return get().csquad ?? campaignQuery.defaultSquad(s) }

export function toggleTrooper(id: string): void {
  const s = get().campaign
  if (!s) return
  const cur = currentSquad(s)
  set({ csquad: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id], cerror: null })
}

export function autoResolve(): void {
  const s = get().campaign
  const inc = get().cincident
  if (!s || !inc) return
  const next = cdispatch({ type: 'autoResolve', incident: inc, squad: currentSquad(s) })
  if (next && !next.outcome) set({ cpanel: 'aar', cincident: null, csquad: null })
}

export function deploy(): void {
  const s = get().campaign
  const inc = get().cincident
  if (!s || !inc) return
  const next = cdispatch({ type: 'deploy', incident: inc, squad: currentSquad(s) })
  if (!next || !next.deployment) return
  clearSave(CAMPAIGN_MISSION_KEY)
  set({ cincident: null, csquad: null, cpanel: 'none' })
  resumeMission(next)
}

export function endWeek(confirmed = false): void {
  const s = get().campaign
  if (!s) return
  const open = s.incidents.filter((i) => i.result === null && i.role === 'regular').length
  if (!confirmed && open > 0 && campaignQuery.week(s).missionsLeft > 0) { set({ cpanel: 'confirmEnd' }); return }
  const next = cdispatch({ type: 'endWeek' })
  if (next && !next.outcome) set({ cpanel: 'none', cincident: next.incidents.find((i) => i.result === null)?.id ?? null, csquad: null })
}

export function promote(trooper: string, cls: string): void { cdispatch({ type: 'promote', trooper, cls }) }
export function recruit(): void { cdispatch({ type: 'recruit' }) }
export function treat(trooper: string): void { cdispatch({ type: 'treat', trooper }) }
export function setPanel(p: 'none' | 'roster' | 'aar' | 'confirmEnd'): void { set({ cpanel: p, cerror: null }) }

// ------------------------------------------------------------------------------------------------ the tactical round trip
/** Called by the tactical controller as soon as a campaign mission ends (spec 20 OPS-5/OPS-6). */
function onMissionEnd(t: State): void {
  const s = get().campaign
  if (!s || s.phase !== 'deployed' || !s.deployment) return
  cdispatch({ type: 'report', result: resultFromTactical(t, s.deployment.squad) })
}

/** End screen button: back to the city with the after-action report open. */
export function returnToCity(): void {
  const s = get().campaign
  if (!s) { toStandby(); return }
  enterCity(s, s.outcome ? 'none' : 'aar')
}

/** Withdraw from a running campaign mission: it counts as lost, and troopers already down keep their injuries (OPS-6). */
export function withdraw(): void {
  const s = get().campaign
  const t = get().state
  if (!s || s.phase !== 'deployed' || !s.deployment) return
  const next = t ? cdispatch({ type: 'report', result: resultFromTactical(t, s.deployment.squad) }) : cdispatch({ type: 'abort' })
  clearSave(CAMPAIGN_MISSION_KEY)
  if (next) enterCity(next, next.outcome ? 'none' : 'aar')
}
