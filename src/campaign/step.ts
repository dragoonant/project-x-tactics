// CMP-1 createCampaign and CMP-2 stepCampaign: the pure campaign reducer. Never throws; illegal actions return { ok: false, reason }.
import { CAMPAIGN } from '../data'
import { seedRng } from '../engine/rng'
import type { CampaignAction, CampaignSetup, CampaignState, CampaignStepResult, CCtx, MissionResult, Trooper } from './types'
import { applyResult, autoResult, endWeek, newTrooper, spawnIncidents, trooperOf } from './rules'
import { incidentSetup } from './bridge'
import { ctn, emit, living, mergeNumbers } from './util'

export function createCampaign(setup: CampaignSetup): CampaignState {
  if (!setup || typeof setup.seed !== 'number' || !Number.isFinite(setup.seed)) throw new Error('campaign setup needs a numeric seed')
  const tuning = mergeNumbers(CAMPAIGN.tuning, setup.tuning)
  const s: CampaignState = {
    setup: JSON.parse(JSON.stringify(setup)) as CampaignSetup,
    tuning,
    week: 1,
    phase: 'week',
    districts: CAMPAIGN.districts.map((d) => ({ id: d.id, name: d.name, patron: d.patron, modifier: d.modifier, order: 0, fallen: false })),
    incidents: [],
    missionsThisWeek: 0,
    takeover: 0,
    countdown: null,
    funding: 0,
    intel: 0,
    evidence: 0,
    kingpinUnlocked: false,
    roster: [],
    deployment: null,
    report: null,
    stats: { missionsAuto: 0, missionsDeployed: 0, wins: 0, partials: 0, losses: 0, fallen: 0, promotions: 0, recruits: 0, troopersLost: 0, ignored: 0 },
    outcome: null,
    endReason: null,
    rng: seedRng(setup.seed),
    log: [],
    nextId: 0,
    steps: 0,
  }
  const max = ctn(s, 'order.max')
  for (const d of s.districts) d.order = Math.min(max, ctn(s, 'order.start'))
  s.takeover = ctn(s, 'takeover.start')
  s.funding = ctn(s, 'start.funding')
  s.intel = ctn(s, 'start.intel')
  s.evidence = ctn(s, 'start.evidence')
  for (let i = 0; i < ctn(s, 'roster.start'); i++) s.roster.push(newTrooper(s))
  spawnIncidents({ s, ev: [] })
  return s
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n)

/** ROST-3: a squad is 1..squad.size distinct ready troopers. */
export function squadProblem(s: CampaignState, squad: unknown): string | null {
  if (!Array.isArray(squad)) return 'squad must be a list of trooper ids'
  if (squad.length < 1) return 'the squad needs at least one trooper'
  if (squad.length > ctn(s, 'squad.size')) return `the squad holds at most ${ctn(s, 'squad.size')} troopers`
  const seen = new Set<string>()
  for (const id of squad) {
    if (typeof id !== 'string') return 'squad ids must be strings'
    if (seen.has(id)) return 'a trooper is listed twice'
    seen.add(id)
    const t = trooperOf(s, id)
    if (!t) return `no trooper ${id}`
    if (t.status !== 'ready') return `${t.name} is ${t.status === 'dead' ? 'dead' : 'injured'}`
  }
  return null
}

/** OPS-1 / AUTO-1 preconditions. */
function missionProblem(s: CampaignState, incident: unknown, squad: unknown): string | null {
  if (s.phase !== 'week') return 'a mission is already running'
  if (s.missionsThisWeek >= ctn(s, 'week.missions')) return 'the squad has already gone out this week'
  if (typeof incident !== 'string') return 'needs an incident id'
  const inc = s.incidents.find((i) => i.id === incident)
  if (!inc) return `no incident ${incident} this week`
  if (inc.result !== null) return 'that incident is closed'
  return squadProblem(s, squad)
}

/** OPS-7: a reported mission result must match the deployment. */
function resultProblem(s: CampaignState, r: unknown): string | null {
  const dep = s.deployment
  if (!dep) return 'no mission is deployed'
  if (!r || typeof r !== 'object') return 'result must be an object'
  const res = r as Partial<MissionResult>
  if (res.outcome !== 'win' && res.outcome !== 'partial' && res.outcome !== 'loss') return 'result outcome must be win, partial or loss'
  for (const k of ['intel', 'evidence', 'civilianCasualties'] as const) if (!isInt(res[k]) || (res[k] as number) < 0) return `result ${k} must be a non-negative integer`
  if (!Array.isArray(res.troopers) || res.troopers.length !== dep.squad.length) return 'result must list every deployed trooper once'
  const ids = new Set<string>()
  for (const t of res.troopers) {
    if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !dep.squad.includes(t.id) || ids.has(t.id)) return 'result troopers must match the deployed squad'
    ids.add(t.id)
    if (typeof t.dead !== 'boolean' || typeof t.downed !== 'boolean') return 'trooper dead / downed must be booleans'
    if (t.dead && t.downed) return 'a trooper cannot be both dead and downed'
    if (!isInt(t.hp) || !isInt(t.maxHp) || t.maxHp < 1 || t.hp < 0 || t.hp > t.maxHp) return 'trooper hp must be integers with 0 <= hp <= maxHp'
    if (!isInt(t.arrests) || t.arrests < 0) return 'trooper arrests must be a non-negative integer'
  }
  return null
}

/** Returns a reason when the action is illegal in this state, else null. */
export function campaignActionProblem(s: CampaignState, a: unknown): string | null {
  if (s.outcome) return 'the campaign is over'
  if (!a || typeof a !== 'object') return 'action must be an object'
  const act = a as Record<string, unknown>
  switch (act.type) {
    case 'deploy':
    case 'autoResolve':
      return missionProblem(s, act.incident, act.squad)
    case 'report':
      return s.phase !== 'deployed' ? 'no mission is deployed' : resultProblem(s, act.result)
    case 'abort':
      return s.phase !== 'deployed' ? 'no mission is deployed' : null
    case 'promote': {
      if (s.phase !== 'week') return 'not while a mission is running'
      if (typeof act.trooper !== 'string') return 'needs a trooper id'
      const t = trooperOf(s, act.trooper)
      if (!t || !living(t)) return 'no such living trooper'
      if (t.cls !== 'recruit') return `${t.name} is already a specialist`
      if (t.rank < ctn(s, 'promotion.rank')) return `${t.name} needs rank ${ctn(s, 'promotion.rank')} to promote`
      if (typeof act.cls !== 'string' || !CAMPAIGN.specialties.includes(act.cls)) return 'unknown specialty'
      return null
    }
    case 'recruit':
      if (s.phase !== 'week') return 'not while a mission is running'
      if (s.roster.filter(living).length >= ctn(s, 'roster.max')) return 'the barracks are full'
      if (s.funding < ctn(s, 'recruit.cost')) return 'not enough Funding'
      return null
    case 'treat': {
      if (s.phase !== 'week') return 'not while a mission is running'
      if (typeof act.trooper !== 'string') return 'needs a trooper id'
      const t = trooperOf(s, act.trooper)
      if (!t || t.status !== 'injured') return 'that trooper is not injured'
      if (s.funding < ctn(s, 'treat.cost')) return 'not enough Funding'
      return null
    }
    case 'endWeek':
      return s.phase === 'week' ? null : 'finish or abort the mission first'
    default:
      return 'unknown action type'
  }
}

function squadOf(s: CampaignState, ids: string[]): Trooper[] { return ids.map((id) => trooperOf(s, id)!) }

export function stepCampaign(state: CampaignState, action: CampaignAction): CampaignStepResult {
  try {
    const problem = campaignActionProblem(state, action)
    if (problem) return { ok: false, reason: problem }
    const { log, ...rest } = state
    const s = structuredClone(rest) as CampaignState
    const a = JSON.parse(JSON.stringify(action)) as CampaignAction
    s.log = [...log, a]
    s.steps = state.steps + 1
    const c: CCtx = { s, ev: [] }
    switch (a.type) {
      case 'deploy': {
        const inc = s.incidents.find((i) => i.id === a.incident)!
        s.phase = 'deployed'
        s.deployment = { incident: inc.id, squad: [...a.squad], setup: incidentSetup(s, inc, squadOf(s, a.squad)) }
        emit(c, 'deployed', { incident: inc.id, squad: a.squad, seed: inc.seed })
        break
      }
      case 'autoResolve': {
        const inc = s.incidents.find((i) => i.id === a.incident)!
        const r = autoResult(c, inc, squadOf(s, a.squad))
        applyResult(c, inc, r.result, 'auto', r.roll, r.breakdown)
        break
      }
      case 'report':
      case 'abort': {
        const dep = s.deployment!
        const inc = s.incidents.find((i) => i.id === dep.incident)!
        const res: MissionResult = a.type === 'report' ? a.result : { outcome: 'loss', intel: 0, evidence: 0, civilianCasualties: 0, troopers: dep.squad.map((id) => ({ id, dead: false, downed: false, hp: 1, maxHp: 1, arrests: 0 })) }
        s.phase = 'week'
        s.deployment = null
        applyResult(c, inc, res, a.type === 'report' ? 'deployed' : 'aborted', null, null)
        break
      }
      case 'promote': {
        const t = trooperOf(s, a.trooper)!
        t.cls = a.cls
        s.stats.promotions++
        emit(c, 'promoted', { trooper: t.id, cls: a.cls })
        break
      }
      case 'recruit': {
        s.funding -= ctn(s, 'recruit.cost')
        const t = newTrooper(s)
        s.roster.push(t)
        s.stats.recruits++
        emit(c, 'recruited', { trooper: t.id, name: t.name, cost: ctn(s, 'recruit.cost'), funding: s.funding })
        break
      }
      case 'treat': {
        const t = trooperOf(s, a.trooper)!
        s.funding -= ctn(s, 'treat.cost')
        t.status = 'ready'
        t.injuryWeeks = 0
        emit(c, 'treated', { trooper: t.id, cost: ctn(s, 'treat.cost'), funding: s.funding })
        break
      }
      case 'endWeek':
        endWeek(c)
        break
    }
    if (s.outcome) { s.phase = 'over'; s.deployment = null }
    return { ok: true, state: s, events: c.ev }
  } catch (e) {
    return { ok: false, reason: `internal error: ${(e as Error).message}` }
  }
}
