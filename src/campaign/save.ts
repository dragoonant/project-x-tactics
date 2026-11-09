// CMP-9: the versioned campaign save envelope (localStorage key px-campaign) and replay.
import type { CampaignAction, CampaignSetup, CampaignState } from './types'
import { createCampaign, stepCampaign } from './step'

export interface CampaignEnvelope { v: 1; kind: 'px-campaign'; setup: CampaignSetup; seed: number; actions: CampaignAction[]; state: CampaignState }

export function serializeCampaign(s: CampaignState): CampaignEnvelope {
  return JSON.parse(JSON.stringify({ v: 1, kind: 'px-campaign', setup: s.setup, seed: s.setup.seed, actions: s.log, state: s }))
}

export function deserializeCampaign(raw: unknown): { ok: true; state: CampaignState; envelope: CampaignEnvelope } | { ok: false; reason: string } {
  try {
    const env = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<CampaignEnvelope> | null
    if (!env || typeof env !== 'object') return { ok: false, reason: 'campaign save is not an object' }
    if (env.v !== 1) return { ok: false, reason: `unknown campaign save version ${String((env as { v?: unknown }).v)}` }
    if (env.kind !== 'px-campaign') return { ok: false, reason: 'not a campaign save' }
    if (!env.setup || typeof env.setup !== 'object' || typeof env.seed !== 'number') return { ok: false, reason: 'campaign save has no setup or seed' }
    if (!Array.isArray(env.actions)) return { ok: false, reason: 'campaign save has no action list' }
    const st = env.state as CampaignState | undefined
    if (!st || typeof st !== 'object' || !Array.isArray(st.districts) || !Array.isArray(st.roster) || !Array.isArray(st.incidents) || !Array.isArray(st.rng) || typeof st.week !== 'number' || !st.tuning) {
      return { ok: false, reason: 'campaign save has no valid state snapshot' }
    }
    return { ok: true, state: JSON.parse(JSON.stringify(st)) as CampaignState, envelope: env as CampaignEnvelope }
  } catch (e) {
    return { ok: false, reason: `unreadable campaign save: ${(e as Error).message}` }
  }
}

export function replayCampaign(setup: CampaignSetup, actions: CampaignAction[]): { ok: true; state: CampaignState } | { ok: false; reason: string; at: number } {
  let s = createCampaign(setup)
  for (let i = 0; i < actions.length; i++) {
    const r = stepCampaign(s, actions[i] as CampaignAction)
    if (!r.ok) return { ok: false, reason: r.reason, at: i }
    s = r.state
  }
  return { ok: true, state: s }
}
