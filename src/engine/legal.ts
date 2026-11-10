// ARCH-3 legalActions: every action the acting side may take. endPhase is always included.
import type { Action, Pt, State, Unit } from './types'
import { DIRS4, bfs } from './grid'
import { abilityProblem, actorProblem, attackProblem, SUPPORT_OPTIONS } from './abilities'
import { escapeField } from './move'
import { dist, tn } from './util'

function tilesInRange(s: State, u: Unit, r: number): Pt[] {
  const out: Pt[] = []
  for (let y = Math.max(0, u.y - r); y <= Math.min(s.map.h - 1, u.y + r); y++)
    for (let x = Math.max(0, u.x - r); x <= Math.min(s.map.w - 1, u.x + r); x++)
      if (dist(u.x, u.y, x, y) <= r && s.map.tiles[y * s.map.w + x]!.k !== 'wall') out.push({ x, y })
  return out
}

/** Reachable moves for a unit (cost >= 1), already filtered by pin / fleeing restrictions. */
export function moveTargets(s: State, u: Unit): Pt[] {
  if (u.noMove) return []
  const b = bfs(s, u.x, u.y, u.mobility)
  const f = u.fleeing && u.kind === 'bagman' ? escapeField(s) : null
  const out: Pt[] = []
  for (let i = 0; i < b.cost.length; i++) {
    if ((b.cost[i] as number) < 1) continue
    if (f && (f[i] as number) >= (f[u.y * s.map.w + u.x] as number)) continue
    out.push({ x: i % s.map.w, y: (i - (i % s.map.w)) / s.map.w })
  }
  return out
}

export function legalActions(s: State): Action[] {
  if (s.outcome) return []
  const out: Action[] = []
  const side = s.phase
  for (const u of s.units) {
    if (u.side !== side || actorProblem(s, u)) continue
    for (const to of moveTargets(s, u)) out.push({ type: 'move', unit: u.id, to })
    // attacks
    for (const t of s.units) {
      if (t.side === u.side || t.side === 'civilians') continue
      const a: Action = { type: 'attack', unit: u.id, target: t.id }
      if (!attackProblem(s, a as Extract<Action, { type: 'attack' }>)) out.push(a)
    }
    for (let y = 0; y < s.map.h; y++)
      for (let x = 0; x < s.map.w; x++) {
        if (s.map.tiles[y * s.map.w + x]!.o !== 'lamp') continue
        const a: Action = { type: 'attack', unit: u.id, at: { x, y } }
        if (!attackProblem(s, a as Extract<Action, { type: 'attack' }>)) out.push(a)
      }
    // abilities
    for (const ab of u.abilities) {
      const cands: Action[] = []
      switch (ab) {
        case 'overwatch': case 'longWatch': case 'hunker':
          cands.push({ type: 'ability', unit: u.id, ability: ab })
          break
        case 'cuff': case 'takedown': case 'stabilize': case 'suppress': case 'shieldBash': case 'maul': case 'baton': case 'pinningShot': case 'relay': case 'mark': case 'rally':
          for (const t of s.units) if (t.id !== u.id) cands.push({ type: 'ability', unit: u.id, ability: ab, target: t.id })
          break
        case 'stim':
          for (const t of s.units) if (t.side === 'squad') for (const option of ['heal', 'action']) cands.push({ type: 'ability', unit: u.id, ability: ab, target: t.id, option })
          break
        case 'frag': case 'gas':
          if ((u.uses[ab] ?? 0) > 0) for (const at of tilesInRange(s, u, tn(s, 'grenade.range'))) cands.push({ type: 'ability', unit: u.id, ability: ab, at })
          break
        case 'breach':
          for (const d of DIRS4) cands.push({ type: 'ability', unit: u.id, ability: ab, at: { x: u.x + d.x, y: u.y + d.y } })
          break
        case 'callSupport':
          if (s.supportCharges > 0) for (const at of tilesInRange(s, u, tn(s, 'support.range'))) for (const option of SUPPORT_OPTIONS) cands.push({ type: 'ability', unit: u.id, ability: ab, at, option })
          break
      }
      for (const a of cands) if (!abilityProblem(s, a as Extract<Action, { type: 'ability' }>)) out.push(a)
    }
  }
  out.push({ type: 'endPhase' })
  return out
}
