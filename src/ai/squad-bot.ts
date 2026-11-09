// A simple greedy SQUAD policy for the bench and the sim only; the game never uses it (the player is the squad).
// It may read the full state (it is a stand-in for a human who can see the board): it heads for the Bagman, cuffs
// surrendered enemies, stabilizes downed troopers, shoots the best target and uses abilities when they are obviously good.
import type { Action, State, Unit } from '../engine'
import { actionProblem, query } from '../engine'
import { coverAgainst } from '../engine/cover'
import { sees, sideSees } from '../engine/fog'
import { bfs, distField } from '../engine/grid'
import { cheb, dist } from '../engine/util'
import { placed, weapon } from './geo'

type Policy = (s: State) => Action

const onBoard = (u: Unit): boolean => u.status !== 'dead' && u.status !== 'escaped' && u.status !== 'safe'

/** Greedy squad policy: returns the first valid action of the first unit that still has actions. */
export const squadBot: Policy = (s) => {
  const goal = makeGoal(s)
  const units = s.units.filter((u) => u.side === 'squad' && u.status === 'active' && u.actions > 0).sort((a, b) => (a.id < b.id ? -1 : 1))
  for (const u of units) for (const a of candidates(s, u, goal)) if (!actionProblem(s, a)) return a
  return { type: 'endPhase' }
}

/** Distance field to what the squad wants: the Bagman while he is loose, then the extraction zone. */
function makeGoal(s: State): Int16Array | null {
  const bag = s.units.find((u) => u.kind === 'bagman' && (u.status === 'active' || u.status === 'surrendered'))
  const targets = bag ? [{ x: bag.x, y: bag.y }] : s.map.extraction.map((p) => ({ x: p.x, y: p.y }))
  return targets.length ? distField(s, targets) : null
}

function candidates(s: State, u: Unit, goal: Int16Array | null): Action[] {
  const out: Action[] = []
  const w = s.map.w
  const enemies = s.units.filter((e) => e.side === 'syndicate' && onBoard(e))
  const surrendered = enemies.filter((e) => e.status === 'surrendered').sort((a, b) => (a.kind === 'bagman' ? -1 : 0) - (b.kind === 'bagman' ? -1 : 0))
  const active = enemies.filter((e) => e.status === 'active' && sideSees(s, 'squad', e))
  const downed = s.units.filter((a) => a.side === 'squad' && a.status === 'downed')
  const ab = (name: string): boolean => u.abilities.includes(name)

  // 1. Cuff a surrendered enemy next to us; stabilize a downed trooper next to us (or in Field Medic range).
  for (const e of surrendered) if (cheb(u.x, u.y, e.x, e.y) === 1) out.push({ type: 'ability', unit: u.id, ability: 'cuff', target: e.id })
  for (const d of downed) out.push({ type: 'ability', unit: u.id, ability: 'stabilize', target: d.id })

  // 2. Abilities that are obviously good.
  if (ab('mark')) for (const e of [...active].sort((a, b) => b.hp - a.hp)) if (e.marked === 0) out.push({ type: 'ability', unit: u.id, ability: 'mark', target: e.id })
  if (ab('stim')) {
    const hurt = s.units.filter((a) => a.side === 'squad' && a.status === 'active' && a.maxHp - a.hp >= 3).sort((a, b) => a.hp - b.hp)
    for (const a of hurt) out.push({ type: 'ability', unit: u.id, ability: 'stim', target: a.id, option: 'heal' })
  }
  if (ab('relay')) for (const a of s.units) if (a.side === 'squad' && a.status === 'active' && a.id !== u.id && a.actions === 0) out.push({ type: 'ability', unit: u.id, ability: 'relay', target: a.id })
  for (const g of ['frag', 'gas'] as const) {
    if (!ab(g) || (u.uses[g] ?? 0) < 1 || active.length < 2) continue
    let best: { x: number; y: number; n: number } | null = null
    for (const e of active) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = e.x + dx, y = e.y + dy
        if (dist(u.x, u.y, x, y) > 8 || (g === 'frag' && dist(u.x, u.y, x, y) <= 2)) continue
        const inBlast = (p: Unit): boolean => cheb(p.x, p.y, x, y) <= 1
        if (s.units.some((p) => onBoard(p) && p.side !== 'syndicate' && inBlast(p) && (g === 'frag' || p.side === 'civilians'))) continue
        const n = active.filter(inBlast).length
        if (n >= 2 && (!best || n > best.n)) best = { x, y, n }
      }
    }
    if (best) out.push({ type: 'ability', unit: u.id, ability: g, at: { x: best.x, y: best.y } })
  }

  // 3. Shoot the best target.
  const shots = active.map((e) => ({ e, v: shotValue(s, u, e) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v || (a.e.id < b.e.id ? -1 : 1))
  const goodShot = shots.length > 0 && shots[0]!.v >= 1.2
  if (goodShot) for (const x of shots.slice(0, 3)) out.push({ type: 'attack', unit: u.id, target: x.e.id })

  // 4. Run to a surrendered enemy to cuff it (the Bagman first), or to a downed trooper to stabilize it.
  const b = u.noMove ? null : bfs(s, u.x, u.y, u.mobility)
  if (b) {
    const need = [...surrendered, ...downed]
    for (const t of need) {
      let best = -1, bestC = Infinity
      for (let i = 0; i < b.cost.length; i++) {
        const c = b.cost[i] as number
        if (c < 1) continue
        const x = i % w, y = (i - x) / w
        if (cheb(x, y, t.x, t.y) === 1 && c < bestC) { best = i; bestC = c }
      }
      if (best >= 0 && (t.side === 'syndicate' || dist(u.x, u.y, t.x, t.y) <= u.mobility)) out.push({ type: 'move', unit: u.id, to: { x: best % w, y: (best - (best % w)) / w } })
    }
  }

  // 5. No good shot: if there is an enemy in sight and this is the last action, hold overwatch; otherwise advance.
  const engaged = active.length > 0
  const ranged = !!weapon(u.weapon) && !weapon(u.weapon)!.melee
  if (shots.length && !goodShot) for (const x of shots.slice(0, 1)) if (u.actions < 2) out.push({ type: 'attack', unit: u.id, target: x.e.id })
  if (engaged && u.actions < 2 && ranged && ab('overwatch')) out.push({ type: 'ability', unit: u.id, ability: 'overwatch' })
  if (b) {
    const moves: { to: { x: number; y: number }; sc: number }[] = []
    for (let i = 0; i < b.cost.length; i++) {
      if ((b.cost[i] as number) < 1) continue
      const x = i % w, y = (i - x) / w
      moves.push({ to: { x, y }, sc: tileValue(s, u, x, y, active, goal, w) })
    }
    moves.sort((a, c) => c.sc - a.sc)
    for (const m of moves.slice(0, 4)) out.push({ type: 'move', unit: u.id, to: m.to })
  }
  if (shots.length) for (const x of shots.slice(0, 1)) out.push({ type: 'attack', unit: u.id, target: x.e.id })
  if (ranged && ab('overwatch')) out.push({ type: 'ability', unit: u.id, ability: 'overwatch' })
  out.push({ type: 'ability', unit: u.id, ability: 'hunker' })
  return out
}

/** Expected Health damage plus bonuses for a kill, a surrender and a flank; 0 when the shot is illegal. */
function shotValue(s: State, u: Unit, e: Unit): number {
  if (actionProblem(s, { type: 'attack', unit: u.id, target: e.id })) return 0
  const p = query.preview(s, u.id, e.id)
  if (!p) return 0
  const b = p.breakdown
  const avg = (r: [number, number]): number => (r[0] + r[1]) / 2
  const ev = (b.chance / 100) * avg(p.damage.hit) + (b.grazeChance / 100) * avg(p.damage.graze)
  let v = ev
  if (p.kills) v += (b.chance / 100) * 2
  if (p.surrenders) v += (b.chance / 100) * 1.5
  if (p.flanked) v += 0.3
  if (e.kind === 'bagman') v += 0.5
  return v
}

/** Value of ending a move on (x, y): progress to the goal, cover against what it sees, and a shot from there. */
function tileValue(s: State, u: Unit, x: number, y: number, active: Unit[], goal: Int16Array | null, w: number): number {
  const me = placed(u, x, y)
  let sc = goal ? -(goal[y * w + x] as number) : 0
  if ((goal?.[y * w + x] ?? 0) < 0) sc = -99
  let cover = 0, exposed = 0, shot = false
  for (const e of active) {
    if (dist(x, y, e.x, e.y) > 12) continue
    if (sees(s, e, me)) { exposed++; cover += coverAgainst(s, me, e.x, e.y).value / 40 }
    if (!shot && sees(s, me, e)) shot = true
  }
  if (exposed) sc += 2.5 * (cover / exposed) - 0.7 * exposed
  if (shot) sc += 2
  return sc
}
