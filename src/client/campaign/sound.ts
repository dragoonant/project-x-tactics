// Strategy audio (spec 40): the city music loop and six cues, played only if the manifest lists them. Follows the game's mute
// and volume settings; a refused play() (no user gesture yet) is silent, never an error.
import { useStrategyAssets } from './assets'
import { useStore } from '../game/store'

let bgm: HTMLAudioElement | null = null

function level(): number {
  const s = useStore.getState().settings
  return s.mute ? 0 : s.volume
}

export function cityMusic(on: boolean): void {
  const url = useStrategyAssets.getState().music
  if (!on || !url || level() === 0) { bgm?.pause(); bgm = null; return }
  if (bgm && bgm.dataset.src === url) { bgm.volume = level() * 0.6; return }
  bgm?.pause()
  try {
    bgm = new Audio(url)
    bgm.dataset.src = url
    bgm.loop = true
    bgm.volume = level() * 0.6
    void bgm.play().catch(() => { /* waits for a gesture; the next cityMusic call retries */ })
  } catch { bgm = null }
}

/** Cue ids: incident, week, takeover, district-fall, deploy, case-reveal. */
export function cue(id: string): void {
  const url = useStrategyAssets.getState().sfx[id]
  if (!url || level() === 0) return
  try {
    const a = new Audio(url)
    a.volume = level()
    void a.play().catch(() => { /* no gesture yet */ })
  } catch { /* audio unavailable */ }
}
