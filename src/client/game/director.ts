// Presentation director: turns the events of ONE accepted action into motion, animation cues and effects, one beat at a time, and
// resolves when the animation is done. The syndicate loop awaits this before asking the policy for its next action, so the bot never
// acts ahead of what is on screen. Speed: normal / fast / instant (instant resolves at once, with no effects: units show their end poses).
// Rigged figures (spec 30) get cues from src/client/anim/mapping.ts and the director waits for their real clip lengths; figures without
// a rig keep the fixed beats they always had.
import type { GameEvent, Pt, State, Unit } from '../../engine'
import { view } from '../../engine'
import { clipSeconds, rigFor } from '../anim/assets'
import type { ClipName } from '../anim/contract'
import { clearCues, cues, holds, playCue } from '../anim/cues'
import { STATUS_EVENTS, abilityClip, aimsFirst, attackClip, damageClip, moveMode } from '../anim/mapping'
import { AIM_MS, REACTION_MAX_MS } from '../anim/tuning'
import type { Speed } from './persist'
import { CINE_HOLD_MS, CINE_IN_MS, CINE_OUT_MS, KILL_HOLD_MS, KILL_MAX_MS, killPose, shotPose } from './cinematic'
import { addFx, camApi, focus, logCine, motion, wake } from './presentation'

export const SPEED_FACTOR: Record<Speed, number> = { normal: 1, fast: 0.4, instant: 0 }

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** `cine`: the action camera (over the shoulder for shots, a close-up when a shot kills). */
export interface PresentOpts { speed: Speed; follow: boolean; cine?: boolean; alive: () => boolean }

function visibleIds(s: State): Set<string> {
  const v = view(s, 'squad')
  return new Set(v.units.map((u) => u.id))
}

const MS_PER_TILE = 115
/** Rigged figures travel slower (their stride is clamped, see anim/tuning.ts) and dashes are quicker than walks. */
const MS_PER_TILE_RIG = 170
const MS_PER_TILE_RIG_RUN = 135

export async function present(events: GameEvent[], before: State, after: State, opts: PresentOpts): Promise<void> {
  const k = SPEED_FACTOR[opts.speed]
  if (k === 0 || events.length === 0) { motion.clear(); clearCues(); return }

  const unitOf = (id: unknown): Unit | undefined => {
    if (typeof id !== 'string') return undefined
    return after.units.find((x) => x.id === id) ?? before.units.find((x) => x.id === id)
  }
  const rigged = (id: unknown): boolean => { const u = unitOf(id); return !!u && rigFor(u.kind, u.weapon) !== null }
  /** Wall-clock ms of `clip` for this unit's rig at the current speed, or null when the unit has no rig or no such clip. */
  const clipMs = (id: unknown, clip: ClipName): number | null => {
    const u = unitOf(id)
    const sec = u ? clipSeconds(u.kind, u.weapon, clip) : null
    return sec === null ? null : sec * 1000 * k
  }
  /** Plays a clip as a cue and returns how long to wait for it (0 when there is no clip to wait for). */
  const cue = (id: unknown, clip: ClipName, ms: number, face?: Pt | null): void => {
    if (typeof id === 'string') { playCue(id, clip, ms, 1 / k, face ?? undefined); wake(ms + 100) }
  }

  // Units whose status changes in this batch keep their old standing pose until the event that changes it is reached.
  for (const b of before.units) {
    const a = after.units.find((x) => x.id === b.id)
    if (a && a.status !== b.status && rigFor(a.kind, a.weapon)) holds.set(b.id, { status: b.status })
  }
  try {
    await playEvents(events, before, after, opts, k, { unitOf, rigged, clipMs, cue })
  } finally {
    holds.clear()
    focus.cine = null
    camApi.release(CINE_OUT_MS * SPEED_FACTOR[opts.speed])
  }
}

interface Helpers {
  unitOf: (id: unknown) => Unit | undefined
  rigged: (id: unknown) => boolean
  clipMs: (id: unknown, clip: ClipName) => number | null
  cue: (id: unknown, clip: ClipName, ms: number, face?: Pt | null) => void
}

async function playEvents(events: GameEvent[], before: State, after: State, opts: PresentOpts, k: number, h: Helpers): Promise<void> {
  const seeBefore = visibleIds(before), seeAfter = visibleIds(after)
  const seen = (id: unknown): boolean => typeof id === 'string' && (seeBefore.has(id) || seeAfter.has(id))
  const pos = new Map<string, Pt>()
  for (const u of before.units) pos.set(u.id, { x: u.x, y: u.y })
  const tileOf = (id: unknown): Pt | null => {
    const u = h.unitOf(id)
    return u ? { x: u.x, y: u.y } : null
  }
  const now0 = performance.now()
  let parallelEnd = 0

  const startMotion = (id: string, path: Pt[], t0: number, mode: 'walk' | 'run' | 'panic'): number => {
    const from = pos.get(id)
    const full = from ? [from, ...path] : path
    if (full.length < 2) return 0
    const perTile = h.rigged(id) ? (mode === 'run' ? MS_PER_TILE_RIG_RUN : MS_PER_TILE_RIG) : MS_PER_TILE
    const dur = Math.max(260, (full.length - 1) * perTile) * k
    motion.set(id, { path: full, t0, dur, mode })
    pos.set(id, full[full.length - 1]!)
    wake(dur + 100)
    return dur
  }

  // Civilian and flight movement runs in parallel at the start of the batch.
  for (const e of events) {
    if ((e.kind === 'civilianFlee' || e.kind === 'flee') && Array.isArray(e.path) && seen(e.unit)) {
      const u = h.unitOf(e.unit)
      parallelEnd = Math.max(parallelEnd, startMotion(String(e.unit), e.path as Pt[], now0, u ? moveMode(e.kind, u, 2) : 'run'))
    } else if (e.kind === 'civilianMove' && e.from && e.to && seen(e.unit)) {
      const u = h.unitOf(e.unit)
      const d = Math.max(300, 280) * k
      motion.set(String(e.unit), { path: [e.from as Pt, e.to as Pt], t0: now0, dur: d, mode: u ? moveMode(e.kind, u, 2) : 'walk' })
      pos.set(String(e.unit), e.to as Pt)
      parallelEnd = Math.max(parallelEnd, d)
      wake(d + 100)
    }
  }

  const follow = (p: Pt | null): void => { if (opts.follow && p) camApi.flyTo(p.x, p.y) }

  // ---- action camera: over the shooter's shoulder for a ranged attack; when the shot kills, a close-up of the victim's death
  const walled = (wx: number, wz: number): boolean => {
    const t = camApi.tile(wx, wz)
    const tile = after.map.tiles[t.y * after.map.w + t.x]
    return !!tile && (tile.k === 'wall' || (tile.k === 'door' && !tile.open))
  }
  const glideMs = CINE_IN_MS * k // the camera glide keeps pace with the animation speed
  let cine: { shooter: string; target: string; kill: boolean } | null = null
  const release = (): void => { if (cine) { cine = null; focus.cine = null; camApi.release(CINE_OUT_MS * k) } }

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!
    if (!opts.alive()) return
    let wait = 0
    if (cine) {
      // the shot's own follow-up (damage, the victim's fall) keeps the action camera; anything else hands the camera back
      const own = (e.kind === 'damage' && e.target === cine.target) || (cine.kill && e.kind === 'death' && e.unit === cine.target)
      if (!own) release()
    }
    if (cine?.kill && e.kind === 'death' && e.unit === cine.target) {
      // cut to the victim before its held pose is released, so the whole fall plays in the close-up
      const s = h.unitOf(cine.shooter), v = tileOf(e.unit)
      if (s && v) {
        camApi.shot(...poseArgs(killPose(camApi.world(pos.get(s.id) ?? s), camApi.world(v), walled)), glideMs)
        focus.cine = [v]
        logCine(`kill:${e.unit}`)
        await sleep(CINE_IN_MS * k)
        if (!opts.alive()) return
      }
    }
    // A status change reaches the figure here: its held pose is released so the new state clip (downed, death, surrender, cuffed) plays.
    if (STATUS_EVENTS.has(e.kind) && typeof e.unit === 'string') {
      holds.delete(e.unit)
      if (cues.get(e.unit)?.clip === 'hit') cues.delete(e.unit)
    }
    switch (e.kind) {
      case 'move': {
        if (!Array.isArray(e.path) || !seen(e.unit)) { const last = (e.path as Pt[] | undefined)?.slice(-1)[0]; if (last && typeof e.unit === 'string') pos.set(e.unit, last); break }
        const path = e.path as Pt[]
        follow(path[path.length - 1] ?? null)
        const u = h.unitOf(e.unit)
        const b = before.units.find((x) => x.id === e.unit)
        wait = startMotion(String(e.unit), path, performance.now(), u ? moveMode('move', u, b?.actions ?? 2) : 'walk')
        break
      }
      case 'ability': {
        const c = abilityClip(String(e.ability))
        if (!c || !seen(e.unit)) break
        const face = (e.target ? tileOf(e.target) : (e.at as Pt | null | undefined)) ?? null
        const ms = h.clipMs(e.unit, c)
        if (ms !== null) {
          if (c === 'fire' && h.clipMs(e.unit, 'aim') !== null) { const aim = AIM_MS * k; h.cue(e.unit, 'aim', aim, face); await sleep(aim) }
          h.cue(e.unit, c, ms, face)
          wait = ms
        }
        break
      }
      case 'attack': {
        const a = tileOf(e.attacker), t = tileOf(e.target)
        if (a && t && (seen(e.attacker) || seen(e.target))) {
          follow(a)
          const clip = attackClip(e)
          if (opts.cine && clip === 'fire' && seen(e.attacker) && seen(e.target) && typeof e.attacker === 'string' && typeof e.target === 'string') {
            cine = { shooter: e.attacker, target: e.target, kill: killsBeforeNextAttack(events, i, e.target) }
            camApi.shot(...poseArgs(shotPose(camApi.world(a), camApi.world(t), walled)), glideMs)
            focus.cine = [a, t]
            logCine(`shot:${e.attacker}:${e.target}`)
            await sleep(CINE_IN_MS * k)
            if (!opts.alive()) return
          }
          const fireMs = h.clipMs(e.attacker, clip)
          const anim = fireMs !== null // the attacker has the clip: wait for it; otherwise the old fixed beat
          let delay = 0
          if (anim && aimsFirst(clip) && h.clipMs(e.attacker, 'aim') !== null) {
            const aim = AIM_MS * k
            h.cue(e.attacker, 'aim', aim, t)
            await sleep(aim)
            if (!opts.alive()) return
          }
          if (anim) {
            h.cue(e.attacker, clip, fireMs, t)
            delay = fireMs * (clip === 'fire' ? 0.12 : 0.45) // the shot leaves the muzzle / the blow lands a moment into the clip
            if (delay > 0) await sleep(delay)
          }
          addFx({ kind: 'tracer', from: a, to: t, tone: e.outcome === 'miss' ? 'miss' : 'hit', dur: 380 * k })
          if (!h.rigged(e.attacker)) addFx({ kind: 'flash', at: a, dur: 180 * k })
          const label = e.outcome === 'hit' ? 'HIT' : e.outcome === 'graze' ? 'GRAZE' : 'MISS'
          addFx({ kind: 'text', at: t, text: label, tone: e.outcome === 'miss' ? 'miss' : 'hit', dur: 900 * k, t0: performance.now() + 220 * k })
          wait = anim ? Math.max(0, fireMs - delay) : 620 * k
        }
        break
      }
      case 'damage': {
        const t = tileOf(e.target)
        if (t && seen(e.target)) {
          if (damageClip(e) && h.clipMs(e.target, 'hit') !== null) h.cue(e.target, 'hit', h.clipMs(e.target, 'hit')!)
          const hp = typeof e.hp === 'number' ? e.hp : 0, res = typeof e.resolve === 'number' ? e.resolve : 0
          const txt = [hp > 0 ? `-${hp} HP` : '', res > 0 ? `-${res} RES` : ''].filter(Boolean).join('  ')
          if (txt) { addFx({ kind: 'text', at: { x: t.x, y: t.y }, text: txt, tone: 'dmg', dur: 1000 * k }); wait = 220 * k }
        }
        break
      }
      case 'explosion': {
        const at = e.at as Pt | undefined
        if (at) { follow(at); addFx({ kind: 'burst', at, tone: 'fire', r: 1.4, dur: 700 * k }); wait = 650 * k }
        break
      }
      case 'gasCloud': {
        const at = e.at as Pt | undefined
        if (at) { follow(at); addFx({ kind: 'ring', at, tone: 'gas', r: 2, dur: 700 * k }); wait = 450 * k }
        break
      }
      case 'support': {
        const at = e.at as Pt | undefined
        if (at) { addFx({ kind: 'ring', at, tone: e.option === 'scan' ? 'scan' : e.option === 'smoke' ? 'smoke' : 'light', r: 2.2, dur: 800 * k }); wait = 400 * k }
        break
      }
      case 'surrender': case 'cuffed': case 'downed': case 'death': case 'stabilized': {
        const t = tileOf(e.unit)
        if (t && seen(e.unit)) {
          const label = e.kind === 'surrender' ? 'SURRENDERS' : e.kind === 'cuffed' ? 'CUFFED' : e.kind === 'downed' ? 'DOWN' : e.kind === 'death' ? 'DEAD' : 'STABILIZED'
          addFx({ kind: 'text', at: t, text: label, tone: e.kind === 'death' || e.kind === 'downed' ? 'dmg' : 'good', dur: 1100 * k })
          // a rigged figure plays its state clip (death, downed, surrender, cuffed): wait for it, up to a cap
          const clip: ClipName = e.kind === 'death' ? 'death' : e.kind === 'downed' ? 'downed' : e.kind === 'surrender' ? 'surrender' : e.kind === 'cuffed' ? 'cuffed' : 'idle'
          const ms = h.clipMs(e.unit, clip)
          wait = Math.max(380 * k, ms === null ? 0 : Math.min(ms, REACTION_MAX_MS * k))
          // the kill close-up waits for the whole fall, then holds on the body a moment
          if (cine?.kill && e.kind === 'death' && e.unit === cine.target) wait = Math.min(KILL_MAX_MS * k, (ms ?? 0) + KILL_HOLD_MS * k)
        }
        break
      }
      case 'lampDestroyed': {
        const at = e as unknown as Pt
        if (typeof at.x === 'number') addFx({ kind: 'burst', at: { x: at.x, y: at.y }, tone: 'spark', r: 0.8, dur: 400 * k })
        break
      }
      case 'wave': wait = 500 * k; break
      default: break
    }
    if (wait > 0) await sleep(wait)
  }
  if (cine) { await sleep(CINE_HOLD_MS * k); release() }
  if (parallelEnd > 0) await sleep(Math.max(0, parallelEnd - (performance.now() - now0)))
  wake(200)
}

const poseArgs = (p: { pos: [number, number, number]; look: [number, number, number] }): [[number, number, number], [number, number, number]] => [p.pos, p.look]

/** True when `target` dies in this batch before the next attack event (so the attack at index `i` is the killing shot). */
export function killsBeforeNextAttack(events: GameEvent[], i: number, target: string): boolean {
  for (let j = i + 1; j < events.length; j++) {
    const x = events[j]!
    if (x.kind === 'attack') return false
    if (x.kind === 'death' && x.unit === target) return true
  }
  return false
}
