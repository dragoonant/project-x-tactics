// Animation cues: the mutable module state between the presentation director (which knows what just happened) and the rigged figures
// (which draw every frame). Like `motion` in game/presentation.ts it is read every frame and must not trigger React renders.
import type { Pt } from '../../engine'
import type { ClipName } from './contract'

/** A transient clip the director wants a unit to play: `clip` for `dur` wall ms starting at `t0`, at `scale` x the clip's natural speed. */
export interface Cue { seq: number; clip: ClipName; t0: number; dur: number; scale: number; face?: Pt; started: boolean }
export const cues = new Map<string, Cue>()

/** Unit state shown until the director reaches the event that changes it (a unit killed at the end of a batch keeps standing while the shot plays). */
export const holds = new Map<string, { status: string }>()

/** Test and perf hooks: the clip each rig is playing now, every clip it has played since the game began, and per-frame counters. */
export const playing = new Map<string, string>()
export const playedEver = new Map<string, Set<string>>()
export const animStats = { ms: 0, frames: 0, rigs: 0, visible: 0, updated: 0, skippedOffscreen: 0, skippedFrozen: 0 }

let seq = 1
export function playCue(unit: string, clip: ClipName, ms: number, scale = 1, face?: Pt): void {
  cues.set(unit, { seq: seq++, clip, t0: performance.now(), dur: Math.max(1, ms), scale, started: false, ...(face ? { face } : {}) })
}
/**
 * The cue a unit is playing now. A cue the rig has not yet picked up stays active a little past its end (frames can be slower than a
 * short cue, e.g. a 0.3 s aim on a slow device): the rig starts it on its next frame, restarts its clock, and plays it in full.
 */
export function cueActive(unit: string, now = performance.now()): Cue | null {
  const c = cues.get(unit)
  if (!c) return null
  return now < c.t0 + c.dur || (!c.started && now < c.t0 + c.dur + 2500) ? c : null
}
/** Called by the rig the first time it sees a cue: the clock starts now. */
export function startCue(c: Cue, now = performance.now()): void {
  if (c.started) return
  c.started = true
  c.t0 = now
}
export function clearCues(): void { cues.clear(); holds.clear() }
export function resetPlayed(): void { playedEver.clear(); playing.clear() }
export function notePlayed(unit: string, clip: string): void {
  playing.set(unit, clip)
  let s = playedEver.get(unit)
  if (!s) { s = new Set(); playedEver.set(unit, s) }
  s.add(clip)
}
