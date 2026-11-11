// Save / Continue (rule 22): one versioned envelope in localStorage key `px-save` (engine serialize / deserialize), plus settings.
import { deserialize, legalActions, serialize, view } from '../../engine'
import type { State } from '../../engine'

export const SAVE_KEY = 'px-save'
export const SETTINGS_KEY = 'px-settings'
export const MOUSE3_KEY = 'px-mouse-3btn'

export type Speed = 'normal' | 'fast' | 'instant'
/** `actionCam`: shots play over the shooter's shoulder and a killing shot cuts to the victim (Normal and Fast speeds). */
/** `slowMo`: bullet time while a shot's rounds are in the air, so they can be followed from the muzzle to the target. */
export interface Settings { speed: Speed; lite: boolean; mute: boolean; volume: number; rain: boolean; actionCam: boolean; slowMo: boolean }
export const DEFAULT_SETTINGS: Settings = { speed: 'normal', lite: false, mute: false, volume: 0.6, rain: true, actionCam: true, slowMo: true }

export function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

export function loadSettings(): Settings {
  try {
    const raw = storage()?.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const j = JSON.parse(raw) as Partial<Settings>
    return {
      speed: j.speed === 'fast' || j.speed === 'instant' ? j.speed : 'normal',
      lite: !!j.lite,
      mute: !!j.mute,
      rain: j.rain !== false,
      actionCam: j.actionCam !== false,
      slowMo: j.slowMo !== false,
      volume: typeof j.volume === 'number' && j.volume >= 0 && j.volume <= 1 ? j.volume : DEFAULT_SETTINGS.volume,
    }
  } catch { return { ...DEFAULT_SETTINGS } }
}
export function storeSettings(s: Settings): void {
  try { storage()?.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch { /* refused storage is not fatal for settings */ }
}

export interface SaveMeta { savedAt: number; squad: string[]; round: number; phase: string; alarm: number; seed: number; actions: number }

export type SaveRead =
  | { kind: 'none' }
  | { kind: 'ok'; state: State; meta: SaveMeta }
  | { kind: 'bad'; reason: string }

export function writeSave(state: State, key = SAVE_KEY): { ok: true } | { ok: false; reason: string } {
  const st = storage()
  if (!st) return { ok: false, reason: 'browser storage is unavailable' }
  try {
    st.setItem(key, JSON.stringify({ ...serialize(state), savedAt: Date.now() }))
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message || 'browser storage refused the save' }
  }
}

export function clearSave(key = SAVE_KEY): void {
  try { storage()?.removeItem(key) } catch { /* nothing to do */ }
}

export function readSave(key = SAVE_KEY): SaveRead {
  let raw: string | null = null
  try { raw = storage()?.getItem(key) ?? null } catch (e) { return { kind: 'bad', reason: `storage refused the read: ${(e as Error).message}` } }
  if (raw === null) return { kind: 'none' }
  const d = deserialize(raw)
  if (!d.ok) return { kind: 'bad', reason: d.reason }
  const state = d.state
  try {
    // Prove the snapshot is usable before offering it: fog view, legal actions, and the fields the HUD reads.
    view(state, 'squad')
    if (!state.outcome) legalActions(state)
    const squad = state.units.filter((u) => u.side === 'squad').map((u) => u.kind)
    if (!squad.length || typeof state.round !== 'number' || typeof state.alarm !== 'number') return { kind: 'bad', reason: 'save is missing squad or round data' }
    const j = JSON.parse(raw) as { savedAt?: number }
    return { kind: 'ok', state, meta: { savedAt: typeof j.savedAt === 'number' ? j.savedAt : 0, squad, round: state.round, phase: state.phase, alarm: state.alarm, seed: state.setup.seed, actions: state.log.length } }
  } catch (e) {
    return { kind: 'bad', reason: `snapshot cannot be opened: ${(e as Error).message}` }
  }
}
