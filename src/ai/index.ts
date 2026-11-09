// Seam (frozen 2026-11-08): the client, the sim and the bench import the syndicate's decision policy from here.
// M3 replaces the body of `syndicatePolicy` with the utility AI; the signature and contract do not change.
import type { Action, State } from '../engine'
import { decideSyndicate } from './syndicate'

/**
 * A decision policy for one side.
 * Contract: called only when that side is acting and the game is not over; returns one of `legalActions(s)`;
 * reads hidden information only through `view(s, side)`; pure and deterministic for a given `s` (no Math.random,
 * no clock); fast enough to call once per action in the browser (budget: 50 ms on a desktop).
 */
export type Policy = (s: State) => Action

/** The syndicate's utility AI (M3). See `syndicate.ts`; `decideSyndicate(s).why` explains the choice for the log. */
export const syndicatePolicy: Policy = (s) => decideSyndicate(s).action
