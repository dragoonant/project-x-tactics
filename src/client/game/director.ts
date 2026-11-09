// Presentation director: turns the events of ONE accepted action into motion and effects, one beat at a time, and resolves when the
// animation is done. The syndicate loop awaits this before asking the policy for its next action, so the bot never acts ahead of
// what is on screen. Speed: normal / fast / instant (instant resolves at once, with no effects).
import type { GameEvent, Pt, State } from '../../engine'
import { view } from '../../engine'
import type { Speed } from './persist'
import { addFx, camApi, motion, wake } from './presentation'

export const SPEED_FACTOR: Record<Speed, number> = { normal: 1, fast: 0.4, instant: 0 }

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface PresentOpts { speed: Speed; follow: boolean; alive: () => boolean }

function visibleIds(s: State): Set<string> {
  const v = view(s, 'squad')
  return new Set(v.units.map((u) => u.id))
}

const MS_PER_TILE = 115

export async function present(events: GameEvent[], before: State, after: State, opts: PresentOpts): Promise<void> {
  const k = SPEED_FACTOR[opts.speed]
  if (k === 0 || events.length === 0) { motion.clear(); return }
  const seeBefore = visibleIds(before), seeAfter = visibleIds(after)
  const seen = (id: unknown): boolean => typeof id === 'string' && (seeBefore.has(id) || seeAfter.has(id))
  const pos = new Map<string, Pt>()
  for (const u of before.units) pos.set(u.id, { x: u.x, y: u.y })
  const tileOf = (id: unknown): Pt | null => {
    if (typeof id !== 'string') return null
    const u = after.units.find((x) => x.id === id) ?? before.units.find((x) => x.id === id)
    return u ? { x: u.x, y: u.y } : null
  }
  const now0 = performance.now()
  let parallelEnd = 0

  const startMotion = (id: string, path: Pt[], t0: number): number => {
    const from = pos.get(id)
    const full = from ? [from, ...path] : path
    if (full.length < 2) return 0
    const dur = Math.max(260, (full.length - 1) * MS_PER_TILE) * k
    motion.set(id, { path: full, t0, dur })
    pos.set(id, full[full.length - 1]!)
    wake(dur + 100)
    return dur
  }

  // Civilian and flight movement runs in parallel at the start of the batch.
  for (const e of events) {
    if ((e.kind === 'civilianFlee' || e.kind === 'flee') && Array.isArray(e.path) && seen(e.unit)) {
      parallelEnd = Math.max(parallelEnd, startMotion(String(e.unit), e.path as Pt[], now0))
    } else if (e.kind === 'civilianMove' && e.from && e.to && seen(e.unit)) {
      const d = Math.max(300, 280) * k
      motion.set(String(e.unit), { path: [e.from as Pt, e.to as Pt], t0: now0, dur: d })
      pos.set(String(e.unit), e.to as Pt)
      parallelEnd = Math.max(parallelEnd, d)
      wake(d + 100)
    }
  }

  const follow = (p: Pt | null): void => { if (opts.follow && p) camApi.flyTo(p.x, p.y) }

  for (const e of events) {
    if (!opts.alive()) return
    let wait = 0
    switch (e.kind) {
      case 'move': {
        if (!Array.isArray(e.path) || !seen(e.unit)) { const last = (e.path as Pt[] | undefined)?.slice(-1)[0]; if (last && typeof e.unit === 'string') pos.set(e.unit, last); break }
        const path = e.path as Pt[]
        follow(path[path.length - 1] ?? null)
        wait = startMotion(String(e.unit), path, performance.now())
        break
      }
      case 'attack': {
        const a = tileOf(e.attacker), t = tileOf(e.target)
        if (a && t && (seen(e.attacker) || seen(e.target))) {
          follow(a)
          addFx({ kind: 'tracer', from: a, to: t, tone: e.outcome === 'miss' ? 'miss' : 'hit', dur: 380 * k })
          addFx({ kind: 'flash', at: a, dur: 180 * k })
          const label = e.outcome === 'hit' ? 'HIT' : e.outcome === 'graze' ? 'GRAZE' : 'MISS'
          addFx({ kind: 'text', at: t, text: label, tone: e.outcome === 'miss' ? 'miss' : 'hit', dur: 900 * k, t0: performance.now() + 220 * k })
          wait = 620 * k
        }
        break
      }
      case 'damage': {
        const t = tileOf(e.target)
        if (t && seen(e.target)) {
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
          wait = 380 * k
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
  if (parallelEnd > 0) await sleep(Math.max(0, parallelEnd - (performance.now() - now0)))
  wake(200)
}
