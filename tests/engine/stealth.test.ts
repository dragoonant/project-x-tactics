// Stealth: STL (unaware enemies look in a cone) and ABL-TKD (the quiet takedown). Owner request: "I have no idea how to go quiet".
import { describe, expect, it } from 'vitest'
import { MAPS } from '../../src/data'
import { createGame, legalActions, query, view } from '../../src/engine'
import type { State } from '../../src/engine'
import { U, act, build, endPhase, find, rejected } from './helpers'

const LIT = { light: { darkSightRange: 99 } }
const R20 = ['####################', '#..................#', '#..................#', '#..................#', '#..................#', '#..................#', '####################']
const W = { x: -1, y: 0 }, E = { x: 1, y: 0 }

/** One unaware gunman at (10,3) looking `facing`; a second member at (13,3) looking `f2`; the Recon at (3,3). Everything lit. */
function sentry(facing = E, f2 = E, aware = false): State {
  return build(R20, {
    squad: [{ cls: 'recon', x: 3, y: 3 }, { cls: 'enforcer', x: 3, y: 5 }],
    groups: [{ id: 'g1', aware, units: [{ type: 'gunman', x: 10, y: 3, facing }, { type: 'gunman', x: 13, y: 3, facing: f2 }] }],
    tuning: LIT,
  })
}

describe('STL sight cones', () => {
  it('STL-1 an unaware enemy sees only inside its cone (half-angle 60): not behind, not square to the side, yes in front', () => {
    const s = sentry(E)
    const e1 = U(s, 'e1')
    const at = (x: number, y: number) => ({ ...U(s, 's1'), x, y })
    expect(query.canSee(s, 'e1', 's1')).toBe(false) // the Recon is straight behind
    expect(s.groups[0]!.aware).toBe(false)
    const t = { ...s, units: s.units.map((u) => (u.id === 's1' ? at(14, 3) : u)) }
    expect(query.canSee(t, 'e1', 's1')).toBe(true) // straight ahead
    const side = { ...s, units: s.units.map((u) => (u.id === 's1' ? at(10, 5) : u)) }
    expect(query.canSee(side, 'e1', 's1')).toBe(false) // 90 degrees off its facing
    const diag = { ...s, units: s.units.map((u) => (u.id === 's1' ? at(12, 5) : u)) }
    expect(query.canSee(diag, 'e1', 's1')).toBe(true) // 45 degrees: inside the cone
    expect(e1.facing).toEqual(E)
  })

  it('STL-1 walking up behind an unaware enemy does not wake it; stepping into its cone does', () => {
    let s = sentry(E, W) // e2 at (13,3) looks back west, toward e1 and the approach
    s.units = s.units.filter((u) => u.id !== 'e2')
    s.groups[0]!.members = ['e1']
    const r = act(s, { type: 'move', unit: 's1', to: { x: 9, y: 3 } })
    expect(r.s.groups[0]!.aware).toBe(false)
    expect(find(r.ev, 'groupAware')).toBeUndefined()
    const r2 = act(r.s, { type: 'move', unit: 's1', to: { x: 11, y: 4 } })
    expect(r2.s.groups[0]!.aware).toBe(true)
  })

  it('STL-2 aware enemies see all round; facing comes from the map and defaults to south', () => {
    const s = sentry(E, E, true)
    expect(query.canSee(s, 'e1', 's1')).toBe(true)
    const d = build(R20, { groups: [{ id: 'g', aware: false, units: [{ type: 'thug', x: 5, y: 3 }] }] })
    expect(U(d, 'e1').facing).toEqual({ x: 0, y: 1 })
    const nm = createGame({ mapId: 'bust-01', squad: ['recruit', 'enforcer', 'bulwark', 'recon'], seed: 1 })
    const authored = MAPS['bust-01']!.groups.flatMap((g) => g.units)
    expect(authored.every((u) => !!u.facing)).toBe(true)
    nm.units.filter((u) => u.side === 'syndicate').forEach((u, i) => expect(u.facing).toEqual(authored[i]!.facing))
  })

  it('STL-2 the Night Market start: no group sees the squad, and every authored sentry has a blind side to approach from', () => {
    const s = createGame({ mapId: 'bust-01', squad: ['recruit', 'enforcer', 'bulwark', 'recon'], seed: 1 })
    expect(s.groups.every((g) => !g.aware)).toBe(true)
    for (const e of s.units.filter((u) => u.side === 'syndicate')) {
      const behind = { x: e.x - e.facing.x, y: e.y - e.facing.y }
      const ghost = { ...s.units[0]!, x: behind.x, y: behind.y }
      const t = { ...s, units: s.units.map((u) => (u.id === 's1' ? ghost : u)) }
      expect(query.canSee(t, e.id, 's1')).toBe(false)
    }
  })

  it('STL-3 query.unawareSight lists the cone tiles of every unaware enemy the squad sees, and nothing for unseen or aware ones', () => {
    const s = sentry(E)
    const fog = view(s, 'squad')
    const cones = query.unawareSight(fog)
    expect(cones.map((c) => c.unit).sort()).toEqual(['e1', 'e2'])
    const c1 = cones.find((c) => c.unit === 'e1')!
    expect(c1.tiles.some((p) => p.x === 14 && p.y === 3)).toBe(true)
    expect(c1.tiles.some((p) => p.x === 9 && p.y === 3)).toBe(false)
    expect(query.unawareSight(view(sentry(E, E, true), 'squad'))).toEqual([])
    const dark = build(R20, { squad: [{ cls: 'enforcer', x: 3, y: 3 }], groups: [{ id: 'g', aware: false, units: [{ type: 'gunman', x: 12, y: 3, facing: W }] }] })
    expect(query.unawareSight(view(dark, 'squad'))).toEqual([]) // in the dark, beyond 2 tiles: the squad does not see it
  })
})

describe('ABL-TKD takedown', () => {
  const behind = (): State => {
    const s = sentry(E, E)
    U(s, 's1').x = 9
    return s
  }

  it('ABL-TKD-1 Takedown: every trooper has it; adjacent, unaware, active enemy only; no roll; target surrenders; ends the turn; quiet', () => {
    const s = behind()
    expect(U(s, 's2').abilities).toContain('takedown')
    expect(legalActions(s)).toContainEqual({ type: 'ability', unit: 's1', ability: 'takedown', target: 'e1' })
    const r = act(s, { type: 'ability', unit: 's1', ability: 'takedown', target: 'e1' })
    expect(U(r.s, 'e1')).toMatchObject({ status: 'surrendered', resolve: 0, armed: false })
    expect(U(r.s, 's1').actions).toBe(0)
    expect(find(r.ev, 'takedown')).toMatchObject({ unit: 'e1', by: 's1' })
    expect(find(r.ev, 'roll')).toBeUndefined()
    expect(find(r.ev, 'noise')).toBeUndefined()
    expect(r.s.alarm).toBe(s.alarm)
    expect(query.noiseInfo(s, 's1', 'takedown').loud).toBe(false)
    // not adjacent, not unaware, not active
    const far = sentry(E, E)
    expect(rejected(far, { type: 'ability', unit: 's1', ability: 'takedown', target: 'e1' })).toMatch(/adjacent/)
    const awake = sentry(E, E, true)
    U(awake, 's1').x = 9
    expect(rejected(awake, { type: 'ability', unit: 's1', ability: 'takedown', target: 'e1' })).toMatch(/alert/)
    expect(rejected(r.s, { type: 'ability', unit: 's2', ability: 'takedown', target: 'e1' })).toBeTruthy()
  })

  it('ABL-TKD-2 a takedown does not wake the group by itself (unlike NOI-5), but a member who sees the trooper does', () => {
    const quiet = act(behind(), { type: 'ability', unit: 's1', ability: 'takedown', target: 'e1' })
    expect(quiet.s.groups[0]!.aware).toBe(false)
    expect(find(quiet.ev, 'groupAware')).toBeUndefined()
    // the same with e2 looking back west at e1: after the takedown it sees the Recon (NOI-2a) and the group wakes
    const seen = sentry(E, W)
    U(seen, 's1').x = 9
    const r = act(seen, { type: 'ability', unit: 's1', ability: 'takedown', target: 'e1' })
    expect(U(r.s, 'e1').status).toBe('surrendered')
    expect(find(r.ev, 'groupAware')).toMatchObject({ group: 'g1' })
    // a baton ambush, by contrast, always wakes the group (NOI-5)
    const bat = act(behind(), { type: 'ability', unit: 's1', ability: 'baton', target: 'e1' })
    expect(bat.s.groups[0]!.aware).toBe(true)
  })

  it('ABL-TKD-2 query.stealthOutlook: takedown always drops and stays quiet; an attack on an unaware member wakes its group', () => {
    const s = behind()
    expect(query.stealthOutlook(s, 's1', 'e1', 'takedown')).toEqual({ drops: 'always', wakesGroup: false, unaware: true })
    expect(query.stealthOutlook(s, 's1', 'e1', 'baton')).toMatchObject({ wakesGroup: true, unaware: true })
    expect(query.stealthOutlook(s, 's1', 'e1', 'mark')).toMatchObject({ drops: 'no', wakesGroup: false })
    const aw = sentry(E, E, true)
    expect(query.stealthOutlook(aw, 's1', 'e1')).toMatchObject({ wakesGroup: false, unaware: false })
  })

  it('ABL-TKD-1 the surrendered enemy holds while covered and can be cuffed (Quick Cuffs free) next to it', () => {
    let s = behind()
    U(s, 's2').x = 9; U(s, 's2').y = 4
    s = act(s, { type: 'ability', unit: 's1', ability: 'takedown', target: 'e1' }).s
    const c = act(s, { type: 'ability', unit: 's2', ability: 'cuff', target: 'e1' })
    expect(U(c.s, 'e1').status).toBe('cuffed')
    expect(U(c.s, 's2').actions).toBe(2)
    expect(endPhase(c.s).s.groups[0]!.aware).toBe(false)
  })
})

describe('STL on the Night Market', () => {
  /** Breadth-first over the Recon's moves (two actions a turn, the rest of the squad holds), keeping every group unaware. */
  function sneak(maxTurns: number): { turns: number; target: string } | null {
    // the Recon takes the west end of the start line (8,20), next to the dark west lane
    const start = createGame({ mapId: 'bust-01', squad: ['recon', 'enforcer', 'bulwark', 'recruit'], seed: 3 })
    const quiet = (x: State): boolean => x.groups.every((g) => !g.aware)
    const key = (x: State): string => `${U(x, 's1').x},${U(x, 's1').y}`
    const seen = new Set<string>()
    let frontier = new Map<string, State>([[key(start), start]])
    for (let turn = 1; turn <= maxTurns; turn++) {
      let half = frontier
      const ends = new Map<string, State>(frontier)
      for (let k = 0; k < 2; k++) {
        const out = new Map<string, State>()
        for (const st of half.values()) {
          for (const a of legalActions(st)) {
            if (a.type === 'ability' && a.ability === 'takedown' && a.unit === 's1') return { turns: turn, target: a.target! }
            if (a.type !== 'move' || a.unit !== 's1') continue
            const tk = `${a.to.x},${a.to.y}`
            if (out.has(tk) || seen.has(`${turn}:${k}:${tk}`)) continue
            seen.add(`${turn}:${k}:${tk}`)
            const r = act(st, a)
            if (quiet(r.s)) out.set(tk, r.s)
          }
        }
        for (const [tk, st] of out) {
          ends.set(tk, st)
          if (k === 0) for (const a of legalActions(st)) if (a.type === 'ability' && a.ability === 'takedown' && a.unit === 's1') return { turns: turn, target: a.target! }
        }
        half = out
      }
      frontier = new Map()
      for (const [tk, st] of ends) { const e = endPhase(endPhase(st).s).s; if (quiet(e) && !e.outcome) frontier.set(tk, e) }
    }
    return null
  }

  it('STL-2 Night Market: the Recon can slip round through the dark and take down a patrol member before the first Alarm wave', () => {
    const r = sneak(3)
    expect(r).not.toBeNull()
    expect(r!.turns).toBeLessThanOrEqual(3)
    // and walking straight up the street from the start is seen: the patrol watches the south
    const s = createGame({ mapId: 'bust-01', squad: ['recon', 'enforcer', 'bulwark', 'recruit'], seed: 3 })
    expect(act(s, { type: 'move', unit: 's4', to: { x: 11, y: 18 } }).s.groups.find((g) => g.id === 'patrol')!.aware).toBe(true)
  })
})
