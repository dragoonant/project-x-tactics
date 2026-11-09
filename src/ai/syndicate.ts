// The syndicate's "simple but fair" utility AI (PROTOTYPE-PLAN section 7, spec ENM-*).
//
// One call = one action. Each call looks at the units that still have actions (Fixer first, Bagman last), scores
// every reachable tile and every plan that ends the turn there, and returns the best action that the engine
// accepts. The next call sees the new state, so "move, then shoot" is two calls that agree with each other.
//
// Fairness: perception goes through `view(s, 'syndicate')` only. A trooper the syndicate cannot see is not in that
// view, so it is never targeted, never counted as a threat and never moved towards (only its last-seen ghost is).
// Pure and deterministic: ties are broken by `jitter`, seeded from the game seed and step counter.
import type { Action, State, Unit } from '../engine'
import { actionProblem, randomAction, view } from '../engine'
import { bfs, distField, tilesOfKind } from '../engine/grid'
import { hasLOS } from '../engine/los'
import { dist, tn } from '../engine/util'
import { idNum, jitter, weapon } from './geo'
import { shotsFrom, tileInfo, tileScore, type Ctx, type Shot } from './score'
import { weights as W } from './weights'

export interface Decision { action: Action; why: string }
/** Diagnostics only (the bench reads these; they never influence a decision). */
export const stats = { decisions: 0, rejected: 0, fallbacks: 0 }

interface Cand { action: Action; score: number; why: string }

export function decideSyndicate(s: State): Decision {
  stats.decisions++
  if (s.outcome || s.phase !== 'syndicate') {
    stats.fallbacks++
    return { action: randomAction(s), why: 'not the syndicate phase' }
  }
  const v = view(s, 'syndicate')
  const c: Ctx = { s, v, troopers: v.units.filter((u) => u.side === 'squad' && u.status === 'active'), tiles: new Map() }
  for (const u of actors(c)) {
    const cands = plan(c, u).sort((a, b) => b.score - a.score)
    for (const cand of cands) {
      if (!actionProblem(s, cand.action)) return { action: cand.action, why: cand.why }
      stats.rejected++
    }
  }
  return { action: { type: 'endPhase' }, why: 'nothing left to do' }
}

/** Aware, active enemies with actions left: Fixers first (Rally comes before anything else), the Bagman last. */
function actors(c: Ctx): Unit[] {
  const aware = new Set(c.v.groups.filter((g) => g.aware).map((g) => g.id))
  const list = c.v.units.filter((u) => u.side === 'syndicate' && u.status === 'active' && u.actions > 0 && (!u.group || aware.has(u.group)))
  const rank = (u: Unit): number => (u.abilities.includes('rally') ? 0 : u.kind === 'bagman' ? 2 : 1)
  return list.sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : 1))
}

// ---------------------------------------------------------------- planning

function plan(c: Ctx, u: Unit): Cand[] {
  const out: Cand[] = []
  if (u.abilities.includes('rally')) out.push(...rallyCands(c, u))
  if (u.kind === 'bagman' && u.fleeing) out.push(...fleeCands(c, u))
  out.push(...generalCands(c, u))
  return out
}

/** Fixer: Rally a surrendered ally in range, or walk to a safe tile from which it can. */
function rallyCands(c: Ctx, u: Unit): Cand[] {
  const range = tn(c.s, 'rally.range')
  const out: Cand[] = []
  const allies = c.v.units.filter((a) => a.side === 'syndicate' && a.status === 'surrendered' && a.id !== u.id)
  for (const a of allies) {
    if (dist(u.x, u.y, a.x, a.y) <= range && hasLOS(c.v, u, a)) {
      out.push({ action: { type: 'ability', unit: u.id, ability: 'rally', target: a.id }, score: 1000, why: `${u.name} rallies ${a.name}` })
    } else if (u.actions >= 2 && !u.noMove) {
      const b = bfs(c.v, u.x, u.y, u.mobility)
      for (let i = 0; i < b.cost.length; i++) {
        if ((b.cost[i] as number) < 1) continue
        const x = i % c.v.map.w, y = (i - x) / c.v.map.w
        if (dist(x, y, a.x, a.y) > range || !hasLOS(c.v, { x, y }, a)) continue
        const info = tileInfo(c, u, x, y)
        if (info.exposure > W.fixerMaxExposure) continue
        out.push({ action: { type: 'move', unit: u.id, to: { x, y } }, score: 900 - info.exposure * 10 - (b.cost[i] as number) * 0.1, why: `${u.name} moves to rally ${a.name}` })
      }
    }
  }
  return out
}

/** The fleeing Bagman (ENM-5): of the moves that end closer to the escape tile, take the one that ends closest. */
function fleeCands(c: Ctx, u: Unit): Cand[] {
  const esc = tilesOfKind(c.v, 'escape')
  if (u.noMove || esc.length === 0) return []
  const f = distField(c.v, esc)
  const w = c.v.map.w
  const here = f[u.y * w + u.x] as number
  const b = bfs(c.v, u.x, u.y, u.mobility)
  const out: Cand[] = []
  for (let i = 0; i < b.cost.length; i++) {
    if ((b.cost[i] as number) < 1) continue
    const d = f[i] as number
    if (d < 0 || d >= here) continue
    const x = i % w, y = (i - x) / w
    out.push({ action: { type: 'move', unit: u.id, to: { x, y } }, score: 500 - d * 5 - tileInfo(c, u, x, y).exposure, why: `${u.name} runs for the van` })
  }
  return out
}

interface Plan { kind: 'shoot' | 'suppress' | 'overwatch' | 'hunker'; value: number; action: Action; target?: Unit; shot?: Shot }

function plansAt(c: Ctx, u: Unit, x: number, y: number, exposure: number, shotScale: number): Plan[] {
  const out: Plan[] = []
  const seenTarget = new Set<string>()
  for (const sh of shotsFrom(c, u, x, y)) {
    const k = `${sh.kind}:${sh.target.id}`
    if (seenTarget.has(k) || out.length >= 4) continue
    seenTarget.add(k)
    out.push(sh.kind === 'attack'
      ? { kind: 'shoot', value: sh.value * shotScale, action: { type: 'attack', unit: u.id, target: sh.target.id }, target: sh.target, shot: sh }
      : { kind: 'suppress', value: sh.value * shotScale, action: { type: 'ability', unit: u.id, ability: 'suppress', target: sh.target.id }, target: sh.target, shot: sh })
  }
  const w = weapon(u.weapon)
  if (w && !w.melee && u.armed && u.abilities.includes('overwatch')) out.push({ kind: 'overwatch', value: W.overwatch, action: { type: 'ability', unit: u.id, ability: 'overwatch' } })
  if (u.abilities.includes('hunker')) out.push({ kind: 'hunker', value: W.hunkerBase + W.hunkerExposure * exposure, action: { type: 'ability', unit: u.id, ability: 'hunker' } })
  return out
}

/** Where the unit wants to go when it has no shot: the troopers it sees, else fresh ghosts, else the search area. */
function objective(c: Ctx, u: Unit, guard: boolean): Int16Array | null {
  if (guard) return null
  let targets: { x: number; y: number }[] = c.troopers.map((t) => ({ x: t.x, y: t.y }))
  if (targets.length === 0) {
    const ghosts = c.v.lastSeen.syndicate
    targets = Object.values(ghosts).filter((g) => c.s.round - g.round <= W.ghostMemory).map((g) => ({ x: g.x, y: g.y }))
  }
  if (targets.length === 0) targets = c.v.map.extraction.map((p) => ({ x: p.x, y: p.y }))
  return targets.length ? distField(c.v, targets) : null
}

function generalCands(c: Ctx, u: Unit): Cand[] {
  const v = c.v
  const w = weapon(u.weapon)
  const rusher = !!w && w.melee
  const lowRes = u.maxResolve > 0 && u.resolve <= W.lowResolve
  const bagman = v.units.find((x) => x.kind === 'bagman' && x.status === 'active')
  const guard = u.kind === 'bagman' ? !u.fleeing : !!bagman && !bagman.fleeing && !!u.group && bagman.group === u.group
  const safety = lowRes ? W.lowResolveSafety : rusher ? W.meleeTile : 1
  const shotScale = lowRes ? W.lowResolveShot : 1
  const field = lowRes ? null : objective(c, u, guard)
  const w0 = v.map.w
  const here = field ? (field[u.y * w0 + u.x] as number) : -1
  const progress = (x: number, y: number): number => {
    if (!field || here < 0) return 0
    const d = field[y * w0 + x] as number
    return d < 0 ? 0 : (here - d) * (rusher ? W.rushProgress : W.progress)
  }
  const out: Cand[] = []
  const n = u.actions
  const jit = (x: number, y: number, tag: number): number => W.jitter * jitter(c.s, idNum(u.id), x, y, tag)
  const name = (t: Unit): string => t.name

  // Standing still: any plan that ends the turn here.
  const cur = tileInfo(c, u, u.x, u.y)
  const curBase = tileScore(u, cur, { safety, moving: false })
  for (const p of plansAt(c, u, u.x, u.y, cur.exposure, shotScale)) {
    const t = p.target
    const why = p.kind === 'shoot' ? `${u.name} shoots ${name(t!)}${p.shot?.flanked ? ' (flanked)' : ''}` :
      p.kind === 'suppress' ? `${u.name} suppresses ${name(t!)}` : p.kind === 'overwatch' ? `${u.name} holds overwatch` : `${u.name} hunkers down`
    out.push({ action: p.action, score: curBase + p.value + jit(u.x, u.y, 1), why })
  }

  // Moving: one Move action, then (with two actions) the best plan from the new tile.
  if (!u.noMove) {
    const leash = guard ? W.guardLeash : u.mobility
    const b = bfs(v, u.x, u.y, Math.min(u.mobility, leash))
    for (let i = 0; i < b.cost.length; i++) {
      const cost = b.cost[i] as number
      if (cost < 1) continue
      const x = i % w0, y = (i - x) / w0
      const info = tileInfo(c, u, x, y)
      let sc = tileScore(u, info, { safety, moving: true }) - W.step * cost + jit(x, y, 2)
      let why = `${u.name} takes cover`
      let shotPlan = false
      if (n >= 2) {
        const plans = plansAt(c, u, x, y, info.exposure, shotScale)
        let best: Plan | null = null
        for (const p of plans) if (!best || p.value > best.value) best = p
        if (best) {
          sc += best.value
          shotPlan = best.kind === 'shoot' || best.kind === 'suppress'
          if (best.kind === 'shoot') why = best.shot?.flanked ? `${u.name} flanks ${name(best.target!)}` : `${u.name} moves up to shoot ${name(best.target!)}`
          else if (best.kind === 'suppress') why = `${u.name} moves up to suppress ${name(best.target!)}`
        }
      }
      if (!shotPlan) {
        const pg = progress(x, y)
        sc += pg
        if (pg > 0.01) why = rusher ? `${u.name} charges` : `${u.name} advances`
      }
      out.push({ action: { type: 'move', unit: u.id, to: { x, y } }, score: sc, why })
    }
  }
  return out
}
