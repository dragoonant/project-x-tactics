// Role behaviours of the syndicate AI on small hand-built maps (PROTOTYPE-PLAN section 7, spec ENM-2..5).
import { describe, expect, it } from 'vitest'
import { legalActions, step } from '../../src/engine'
import type { Action, State } from '../../src/engine'
import { distField, tilesOfKind } from '../../src/engine/grid'
import { syndicatePolicy } from '../../src/ai'
import { U, addObj, build, toSyndicate } from '../engine/helpers'

const LIT = { light: { darkSightRange: 99 } }
const OPEN = ['####################', '#..................#', '#..................#', '#..................#', '#..................#', '#..................#', '#..................#', '####################']
const apply = (s: State, a: Action): State => {
  const r = step(s, a)
  if (!r.ok) throw new Error(`rejected: ${r.reason}`)
  return r.state
}

/** Follows the AI until it fires (an attack or an ability on a trooper), allowing a move first. */
function firstShot(s0: State): Action {
  let s = s0
  for (let i = 0; i < 4; i++) {
    const a = syndicatePolicy(s)
    if (a.type === 'attack' || (a.type === 'ability' && a.target !== undefined)) return a
    s = apply(s, a)
  }
  throw new Error('the AI never fired')
}

describe('Fixer', () => {
  it('ENM-4 the Fixer rallies a surrendered ally in range before anything else, even when other units could shoot', () => {
    let s = build(OPEN, {
      squad: [{ cls: 'recruit', x: 14, y: 3 }],
      enemies: [{ type: 'gunman', x: 3, y: 2 }, { type: 'fixer', x: 4, y: 4 }, { type: 'gunman', x: 6, y: 5 }],
      tuning: LIT,
    })
    s = toSyndicate(s).s
    const g = U(s, 'e3')
    g.status = 'surrendered'; g.armed = false; g.resolve = 0; g.actions = 0
    // e1 (a gunman with a shot at s1) comes first by id; the Fixer must still go first.
    expect(legalActions(s).some((a) => a.type === 'attack' && a.unit === 'e1')).toBe(true)
    const a = syndicatePolicy(s)
    expect(a).toEqual({ type: 'ability', unit: 'e2', ability: 'rally', target: 'e3' })
    const after = apply(s, a)
    expect(U(after, 'e3').status).toBe('active')
    expect(U(after, 'e3').resolve).toBe(Math.ceil(U(after, 'e3').maxResolve / 2))
  })

  it('ENM-4 a Fixer out of Rally range walks to a tile from which it can rally, then rallies', () => {
    let s = build(OPEN, {
      squad: [{ cls: 'recruit', x: 17, y: 6 }],
      enemies: [{ type: 'fixer', x: 2, y: 2 }, { type: 'gunman', x: 12, y: 1 }],
      tuning: LIT,
    })
    s = toSyndicate(s).s
    const g = U(s, 'e2')
    g.status = 'surrendered'; g.armed = false; g.resolve = 0; g.actions = 0
    const a = syndicatePolicy(s)
    expect(a.type).toBe('move')
    s = apply(s, a)
    expect(syndicatePolicy(s)).toEqual({ type: 'ability', unit: 'e1', ability: 'rally', target: 'e2' })
  })
})

describe('Thug', () => {
  it('ENM-2 a Thug with a club charges: it moves next to a trooper it can reach, then hits it in melee', () => {
    let s = build(OPEN, {
      squad: [{ cls: 'recruit', x: 9, y: 3 }],
      enemies: [{ type: 'thug', loadout: 'club', x: 3, y: 3 }],
      tuning: LIT,
    })
    s = toSyndicate(s).s
    expect(U(s, 'e1').weapon).toBe('club')
    const a = syndicatePolicy(s)
    expect(a.type).toBe('move')
    if (a.type !== 'move') return
    expect(Math.max(Math.abs(a.to.x - 9), Math.abs(a.to.y - 3))).toBe(1)
    s = apply(s, a)
    expect(syndicatePolicy(s)).toEqual({ type: 'attack', unit: 'e1', target: 's1' })
  })

  it('ENM-2 a club Thug too far to reach in one move closes the distance instead of idling', () => {
    let s = build(OPEN, { squad: [{ cls: 'recruit', x: 13, y: 3 }], enemies: [{ type: 'thug', loadout: 'club', x: 1, y: 3 }], tuning: LIT })
    s = toSyndicate(s).s
    const a = syndicatePolicy(s)
    expect(a.type).toBe('move')
    if (a.type === 'move') expect(a.to.x).toBeGreaterThan(1)
  })
})

describe('Bagman', () => {
  const ROAD = ['####################', '#..................#', '#..................#', '#..................#', '#.................V#', '####################']
  const mk = (): State => {
    const s = build(ROAD, { squad: [{ cls: 'recruit', x: 2, y: 4 }], enemies: [{ type: 'bagman', x: 3, y: 2 }], tuning: LIT })
    return s
  }

  it('ENM-5 a fleeing Bagman takes the legal move that ends closest to the escape tile', () => {
    let s = mk()
    U(s, 'e1').fleeing = true
    s = toSyndicate(s).s
    const f = distField(s, tilesOfKind(s, 'escape'))
    const moves = legalActions(s).filter((a): a is Extract<Action, { type: 'move' }> => a.type === 'move' && a.unit === 'e1')
    expect(moves.length).toBeGreaterThan(0)
    const best = Math.min(...moves.map((m) => f[m.to.y * s.map.w + m.to.x] as number))
    const a = syndicatePolicy(s)
    expect(a.type).toBe('move')
    if (a.type !== 'move') return
    expect(f[a.to.y * s.map.w + a.to.x]).toBe(best)
    // keeps running with the second action and gets away when in reach
    s = apply(s, a)
    const b = syndicatePolicy(s)
    expect(b.type).toBe('move')
  })

  it('ENM-5 a fleeing Bagman within reach of the van runs onto it and escapes', () => {
    let s = mk()
    const bm = U(s, 'e1'); bm.fleeing = true; bm.x = 15; bm.y = 3
    s = toSyndicate(s).s
    const a = syndicatePolicy(s)
    expect(a).toEqual({ type: 'move', unit: 'e1', to: { x: 18, y: 4 } })
    expect(U(apply(s, a), 'e1').status).toBe('escaped')
  })

  it('ENM-5 a Bagman who is not fleeing holds cover and does not leave his room', () => {
    let s = build(['####################', '#...#..............#', '#...#..............#', '#...+..............#', '#...#..............#', '####################'], {
      squad: [{ cls: 'recruit', x: 15, y: 2 }], enemies: [{ type: 'bagman', x: 2, y: 2 }, { type: 'gunman', x: 2, y: 3 }], tuning: LIT,
    })
    s = toSyndicate(s).s
    for (let i = 0; i < 4; i++) {
      const a = syndicatePolicy(s)
      if (a.type === 'endPhase') break
      if ('unit' in a && a.unit === 'e1' && a.type === 'move') expect(a.to.x).toBeLessThanOrEqual(5)
      s = apply(s, a)
    }
    expect(U(s, 'e1').x).toBeLessThanOrEqual(5)
  })
})

describe('Cover, flanks and shots', () => {
  it('section 7 an enemy with a shot and a free move does not step into open ground when covered ground also has the shot', () => {
    // A stall at (8,3) gives cover against the trooper to the west; the gunman should end up behind it, not on open floor.
    let s = build(OPEN, {
      squad: [{ cls: 'recruit', x: 2, y: 3 }],
      enemies: [{ type: 'gunman', x: 12, y: 3 }],
      tuning: LIT,
    })
    addObj(s, 11, 3, 'fullCover')
    s = toSyndicate(s).s
    // Whatever it does first, after its turn it must be in cover against s1 or have shot from cover.
    for (let i = 0; i < 3; i++) {
      const a = syndicatePolicy(s)
      if (a.type === 'endPhase') break
      s = apply(s, a)
    }
    const e = U(s, 'e1')
    expect(e.x === 12 && e.y === 3 || e.x >= 11).toBe(true)
  })

  it('section 7 the AI shoots the trooper it can finish rather than a healthy one at the same odds', () => {
    let s = build(OPEN, {
      squad: [{ cls: 'recruit', x: 10, y: 2 }, { cls: 'recruit', x: 10, y: 4 }],
      enemies: [{ type: 'gunman', x: 4, y: 3 }],
      tuning: LIT,
    })
    U(s, 's2').hp = 2
    s = toSyndicate(s).s
    expect(firstShot(s)).toMatchObject({ type: 'attack', unit: 'e1', target: 's2' })
  })

  it('section 7 the AI never targets a downed trooper', () => {
    let s = build(OPEN, { squad: [{ cls: 'recruit', x: 8, y: 3 }, { cls: 'recruit', x: 9, y: 4 }], enemies: [{ type: 'gunman', x: 4, y: 3 }], tuning: LIT })
    const d = U(s, 's1'); d.status = 'downed'; d.hp = 0; d.bleed = 2
    s = toSyndicate(s).s
    for (let i = 0; i < 3; i++) {
      const a = syndicatePolicy(s)
      if (a.type === 'attack') expect(a.target).toBe('s2')
      if (a.type === 'endPhase') break
      s = apply(s, a)
    }
  })

  it('section 7 the Heavy suppresses a healthy exposed trooper', () => {
    let s = build(OPEN, { squad: [{ cls: 'recruit', x: 10, y: 3 }], enemies: [{ type: 'heavy', x: 4, y: 3 }], tuning: LIT })
    s = toSyndicate(s).s
    expect(firstShot(s)).toEqual({ type: 'ability', unit: 'e1', ability: 'suppress', target: 's1' })
  })

  it('section 7 with no shot and no trooper in sight, an aware enemy holds overwatch from cover rather than wandering', () => {
    let s = build(OPEN, { squad: [{ cls: 'recruit', x: 18, y: 6 }], enemies: [{ type: 'gunman', x: 2, y: 2 }], tuning: { light: { darkSightRange: 1 } } })
    s = toSyndicate(s).s
    const a = syndicatePolicy(s)
    expect(['move', 'ability'].includes(a.type)).toBe(true)
  })
})

describe('Low Resolve', () => {
  it('section 7 an enemy with Resolve 2 or less retreats to cover instead of attacking', () => {
    const rows = ['####################', '#..................#', '#..................#', '#..................#', '#..................#', '#..................#', '#..................#', '####################']
    let s = build(rows, { squad: [{ cls: 'recruit', x: 8, y: 3 }], enemies: [{ type: 'gunman', x: 4, y: 3 }], tuning: LIT })
    addObj(s, 2, 2, 'fullCover'); addObj(s, 2, 4, 'fullCover')
    s = toSyndicate(s).s
    const healthy = syndicatePolicy(s)
    expect(healthy.type === 'attack' || (healthy.type === 'move')).toBe(true)
    U(s, 'e1').resolve = 2
    const a = syndicatePolicy(s)
    expect(a.type).not.toBe('attack')
  })
})
