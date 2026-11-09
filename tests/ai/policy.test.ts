// The syndicate AI as a policy: legal, deterministic, pure, fast, and fair (it only knows what the syndicate sees).
import { describe, expect, it } from 'vitest'
import { createGame, legalActions, step, view } from '../../src/engine'
import type { Action, State } from '../../src/engine'
import { syndicatePolicy } from '../../src/ai'
import { squadBot } from '../../src/ai/squad-bot'
import { decideSyndicate, stats } from '../../src/ai/syndicate'
import { CLASSES } from '../../src/data'
import { U, build, toSyndicate } from '../engine/helpers'

const classIds = Object.keys(CLASSES)
const squadFor = (seed: number): string[] => [0, 1, 2, 3].map((i) => classIds[(seed * 3 + i * 5 + (seed >> 2)) % classIds.length] as string)
const key = (a: Action): string => JSON.stringify(a)

/** Plays a bust-01 game with the greedy squad bot against the AI; calls `onSyndicate` before every AI action. */
function playGame(seed: number, onSyndicate?: (s: State, a: Action, ms: number) => void, maxRounds = 12): State {
  let s = createGame({ mapId: 'bust-01', squad: squadFor(seed), seed })
  while (!s.outcome && s.round <= maxRounds) {
    let a: Action
    if (s.phase === 'syndicate') {
      const t0 = performance.now()
      a = syndicatePolicy(s)
      onSyndicate?.(s, a, performance.now() - t0)
    } else a = squadBot(s)
    const r = step(s, a)
    if (!r.ok) throw new Error(`rejected ${key(a)}: ${r.reason}`)
    s = r.state
  }
  return s
}

describe('AI policy contract', () => {
  it('ENM-6 / ARCH-3 the AI returns one of legalActions(s) in every sampled state, within the 50 ms budget', () => {
    let decisions = 0, maxMs = 0
    const before = stats.fallbacks
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      playGame(seed, (s, a, ms) => {
        decisions++
        maxMs = Math.max(maxMs, ms)
        expect(legalActions(s).map(key)).toContain(key(a))
      })
    }
    expect(decisions).toBeGreaterThan(100)
    expect(maxMs).toBeLessThan(50)
    expect(stats.fallbacks).toBe(before)
  })

  it('ARCH-7 same seed, same game: two full AI-vs-bot games produce the same action log', () => {
    for (const seed of [3, 11, 25]) expect(JSON.stringify(playGame(seed).log)).toBe(JSON.stringify(playGame(seed).log))
  })

  it('pure: deciding does not mutate the state, and a deep copy of the state gets the same decision', () => {
    let checked = 0
    playGame(7, (s, a) => {
      const snap = JSON.stringify(s)
      const again = syndicatePolicy(s)
      expect(JSON.stringify(s)).toBe(snap)
      expect(key(again)).toBe(key(a))
      expect(key(syndicatePolicy(JSON.parse(snap) as State))).toBe(key(a))
      checked++
    })
    expect(checked).toBeGreaterThan(20)
  })
})

describe('AI fairness: hidden troopers', () => {
  // A long dark hall: no lamps, so the syndicate sees a trooper only within 2 tiles (LGT-2).
  const HALL = ['########################', '#......................#', '#......................#', '#......................#', '#......................#', '#......................#', '#......................#', '########################']
  const mk = (tx: number, ty: number): State => {
    const s = build(HALL, {
      squad: [{ cls: 'recruit', x: tx, y: ty }, { cls: 'marksman', x: 21, y: 6 }],
      enemies: [{ type: 'gunman', x: 2, y: 3 }, { type: 'gunman', x: 3, y: 5 }],
    })
    return toSyndicate(s).s
  }

  it('ENM-6 / FOG-1 a trooper in the dark beyond 2 tiles is neither shot at nor reacted to: its position does not change the decision', () => {
    const base = mk(20, 3)
    expect(view(base, 'syndicate').units.filter((u) => u.side === 'squad')).toHaveLength(0)
    const want = key(syndicatePolicy(base))
    for (const [x, y] of [[20, 1], [15, 6], [12, 2], [9, 4], [21, 3], [18, 5]] as const) {
      const s = mk(x, y)
      expect(view(s, 'syndicate').units.filter((u) => u.side === 'squad')).toHaveLength(0)
      expect(key(syndicatePolicy(s))).toBe(want)
    }
    const a = syndicatePolicy(base)
    expect(a.type === 'attack' || (a.type === 'ability' && a.target !== undefined)).toBe(false)
  })

  it('ENM-6 / FOG-1 the same trooper, once inside 2 tiles of an enemy, is seen and the AI reacts to it', () => {
    const s = mk(4, 3)
    expect(view(s, 'syndicate').units.some((u) => u.id === 's1')).toBe(true)
    const a = syndicatePolicy(s)
    const reacts = (a.type === 'attack' && a.target === 's1') || (a.type === 'ability' && a.target === 's1') || a.type === 'move' || a.type === 'ability'
    expect(reacts).toBe(true)
    // and it differs from what it does when the trooper is hidden
    expect(key(a)).not.toBe(key(syndicatePolicy(mk(20, 3))))
  })

  it('a hidden trooper is never targeted over a whole game', () => {
    playGame(9, (s, a) => {
      if (a.type === 'attack' || a.type === 'ability') {
        const t = (a as { target?: string }).target
        if (t && t.startsWith('s')) expect(view(s, 'syndicate').units.some((u) => u.id === t)).toBe(true)
      }
    })
  })
})

describe('AI explains itself', () => {
  it('decideSyndicate returns the action and a short reason for the log', () => {
    const s = toSyndicate(build(['##########', '#........#', '#........#', '#........#', '##########'], { squad: [{ cls: 'recruit', x: 7, y: 2 }], enemies: [{ type: 'gunman', x: 2, y: 2 }], tuning: { light: { darkSightRange: 99 } } })).s
    const d = decideSyndicate(s)
    expect(d.why).toMatch(/Gunman/)
    expect(U(s, 'e1').side).toBe('syndicate')
  })
})
