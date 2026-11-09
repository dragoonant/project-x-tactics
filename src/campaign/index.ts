// Public campaign API (spec 20, CMP-1..9). Same contract as the tactical engine.
export { createCampaign, stepCampaign, campaignActionProblem, squadProblem } from './step'
export { legalCampaignActions, defaultSquad } from './legal'
export { campaignQuery, incidentTitle } from './query'
export type { TakeoverInfo, FundingInfo, DistrictInfo, IncidentBrief, TrooperInfo, CampaignSummary } from './query'
export { serializeCampaign, deserializeCampaign, replayCampaign } from './save'
export type { CampaignEnvelope } from './save'
export { checkCampaignInvariants } from './invariants'
export { incidentSetup, resultFromTactical, variantFor, BASE_MAP } from './bridge'
export type { VariantPlan, VariantNote } from './bridge'
export { POLICIES, randomPolicy, greedyPolicy, averagePolicy } from './policies'
export type { CampaignPolicy } from './policies'
export type {
  CampaignAction, CampaignEvent, CampaignSetup, CampaignState, CampaignStepResult, District, Incident, MissionResult, MOutcome, Report, Trooper, TrooperResult, AutoBreakdown,
} from './types'
