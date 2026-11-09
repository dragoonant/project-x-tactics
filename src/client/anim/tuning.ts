// Animation timing constants (client-side presentation only; nothing here touches rules).
import type { ClipName } from './contract'

/** Crossfade seconds into a clip: quick for shots and reactions, 0.15-0.25 s for everything else (the brief's range). */
export function crossfade(into: ClipName): number {
  switch (into) {
    case 'fire': case 'hit': case 'aim': return 0.15
    case 'death': case 'downed': case 'surrender': case 'cuffed': return 0.25
    default: return 0.2
  }
}

/** Walk and run never play faster than this multiple of their natural speed (past it the legs blur; feet then slide, see perf.md). */
export const STRIDE_CAP = 3.5
export const cap = (): number => STRIDE_CAP

/** Seconds between mixer updates of a standing figure: idle breathing needs about 10 frames a second, not 60. */
export const IDLE_STEP = 0.1
export const idleStep = (): number => IDLE_STEP

/** Normal-speed beats, in ms; `k` (director speed factor) scales them. A shot is aim then fire; a rigged figure waits for its real clip. */
/** Non-looping state clips (death) play at the director's speed: Fast is 2.5x, Normal 1x. */
export const speedTimeScale = (speed: string): number => (speed === 'fast' ? 2.5 : 1)

export const AIM_MS = 320
export const REACTION_MAX_MS = 1200
