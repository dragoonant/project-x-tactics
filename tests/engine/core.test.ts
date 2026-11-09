import { describe, expect, it } from 'vitest'
import { createGame, deserialize, legalActions, query, randomAction, replay, serialize, step, view } from '../../src/engine'
import type { Action, State } from '../../src/engine'
import { ARENA, U, act, all, build, endPhase, find, kinds, place, rejected, setTile } from './helpers'

const LIT = { light: { darkSightRange: 99 } }
const bust = (squad = ['recruit', 'enforcer', 'bulwark', 'marksman'], seed = 5): State => createGame({ mapId: 'bust-01', squad, seed })

describe('ARCH engine contract', () => {
  it('ARCH-1 createGame builds a state from setup: 1-6 squad members, duplicates allowed, tuning overrides', () => {
    expect(createGame({ mapId: 'bust-01', squad: ['recruit'], seed: 1 }).units.filter((u) => u.side === 'squad')).toHaveLength(1)
    const six = createGame({ mapId: 'bust-01', squad: ['recon', 'recon', 'recon', 'recon', 'recon', 'recon'], seed: 1 })
    expect(six.units.filter((u) => u.side === 'squad')).toHaveLength(6)
    expect(() => createGame({ mapId: 'bust-01', squad: [], seed: 1 })).toThrow()
    expect(() => createGame({ mapId: 'bust-01', squad: ['nope'], seed: 1 })).toThrow()
    const t = createGame({ mapId: 'bust-01', squad: ['recruit'], seed: 1, tuning: { cover: { half: 25 } } })
    expect(t.tuning.cover.half).toBe(25)
    expect(t.tuning.cover.full).toBe(40)
  })

  it('ARCH-2 step is pure and rejects bad actions with a reason instead of throwing', () => {
    const s = bust()
    const before = JSON.stringify(s)
    const ok = step(s, { type: 'endPhase' })
    expect(ok.ok).toBe(true)
    expect(JSON.stringify(s)).toBe(before)
    for (const bad of [null, 5, 'move', {}, { type: 'move' }, { type: 'move', unit: 'zz', to: { x: 1, y: 1 } }, { type: 'attack', unit: 's1', target: 'zz' }, { type: 'attack', unit: 's1', target: 'e7' }, { type: 'ability', unit: 's1', ability: 'nope' }]) {
      const r = step(s, bad as unknown as Action)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason.length).toBeGreaterThan(3)
    }
    expect(JSON.stringify(s)).toBe(before)
  })

  it('ARCH-3 legalActions is never empty and always contains endPhase; every legal action is accepted by step', () => {
    const s = bust(['recruit', 'enforcer', 'bulwark', 'marksman', 'vox', 'chem'])
    const legal = legalActions(s)
    expect(legal.length).toBeGreaterThan(10)
    expect(legal.some((a) => a.type === 'endPhase')).toBe(true)
    for (const a of legal) expect(step(s, a).ok).toBe(true)
    const next = endPhase(s).s
    expect(legalActions(next).some((a) => a.type === 'endPhase')).toBe(true)
  })

  it('ARCH-4 query.* supplies hit chance with breakdown, preview, reachable tiles, cover, noise radius and summary', () => {
    const s = build(ARENA, { enemies: [{ type: 'gunman', x: 7, y: 3 }], tuning: LIT })
    const hc = query.hitChance(s, 's1', 'e1')!
    expect(hc.chance).toBeGreaterThan(0)
    expect(hc.mods).toBeInstanceOf(Array)
    expect(query.preview(s, 's1', 'e1')!.damage.hit).toEqual([4, 5]) // open ground: flanked, +1 damage
    const reach = query.reachable(s, 's1')
    expect(reach.length).toBeGreaterThan(10)
    expect(reach.every((r) => r.cost >= 1 && r.cost <= 6 && r.path.length === r.cost)).toBe(true)
    expect(Object.keys(query.coverPerSide(s, 'e1')!).sort()).toEqual(['E', 'N', 'S', 'W'])
    expect(query.noiseInfo(s, 's1').radius).toBe(10)
    expect(query.summary(s).seed).toBe(1)
  })

  it('ARCH-5 view hides opposing units the side cannot see, keeps terrain and leaves ghost records', () => {
    let s = build(ARENA, { enemies: [{ type: 'gunman', x: 9, y: 3 }], tuning: LIT })
    const full = view(s, 'squad')
    expect(full.units.some((u) => u.id === 'e1')).toBe(true)
    setTile(s, 6, 3, { k: 'wall' })
    s = act(s, { type: 'endPhase' }).s
    s = act(s, { type: 'endPhase' }).s // updateKnowledge runs after each step
    const v = view(s, 'squad')
    expect(v.units.some((u) => u.id === 'e1')).toBe(false)
    expect(v.map.tiles.length).toBe(s.map.tiles.length)
    expect(v.rng).toEqual([0, 0, 0, 0])
    const sv = view(s, 'syndicate')
    expect(sv.units.some((u) => u.id === 's1')).toBe(false)
    expect(Object.keys(view(s, 'squad').lastSeen.squad)).toContain('e1')
  })

  it('ARCH-6 state is plain JSON: a JSON round trip deep-equals the state after real play', () => {
    let s = bust(['recruit', 'recon', 'chem', 'vox'], 11)
    for (let i = 0; i < 80 && !s.outcome; i++) s = act(s, randomAction(s, 0, undefined, 0.1)).s
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
    const walk = (v: unknown): void => {
      expect(v === undefined).toBe(false)
      expect(typeof v === 'function').toBe(false)
      expect(v instanceof Map || v instanceof Set).toBe(false)
      if (v && typeof v === 'object') for (const k of Object.keys(v)) walk((v as Record<string, unknown>)[k])
    }
    walk(s)
  })

  it('ARCH-7 randomness is an sfc32 stream in state.rng: same seed + actions = same game', () => {
    const run = (seed: number): State => {
      let s = bust(['recruit', 'marksman'], seed)
      for (let i = 0; i < 60 && !s.outcome; i++) s = act(s, randomAction(s, 0, undefined, 0.1)).s
      return s
    }
    expect(run(3)).toEqual(run(3))
    const a = bust(['recruit'], 3), b = bust(['recruit'], 4)
    expect(a.rng).not.toEqual(b.rng)
    expect(a.rng).toHaveLength(4)
    const s = build(ARENA, { enemies: [{ type: 'gunman', x: 7, y: 3 }], tuning: LIT, seed: 9 })
    const r = act(s, { type: 'attack', unit: 's1', target: 'e1' }).s
    expect(r.rng).not.toEqual(s.rng)
  })

  it('ARCH-8 every roll emits an event with its full breakdown; alarm and state changes emit events', () => {
    const s = build(ARENA, { enemies: [{ type: 'gunman', x: 7, y: 3 }], tuning: LIT, forced: [10, 3] })
    const { ev } = act(s, { type: 'attack', unit: 's1', target: 'e1' })
    const atk = find(ev, 'attack')!
    expect(atk.breakdown).toMatchObject({ aim: 65, range: 0, chance: 65, defence: 0 })
    expect(atk.roll).toBe(10)
    expect(atk.outcome).toBe('hit')
    expect(kinds(ev)).toContain('noise')
    expect(kinds(ev)).toContain('alarm')
    expect(kinds(ev)).toContain('damage')
  })

  it('ARCH-9 state.log keeps the accepted action list; rejected actions are not logged', () => {
    let s = build(ARENA, { enemies: [{ type: 'gunman', x: 7, y: 3 }], tuning: LIT })
    expect(s.log).toEqual([])
    const a: Action = { type: 'move', unit: 's1', to: { x: 3, y: 3 } }
    s = act(s, a).s
    rejected(s, { type: 'move', unit: 's1', to: { x: 99, y: 3 } })
    expect(s.log).toEqual([a])
    s = act(s, { type: 'endPhase' }).s
    expect(s.log).toHaveLength(2)
  })
})

describe('SAV save envelope', () => {
  it('SAV-1 serialize gives {v, setup, seed, actions, state}; deserialize rejects unknown versions and malformed input without throwing', () => {
    const s = act(bust(), { type: 'endPhase' }).s
    const env = serialize(s)
    expect(Object.keys(env).sort()).toEqual(['actions', 'seed', 'setup', 'state', 'v'])
    expect(env.v).toBe(1)
    expect(deserialize(env).ok).toBe(true)
    expect(deserialize(JSON.stringify(env)).ok).toBe(true)
    for (const bad of [null, 7, 'not json', { v: 2 }, { v: 1 }, { v: 1, setup: {}, seed: 1, actions: [] }, { ...env, state: { units: 3 } }]) {
      const r = deserialize(bad)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason.length).toBeGreaterThan(3)
    }
  })

  it('SAV-2 INV-5 deserialize(serialize(s)) deep-equals s, and replaying setup + actions reproduces s', () => {
    let s = bust(['recruit', 'enforcer', 'chem', 'vox', 'recon'], 21)
    for (let i = 0; i < 150 && !s.outcome; i++) s = act(s, randomAction(s, 0, undefined, 0.08)).s
    const d = deserialize(serialize(s))
    expect(d.ok && d.state).toEqual(s)
    const rep = replay(s.setup, s.log)
    expect(rep.ok && rep.state).toEqual(s)
  })
})

describe('TURN turn structure', () => {
  it('TURN-1 / TURN-2 three sides; a round is squad, syndicate, civilians, end of round; round 1 starts with the squad', () => {
    let s = build(ARENA, { enemies: [{ type: 'gunman', x: 9, y: 3 }], civilians: [{ x: 5, y: 5 }] })
    expect(s.round).toBe(1)
    expect(s.phase).toBe('squad')
    expect(new Set(s.units.map((u) => u.side))).toEqual(new Set(['squad', 'syndicate', 'civilians']))
    let r = endPhase(s)
    expect(r.s.phase).toBe('syndicate')
    expect(r.s.round).toBe(1)
    r = endPhase(r.s)
    expect(kinds(r.ev).indexOf('phaseStart')).toBeGreaterThanOrEqual(0)
    const order = r.ev.filter((e) => ['phaseEnd', 'phaseStart', 'roundEnd'].includes(e.kind)).map((e) => `${e.kind}:${e.side ?? ''}`)
    expect(order).toEqual(['phaseEnd:syndicate', 'phaseStart:civilians', 'roundEnd:', 'phaseStart:squad'])
    expect(r.s.phase).toBe('squad')
    expect(r.s.round).toBe(2)
  })

  it('TURN-3 each able unit gets 2 actions at its phase start; unused actions are lost; downed units get none', () => {
    let s = build(ARENA, { squad: [{ cls: 'recruit', x: 2, y: 3 }, { cls: 'recon', x: 2, y: 4 }], enemies: [{ type: 'gunman', x: 9, y: 3 }] })
    expect(U(s, 's1').actions).toBe(2)
    s = act(s, { type: 'move', unit: 's1', to: { x: 3, y: 3 } }).s
    expect(U(s, 's1').actions).toBe(1)
    U(s, 's2').status = 'downed'
    s = endPhase(s).s
    expect(U(s, 's1').actions).toBe(0)
    expect(U(s, 'e1').actions).toBe(2)
    s = endPhase(s).s
    expect(U(s, 's1').actions).toBe(2)
    expect(U(s, 's2').actions).toBe(0)
  })

  it('TURN-4 units may be activated in any order, switching freely', () => {
    let s = build(ARENA, { squad: [{ cls: 'recruit', x: 2, y: 3 }, { cls: 'recon', x: 2, y: 4 }] })
    s = act(s, { type: 'move', unit: 's2', to: { x: 3, y: 4 } }).s
    s = act(s, { type: 'move', unit: 's1', to: { x: 3, y: 3 } }).s
    s = act(s, { type: 'move', unit: 's2', to: { x: 4, y: 4 } }).s
    expect([U(s, 's1').actions, U(s, 's2').actions]).toEqual([1, 0])
  })

  it('TURN-5 weapon attacks, melee, grenades, Suppress, Overwatch and Hunker end the turn', () => {
    const mk = (cls: string): State => build(ARENA, { squad: [{ cls, x: 2, y: 3 }], enemies: [{ type: 'gunman', x: 3, y: 3 }, { type: 'gunman', x: 7, y: 3 }], tuning: LIT, forced: [99] })
    let s = act(mk('recruit'), { type: 'attack', unit: 's1', target: 'e2' }).s
    expect(U(s, 's1').actions).toBe(0)
    s = act(mk('recruit'), { type: 'ability', unit: 's1', ability: 'overwatch' }).s
    expect(U(s, 's1').actions).toBe(0)
    s = act(mk('recruit'), { type: 'ability', unit: 's1', ability: 'hunker' }).s
    expect(U(s, 's1').actions).toBe(0)
    s = act(mk('recruit'), { type: 'ability', unit: 's1', ability: 'suppress', target: 'e2' }).s
    expect(U(s, 's1').actions).toBe(0)
    s = act(mk('recruit'), { type: 'ability', unit: 's1', ability: 'frag', at: { x: 6, y: 3 } }).s
    expect(U(s, 's1').actions).toBe(0)
    s = act(mk('recon'), { type: 'ability', unit: 's1', ability: 'baton', target: 'e1' }).s
    expect(U(s, 's1').actions).toBe(0)
  })

  it('TURN-6 the syndicate endPhase runs the civilian phase and end of round automatically', () => {
    let s = build(ARENA, { enemies: [{ type: 'gunman', x: 9, y: 3 }], civilians: [{ x: 5, y: 5 }] })
    s = endPhase(s).s
    const r = endPhase(s)
    expect(kinds(r.ev)).toEqual(expect.arrayContaining(['roundEnd', 'alarm']))
    expect(r.s.phase).toBe('squad')
    expect(rejected(r.s, { type: 'ability', unit: 'e1', ability: 'hunker' })).toMatch(/phase/)
  })

  it('TURN-7 end of round: alarm +1, gas -1, timed effects -1, bleed-out -1, round +1', () => {
    let s = build(ARENA, { squad: [{ cls: 'recruit', x: 2, y: 3 }, { cls: 'recon', x: 2, y: 4 }], enemies: [{ type: 'gunman', x: 9, y: 3 }] })
    s.gas.push({ x: 8, y: 1, r: 1, t: 3 })
    U(s, 'e1').marked = 2
    const d = U(s, 's2'); d.status = 'downed'; d.hp = 0; d.bleed = 2
    s = endPhase(s).s
    const r = endPhase(s)
    const order = kinds(r.ev)
    expect(order.indexOf('alarm')).toBeLessThan(order.indexOf('bleed'))
    expect(order.indexOf('bleed')).toBeLessThan(order.indexOf('roundEnd'))
    expect(r.s.alarm).toBe(1)
    expect(r.s.gas[0]!.t).toBe(2)
    expect(U(r.s, 'e1').marked).toBe(1)
    expect(U(r.s, 's2').bleed).toBe(1)
    expect(r.s.round).toBe(2)
  })

  it('TURN-8 unaware enemies take no actions and are excluded from the syndicate legal actions', () => {
    let s = build(ARENA, { groups: [{ id: 'sleepers', aware: false, units: [{ type: 'gunman', x: 9, y: 3 }] }, { id: 'awake', aware: true, units: [{ type: 'gunman', x: 9, y: 5 }] }] })
    s = endPhase(s).s
    const legal = legalActions(s)
    expect(legal.some((a) => 'unit' in a && a.unit === 'e1')).toBe(false)
    expect(legal.some((a) => 'unit' in a && a.unit === 'e2')).toBe(true)
    expect(rejected(s, { type: 'move', unit: 'e1', to: { x: 8, y: 3 } })).toMatch(/unaware/)
  })
})

void place
void all
