// Test hook: window.__px. Read-mostly, plus the few commands the Playwright tests need (dispatch, autoplay, camera).
import { randomAction } from '../engine'
import type { Action } from '../engine'
import { boardApi } from './board/CameraRig'
import { autoplayStep, dispatch, endTurn, onTileTap, selectUnit, updateSettings, startGame, MAP_ID } from './game/controller'
import { animStats, playedEver, playing } from './anim/cues'
import { rigKinds } from './anim/assets'
import { useStore } from './game/store'
import { legalFor } from './game/tap'
import type { CampaignAction } from '../campaign'
import { cdispatch, newCampaign } from './campaign/controller'
import { districtCenter } from './campaign/layout'
import { cityApi } from './campaign/City'

export function installHook(): void {
  const api = {
    camera: () => {
      const c = boardApi.controller
      return c ? { x: c.view.x, z: c.view.z, az: c.view.az, pol: c.view.pol, dist: c.view.dist, overview: c.overview } : null
    },
    tileToScreen: (x: number, y: number) => boardApi.tileToScreen(x, y),
    state: () => useStore.getState().state,
    fog: () => useStore.getState().fog,
    screen: () => useStore.getState().screen,
    busy: () => useStore.getState().busy,
    selected: () => useStore.getState().selected,
    ticker: () => useStore.getState().ticker.map((l) => l.text),
    models: () => useStore.getState().models,
    /** The clip a rigged figure plays now (null: the unit has no rig), every clip it has played, the rigged kinds, and mixer counters. */
    anim: (unitId: string) => playing.get(unitId) ?? null,
    animSeen: (unitId: string) => [...(playedEver.get(unitId) ?? [])],
    rigKinds: () => rigKinds(),
    animStats: () => ({ ...animStats }),
    legal: () => { const s = useStore.getState().state; return s ? legalFor(s) : [] },
    dispatch: (a: Action) => dispatch(a),
    endTurn: () => endTurn(),
    select: (id: string) => selectUnit(id),
    tap: (x: number, y: number) => onTileTap({ x, y }, 'mouse'),
    setSpeed: (speed: 'normal' | 'fast' | 'instant') => updateSettings({ speed }),
    start: (squad: string[], seed: number) => startGame({ mapId: MAP_ID, squad, seed }),
    /** Campaign (spec 20): the state, the city selection, and the screen-space point of a district plate's centre. */
    campaign: () => useStore.getState().campaign,
    cincident: () => useStore.getState().cincident,
    cpanel: () => useStore.getState().cpanel,
    mode: () => useStore.getState().mode,
    newCampaign: (seed: number) => newCampaign(seed),
    /** One campaign action through the controller (as the UI would); returns the refusal reason or null. */
    cstep: (a: CampaignAction) => { const ok = cdispatch(a); return ok ? null : useStore.getState().cerror },
    districtToScreen: (i: number) => { const c = districtCenter(i); return cityApi.project ? cityApi.project(c.x, 0, c.z) : null },
    /** One random squad action (or End Turn). */
    randomStep: async (salt = 0, endChance = 0.35) => {
      const s = useStore.getState().state
      if (!s || s.phase !== 'squad' || useStore.getState().busy) return false
      const a = randomAction(s, salt, undefined, endChance)
      if (a.type === 'endPhase') await endTurn()
      else await dispatch(a)
      return true
    },
    /** Play random squad actions (syndicate by the real policy) until the end screen or the step budget. */
    autoplay: async (maxSteps = 4000) => {
      let n = 0
      while (n++ < maxSteps && useStore.getState().screen === 'play') {
        if (useStore.getState().busy) { await new Promise((r) => setTimeout(r, 5)); continue }
        await autoplayStep(n)
      }
      return { screen: useStore.getState().screen, steps: n, round: useStore.getState().state?.round ?? 0 }
    },
  }
  ;(window as unknown as { __px: typeof api }).__px = api
}
