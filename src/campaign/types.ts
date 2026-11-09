// Spec 20: the campaign state. Plain JSON only (CMP-5).
import type { CampaignTuning } from '../data'
import type { DeepPartial, Setup } from '../engine/types'

export type { CampaignTuning }
export type CPhase = 'week' | 'deployed' | 'over'
export type COutcome = 'won' | 'lost'
export type MOutcome = 'win' | 'partial' | 'loss'
export type IncidentKind = 'bust' | 'raid'
export type IncidentRole = 'regular' | 'retake' | 'kingpin'
export type TrooperStatus = 'ready' | 'injured' | 'dead'

export interface CampaignSetup {
  seed: number
  tuning?: DeepPartial<CampaignTuning>
}

export interface District {
  id: string
  name: string
  patron: string
  modifier: string
  order: number
  fallen: boolean
}

export interface Incident {
  id: string
  district: string
  kind: IncidentKind
  role: IncidentRole
  difficulty: number
  seed: number
  /** null while open; the mission outcome once resolved. */
  result: MOutcome | null
}

export interface Trooper {
  id: string
  name: string
  cls: string
  rank: number
  xp: number
  status: TrooperStatus
  injuryWeeks: number
  missions: number
  arrests: number
}

export interface Deployment { incident: string; squad: string[]; setup: Setup }

/** OPS-6 / OPS-7: what a mission did, from a tactical end state or from auto-resolve. */
export interface TrooperResult { id: string; dead: boolean; downed: boolean; hp: number; maxHp: number; arrests: number }
export interface MissionResult {
  outcome: MOutcome
  intel: number
  evidence: number
  civilianCasualties: number
  troopers: TrooperResult[]
}

export interface AutoBreakdown {
  strength: number
  members: { id: string; base: number; rank: number; specialty: number; total: number }[]
  threshold: number
  difficulty: number
  raid: number
  raw: number
  win: number
  partial: number
  loss: number
}

export interface TrooperChange { id: string; name: string; cls: string; xp: number; rankFrom: number; rankTo: number; injuryWeeks: number; dead: boolean; arrests: number }
export interface Report {
  week: number
  incident: Incident
  districtName: string
  mode: 'auto' | 'deployed' | 'aborted'
  outcome: MOutcome
  roll: number | null
  breakdown: AutoBreakdown | null
  orderFrom: number
  orderTo: number
  fell: boolean
  retaken: boolean
  takeoverFrom: number
  takeoverTo: number
  intel: number
  evidence: number
  arrests: number
  civilianCasualties: number
  troopers: TrooperChange[]
}

export interface Stats {
  missionsAuto: number
  missionsDeployed: number
  wins: number
  partials: number
  losses: number
  fallen: number
  promotions: number
  recruits: number
  troopersLost: number
  ignored: number
}

export interface CampaignState {
  setup: CampaignSetup
  tuning: CampaignTuning
  week: number
  phase: CPhase
  districts: District[]
  incidents: Incident[]
  /** Missions resolved this week (WEEK-2). */
  missionsThisWeek: number
  takeover: number
  /** TAKE-5: weeks left once the final countdown runs, else null. */
  countdown: number | null
  funding: number
  intel: number
  evidence: number
  kingpinUnlocked: boolean
  roster: Trooper[]
  deployment: Deployment | null
  report: Report | null
  stats: Stats
  outcome: COutcome | null
  endReason: string | null
  rng: number[]
  log: CampaignAction[]
  nextId: number
  steps: number
}

export type CampaignAction =
  | { type: 'deploy'; incident: string; squad: string[] }
  | { type: 'autoResolve'; incident: string; squad: string[] }
  | { type: 'report'; result: MissionResult }
  | { type: 'abort' }
  | { type: 'promote'; trooper: string; cls: string }
  | { type: 'recruit' }
  | { type: 'treat'; trooper: string }
  | { type: 'endWeek' }

export type CampaignEvent = { kind: string; week: number; [k: string]: any }
export type CampaignStepResult = { ok: true; state: CampaignState; events: CampaignEvent[] } | { ok: false; reason: string }
export interface CCtx { s: CampaignState; ev: CampaignEvent[] }
