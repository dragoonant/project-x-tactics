// Seam (frozen 2026-11-08): the client, the sim and the bench import the syndicate's decision policy from here.
// M3 replaces the body of `syndicatePolicy` with the utility AI; the signature and contract do not change.
import type { Action, State } from '../engine'
import { randomAction } from '../engine'

/**
 * A decision policy for one side.
 * Contract: called only when that side is acting and the game is not over; returns one of `legalActions(s)`;
 * reads hidden information only through `view(s, side)`; pure and deterministic for a given `s` (no Math.random,
 * no clock); fast enough to call once per action in the browser (budget: 50 ms on a desktop).
 */
export type Policy = (s: State) => Action

/** Placeholder until M3: the seeded random policy (ENM-6). */
export const syndicatePolicy: Policy = (s) => randomAction(s, 0, undefined, 0.08)
