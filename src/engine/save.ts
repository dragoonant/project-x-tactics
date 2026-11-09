// SAV-1/2: versioned save envelope and replay.
import type { Action, Setup, State } from './types'
import { createGame } from './setup'
import { step } from './step'

export interface SaveEnvelope { v: 1; setup: Setup; seed: number; actions: Action[]; state: State }

export function serialize(s: State): SaveEnvelope {
  return JSON.parse(JSON.stringify({ v: 1, setup: s.setup, seed: s.setup.seed, actions: s.log, state: s }))
}

export function deserialize(raw: unknown): { ok: true; state: State; envelope: SaveEnvelope } | { ok: false; reason: string } {
  try {
    const env = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<SaveEnvelope> | null
    if (!env || typeof env !== 'object') return { ok: false, reason: 'save is not an object' }
    if (env.v !== 1) return { ok: false, reason: `unknown save version ${String((env as { v?: unknown }).v)}` }
    if (!env.setup || typeof env.setup !== 'object') return { ok: false, reason: 'save has no setup' }
    if (typeof env.seed !== 'number') return { ok: false, reason: 'save has no seed' }
    if (!Array.isArray(env.actions)) return { ok: false, reason: 'save has no action list' }
    const st = env.state as State | undefined
    if (!st || typeof st !== 'object' || !Array.isArray(st.units) || !st.map || !Array.isArray(st.map.tiles) || !Array.isArray(st.rng)) return { ok: false, reason: 'save has no valid state snapshot' }
    const state = JSON.parse(JSON.stringify(st)) as State
    return { ok: true, state, envelope: env as SaveEnvelope }
  } catch (e) {
    return { ok: false, reason: `unreadable save: ${(e as Error).message}` }
  }
}

/** SAV-2: rebuild a state from setup + accepted actions. */
export function replay(setup: Setup, actions: Action[]): { ok: true; state: State } | { ok: false; reason: string; at: number } {
  let s = createGame(setup)
  for (let i = 0; i < actions.length; i++) {
    const r = step(s, actions[i] as Action)
    if (!r.ok) return { ok: false, reason: r.reason, at: i }
    s = r.state
  }
  return { ok: true, state: s }
}
