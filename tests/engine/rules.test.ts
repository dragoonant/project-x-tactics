import { describe, expect, it } from 'vitest'
import { query } from '../../src/engine'
import type { State } from '../../src/engine'
import { ARENA, U, act, addObj, all, build, endPhase, find, kinds, place, rejected, setTile } from './helpers'

const LIT = { light: { darkSightRange: 99 } }
const R20 = ['####################', '#..................#', '#..................#', '#..................#', '#..................#', '#..................#', '####################']

describe('OW / HNK / SPR reaction rules', () => {
  it('OW-1 Overwatch: 1 action, ends turn, holds one reaction until the unit next phase starts', () => {
    let s = build(ARENA, { enemies: [{ type: 'gunman', x: 9, y: 3 }] })
    s = act(s, { type: 'ability', unit: 's1', ability: 'overwatch' }).s
    expect(U(s, 's1')).toMatchObject({ actions: 0, overwatch: 'overwatch' })
    s = endPhase(s).s
    expect(U(s, 's1').overwatch).toBe('overwatch') // still held in the syndicate phase
    s = endPhase(s).s
    expect(U(s, 's1').overwatch).toBeNull() // cleared at the start of its next phase
  })

  it('OW-2 the reaction fires on the first step that ends on a tile the overwatcher sees, at -15 aim, then is spent', () => {
    let s = build(ARENA, { enemies: [{ type: 'gunman', x: 9, y: 3 }], forced: [99] })
    s = act(s, { type: 'ability', unit: 's1', ability: 'overwatch' }).s
    s = endPhase(s).s
    const r = act(s, { type: 'move', unit: 'e1', to: { x: 3, y: 3 } })
    const fire = r.ev.findIndex((e) => e.kind === 'overwatchFire')
    const steps = r.ev.map((e, i) => (e.kind === 'step' ? i : -1)).filter((i) => i >= 0)
    expect(steps.filter((i) => i < fire)).toHaveLength(5) // (8,3) .. (4,3): first tile within 2 in the dark
    expect(all(r.ev, 'overwatchFire')).toHaveLength(1)
    expect(find(r.ev, 'attack')!.breakdown.mods).toContainEqual({ name: 'overwatch', value: -15 })
    expect(U(r.s, 's1').overwatch).toBeNull()
    expect(U(r.s, 'e1')).toMatchObject({ x: 3, y: 3, status: 'active' })
  })

  it('OW-3 several overwatchers react to the same step in unit-id order', () => {
    let s = build(ARENA, { squad: [{ cls: 'recruit', x: 2, y: 3 }, { cls: 'recruit', x: 2, y: 4 }], enemies: [{ type: 'gunman', x: 6, y: 3 }], tuning: LIT, forced: [0, 4] })
    U(s, 'e1').hp = 1
    s = act(s, { type: 'ability', unit: 's2', ability: 'overwatch' }).s
    s = act(s, { type: 'ability', unit: 's1', ability: 'overwatch' }).s
    s = endPhase(s).s
    const r = act(s, { type: 'move', unit: 'e1', to: { x: 5, y: 3 } })
    expect(all(r.ev, 'overwatchFire').map((e) => e.unit)).toEqual(['s1']) // s1 kills it, s2 keeps its overwatch
    expect(U(r.s, 's2').overwatch).toBe('overwatch')
    expect(U(r.s, 'e1').status).toBe('dead')
  })

  it('HNK-1 Hunker: 1 action, ends turn, doubles cover until next phase; flanked units gain nothing', () => {
    let s = build(ARENA, { squad: [{ cls: 'recruit', x: 5, y: 3 }], enemies: [{ type: 'gunman', x: 9, y: 3 }], tuning: LIT })
    addObj(s, 6, 3, 'halfCover')
    expect(query.hitChance(s, 'e1', 's1')!.cover.value).toBe(20)
    s = act(s, { type: 'ability', unit: 's1', ability: 'hunker' }).s
    expect(U(s, 's1')).toMatchObject({ actions: 0, hunkered: true })
    expect(query.hitChance(s, 'e1', 's1')!.cover.value).toBe(40)
    place(s, 'e1', 1, 3)
    expect(query.hitChance(s, 'e1', 's1')!.cover).toMatchObject({ value: 0, flanked: true })
    place(s, 'e1', 9, 3)
    s = endPhase(s).s
    s = endPhase(s).s
    expect(U(s, 's1').hunkered).toBe(false)
  })

  it('SPR-1 Suppressed: -20 to the target attacks; moving draws one normal-aim reaction shot; ends at the suppressor next phase', () => {
    let s = build(ARENA, { enemies: [{ type: 'gunman', x: 8, y: 3 }], tuning: LIT, forced: [99, 99] })
    s = act(s, { type: 'ability', unit: 's1', ability: 'suppress', target: 'e1' }).s
    expect(U(s, 'e1')).toMatchObject({ suppressedBy: 's1', resolve: 4 })
    expect(query.hitChance(s, 'e1', 's1')!.mods).toContainEqual({ name: 'suppressed', value: -20 })
    s = endPhase(s).s
    expect(U(s, 'e1').resolve).toBe(3) // -1 at the start of its phase while suppressed
    const m1 = act(s, { type: 'move', unit: 'e1', to: { x: 8, y: 4 } })
    expect(all(m1.ev, 'suppressionFire')).toHaveLength(1)
    expect(find(m1.ev, 'attack')!.breakdown.mods.some((m: { name: string }) => m.name === 'overwatch')).toBe(false) // normal aim
    const m2 = act(m1.s, { type: 'move', unit: 'e1', to: { x: 8, y: 5 } })
    expect(all(m2.ev, 'suppressionFire')).toHaveLength(0) // once per suppression
    const next = endPhase(m2.s).s
    expect(U(next, 'e1').suppressedBy).toBeNull()
  })
})

describe('NOI / ALM noise, activation and Alarm', () => {
  const W = { x: -1, y: 0 } // STL-1: these sleepers look west, toward the squad
  const sleepers = (extra: Parameters<typeof build>[1] = {}): State =>
    build(R20, { groups: [{ id: 'g1', aware: false, units: [{ type: 'gunman', x: 9, y: 3, facing: W }, { type: 'gunman', x: 9, y: 4, facing: W }] }], ...extra })

  it('NOI-1 unaware groups hold position: they stay put and unaware while the squad stays quiet and unseen', () => {
    let s = sleepers()
    for (let i = 0; i < 3; i++) { s = endPhase(s).s; s = endPhase(s).s }
    expect(s.groups[0]!.aware).toBe(false)
    expect([U(s, 'e1').x, U(s, 'e1').y]).toEqual([9, 3])
  })

  it('NOI-2a a group becomes aware when a member sees a trooper, checked on every step of a squad move', () => {
    let s = sleepers()
    s = act(s, { type: 'move', unit: 's1', to: { x: 5, y: 3 } }).s
    expect(s.groups[0]!.aware).toBe(false)
    const r = act(s, { type: 'move', unit: 's1', to: { x: 8, y: 3 } })
    expect(find(r.ev, 'groupAware')).toMatchObject({ group: 'g1' })
    expect(r.ev.findIndex((e) => e.kind === 'groupAware')).toBeLessThan(r.ev.findIndex((e) => e.kind === 'step' && e.to.x === 8))
    expect(r.s.groups[0]!.aware).toBe(true)
  })

  it('NOI-2b a loud action within hearing radius 10 wakes a group; a quiet one or a far one does not', () => {
    const mk = (cls: string): State => build(R20, {
      squad: [{ cls, x: 2, y: 3 }],
      groups: [{ id: 'near', aware: false, units: [{ type: 'gunman', x: 11, y: 3 }] }, { id: 'far', aware: false, units: [{ type: 'gunman', x: 14, y: 1 }] }, { id: 'target', aware: true, units: [{ type: 'gunman', x: 5, y: 3 }] }],
      tuning: LIT, forced: [99],
    })
    for (let y = 1; y <= 5; y++) setTile(mk('recruit'), 8, y, {})
    const s = mk('recruit')
    for (let y = 1; y <= 5; y++) setTile(s, 8, y, { k: 'wall' })
    const r = act(s, { type: 'attack', unit: 's1', target: 'e3' })
    expect(r.s.groups.find((g) => g.id === 'near')!.aware).toBe(true)
    expect(r.s.groups.find((g) => g.id === 'far')!.aware).toBe(false)
    const m = mk('marksman')
    for (let y = 1; y <= 5; y++) setTile(m, 8, y, { k: 'wall' })
    expect(act(m, { type: 'attack', unit: 's1', target: 'e3' }).s.groups.find((g) => g.id === 'near')!.aware).toBe(false)
  })

  it('NOI-2c reaching the first Alarm threshold wakes every group (see ALM-4)', () => {
    let s = sleepers()
    s.alarm = 3
    s = endPhase(s).s
    s = endPhase(s).s
    expect(s.alarm).toBe(4)
    expect(s.groups.every((g) => g.aware)).toBe(true)
  })

  it('NOI-3 loud: rifle, shotgun, revolver, pistol, Breach, Suppress, frag, loud lamp shots; quiet: long rifle, Pinning Shot, melee, gas, Cuff, Mark, Stim', () => {
    const loud = (cls: string, ability?: string): boolean => query.noiseInfo(build(ARENA, { squad: [{ cls, x: 2, y: 3 }] }), 's1', ability).loud
    for (const cls of ['recruit', 'enforcer', 'bulwark', 'recon', 'vox', 'chem']) expect(loud(cls)).toBe(true)
    expect(loud('marksman')).toBe(false)
    expect(loud('recruit', 'suppress')).toBe(true)
    expect(loud('recruit', 'frag')).toBe(true)
    expect(loud('enforcer', 'breach')).toBe(true)
    for (const [cls, ab] of [['marksman', 'pinningShot'], ['recon', 'baton'], ['bulwark', 'maul'], ['bulwark', 'shieldBash'], ['chem', 'gas'], ['recon', 'mark'], ['chem', 'stim'], ['recruit', 'cuff']] as const) expect(loud(cls, ab)).toBe(false)
    // and for real: a Marksman shot makes no noise event, a Recruit shot does
    const shot = (cls: string): ReturnType<typeof act> => act(build(ARENA, { squad: [{ cls, x: 2, y: 3 }], enemies: [{ type: 'gunman', x: 7, y: 3 }], tuning: LIT, forced: [99] }), { type: 'attack', unit: 's1', target: 'e1' })
    expect(find(shot('marksman').ev, 'noise')).toBeUndefined()
    expect(find(shot('recruit').ev, 'noise')).toBeTruthy()
  })

  it('NOI-4 noise originates at the acting unit tile; for grenades the impact tile', () => {
    const shot = act(build(ARENA, { enemies: [{ type: 'gunman', x: 7, y: 3 }], tuning: LIT, forced: [99] }), { type: 'attack', unit: 's1', target: 'e1' })
    expect(find(shot.ev, 'noise')).toMatchObject({ at: { x: 2, y: 3 } })
    const nade = act(build(ARENA, { tuning: LIT }), { type: 'ability', unit: 's1', ability: 'frag', at: { x: 6, y: 3 } })
    expect(find(nade.ev, 'noise')).toMatchObject({ at: { x: 6, y: 3 } })
  })

  it('NOI-5 attacking a member wakes its whole group after the attack, which still gets the ambush bonus', () => {
    const s = build(R20, {
      squad: [{ cls: 'recon', x: 5, y: 3 }],
      groups: [{ id: 'g1', aware: false, units: [{ type: 'gunman', x: 6, y: 3 }, { type: 'gunman', x: 17, y: 5 }] }],
      forced: [99],
    })
    const r = act(s, { type: 'ability', unit: 's1', ability: 'baton', target: 'e1' })
    expect(find(r.ev, 'attack')!.breakdown.mods).toContainEqual({ name: 'ambush', value: 20 })
    expect(r.s.groups[0]!.aware).toBe(true)
    expect(find(r.ev, 'noise')).toBeUndefined() // baton is quiet, so only NOI-5 woke the far member
    expect(find(r.ev, 'groupAware')).toMatchObject({ reason: 'attacked' })
  })

  it('ALM-1 Alarm is 0..10 and never decreases', () => {
    let s = build(ARENA, { enemies: [{ type: 'gunman', x: 9, y: 3 }] })
    expect(s.alarm).toBe(0)
    s.alarm = 10
    s = endPhase(s).s
    s = endPhase(s).s
    expect(s.alarm).toBe(10)
    let t = build(ARENA, { enemies: [{ type: 'gunman', x: 9, y: 3 }] })
    let last = 0
    for (let i = 0; i < 12; i++) { t = endPhase(t).s; expect(t.alarm).toBeGreaterThanOrEqual(last); last = t.alarm }
  })

  it('ALM-2 +1 at each end of round', () => {
    let s = build(ARENA, { enemies: [{ type: 'gunman', x: 9, y: 3 }] })
    s = endPhase(s).s
    expect(s.alarm).toBe(0)
    s = endPhase(s).s
    expect(s.alarm).toBe(1)
    s = endPhase(endPhase(s).s).s
    expect(s.alarm).toBe(2)
  })

  it('ALM-3 only squad actions raise Alarm: first loud action each round +1, frag +2, support call +1; enemy fire raises nothing', () => {
    let s = build(ARENA, { squad: [{ cls: 'recruit', x: 2, y: 3 }, { cls: 'recruit', x: 2, y: 4 }, { cls: 'vox', x: 2, y: 5 }], enemies: [{ type: 'gunman', x: 7, y: 3 }], tuning: LIT, forced: [99, 99, 99] })
    s = act(s, { type: 'attack', unit: 's1', target: 'e1' }).s
    expect(s.alarm).toBe(1)
    s = act(s, { type: 'attack', unit: 's2', target: 'e1' }).s
    expect(s.alarm).toBe(1) // not again this round
    s = act(s, { type: 'ability', unit: 's3', ability: 'callSupport', option: 'smoke', at: { x: 8, y: 2 } }).s
    expect(s.alarm).toBe(2)
    s = endPhase(s).s
    s = act(s, { type: 'attack', unit: 'e1', target: 's1' }).s
    expect(s.alarm).toBe(2) // R-2: enemy fire does not raise it
    s = endPhase(s).s // end of round +1
    expect(s.alarm).toBe(3)
    const g = build(ARENA, { tuning: LIT })
    expect(act(g, { type: 'ability', unit: 's1', ability: 'frag', at: { x: 7, y: 3 } }).s.alarm).toBe(1 + 2)
  })

  it('ALM-4 thresholds fire once: 4 wakes every group and brings wave A, 7 sends the Bagman running and brings wave B, 10 brings wave C; new units are aware', () => {
    const waves = { A: [{ type: 'gunman' }, { type: 'gunman' }, { type: 'thug', loadout: 'pistol' }], B: [{ type: 'gunman' }, { type: 'gunman' }], C: [{ type: 'heavy' }, { type: 'gunman' }, { type: 'gunman' }] }
    let s = build(R20, {
      groups: [{ id: 'back', aware: false, units: [{ type: 'bagman', x: 15, y: 1 }] }, { id: 'bar', aware: false, units: [{ type: 'gunman', x: 15, y: 5 }] }],
      spawns: [{ id: 'west', x: 1, y: 1 }, { id: 'east', x: 18, y: 3 }], waves,
    })
    const before = s.units.length
    s.alarm = 3
    let r = endPhase(s); r = endPhase(r.s)
    s = r.s
    expect(s.alarm).toBe(4)
    expect(find(r.ev, 'wave')).toMatchObject({ wave: 'A' })
    expect(s.units.length).toBe(before + 3)
    expect(s.groups.every((g) => g.aware)).toBe(true)
    const wa = s.units.filter((u) => u.group === 'wave-A')
    expect(wa).toHaveLength(3)
    expect(new Set(wa.map((u) => `${u.x},${u.y}`)).size).toBe(3)
    expect(wa.every((u) => Math.max(Math.abs(u.x - 1), Math.abs(u.y - 1)) <= 2)).toBe(true) // nearest free tiles to the west spawn
    expect(U(s, 'e1').fleeing).toBe(false)
    s.alarm = 6
    r = endPhase(s); r = endPhase(r.s)
    s = r.s
    expect(s.alarm).toBe(7)
    expect(find(r.ev, 'bagmanFlees')).toBeTruthy()
    expect(U(s, 'e1').fleeing).toBe(true)
    expect(all(r.ev, 'wave').map((e) => e.wave)).toEqual(['B'])
    s.alarm = 9
    r = endPhase(s); r = endPhase(r.s)
    s = r.s
    expect(s.alarm).toBe(10)
    expect(all(r.ev, 'wave').map((e) => e.wave)).toEqual(['C'])
    const after = s.units.length
    r = endPhase(s); r = endPhase(r.s)
    expect(all(r.ev, 'wave')).toHaveLength(0) // fired once each
    expect(r.s.units.length).toBe(after)
  })
})

describe('GAS gas', () => {
  const gasGame = (extra: Parameters<typeof build>[1] = {}): State =>
    build(ARENA, { squad: [{ cls: 'chem', x: 2, y: 3 }], enemies: [{ type: 'gunman', x: 6, y: 3 }, { type: 'heavy', x: 6, y: 4 }, { type: 'gunman', x: 9, y: 3 }], tuning: LIT, ...extra })

  it('GAS-1 / GAS-2 a gas grenade makes a 3x3 cloud for 3 rounds; non-immune enemies in it take 2 Resolve when thrown and at each syndicate phase start', () => {
    let s = act(gasGame(), { type: 'ability', unit: 's1', ability: 'gas', at: { x: 6, y: 3 } }).s
    expect(s.gas).toEqual([{ x: 6, y: 3, r: 1, t: 3 }])
    expect(U(s, 'e1').resolve).toBe(6 - 2)
    expect(U(s, 'e3').resolve).toBe(6) // outside the cloud
    s = endPhase(s).s
    expect(U(s, 'e1').resolve).toBe(6 - 4)
    expect(U(s, 'e1').hp).toBe(5) // gas never deals Health damage
    expect(U(s, 's1').uses.gas).toBe(1)
  })

  it('GAS-3 troopers and the Heavy are immune (no Resolve loss, no aim penalty)', () => {
    const s = act(gasGame(), { type: 'ability', unit: 's1', ability: 'gas', at: { x: 6, y: 3 } }).s
    expect(U(s, 'e2').resolve).toBe(8)
    const t = gasGame()
    t.gas.push({ x: 2, y: 3, r: 1, t: 3 })
    expect(query.hitChance(t, 's1', 'e1')!.mods.some((m) => m.name === 'gas')).toBe(false)
    t.gas.push({ x: 6, y: 3, r: 1, t: 3 })
    expect(query.hitChance(t, 'e1', 's1')!.mods).toContainEqual({ name: 'gas', value: -20 })
    expect(query.hitChance(t, 'e2', 's1')!.mods.some((m) => m.name === 'gas')).toBe(false)
  })

  it('GAS-4 durations drop by 1 at end of round and the cloud disappears at 0; overlapping clouds do not stack damage on a tile', () => {
    let s = act(gasGame(), { type: 'ability', unit: 's1', ability: 'gas', at: { x: 9, y: 3 } }).s
    for (let round = 1; round <= 3; round++) {
      expect(s.gas.length).toBe(round < 3 ? 1 : 1)
      s = endPhase(s).s
      s = endPhase(s).s
      expect(s.gas.length).toBe(round < 3 ? 1 : 0)
      if (round < 3) expect(s.gas[0]!.t).toBe(3 - round)
    }
    const o = gasGame()
    o.gas.push({ x: 9, y: 3, r: 1, t: 3 }, { x: 9, y: 2, r: 1, t: 3 })
    const r = endPhase(o).s
    expect(U(r, 'e3').resolve).toBe(6 - 2)
  })

  it('GAS-5 civilians within 3 tiles of a new cloud panic', () => {
    const s = act(gasGame({ civilians: [{ x: 6, y: 1 }, { x: 10, y: 5 }] }), { type: 'ability', unit: 's1', ability: 'gas', at: { x: 6, y: 3 } }).s
    expect(U(s, 'c1').panicked).toBe(true)
    expect(U(s, 'c2').panicked).toBe(false)
  })
})

describe('CIV civilians', () => {
  it('CIV-1 civilians have 2 Health, no Resolve, no player actions, and are fogged like any unit', () => {
    let s = build(ARENA, { civilians: [{ x: 3, y: 3 }, { x: 10, y: 5 }] })
    expect(U(s, 'c1')).toMatchObject({ side: 'civilians', hp: 2, maxResolve: 0 })
    expect(rejected(s, { type: 'move', unit: 'c1', to: { x: 4, y: 3 } })).toMatch(/phase/)
    s = endPhase(s).s
    s = endPhase(s).s
    expect(rejected(s, { type: 'move', unit: 'c1', to: { x: 4, y: 3 } })).toMatch(/phase/)
  })

  it('CIV-2 loud actions and explosions within 8 and gas panic civilians; quiet ones do not; panic persists', () => {
    const mk = (cls: string): State => build(ARENA, { squad: [{ cls, x: 1, y: 5 }], enemies: [{ type: 'gunman', x: 7, y: 3 }], civilians: [{ x: 5, y: 5 }, { x: 10, y: 1 }], tuning: LIT, forced: [99] })
    const loud = act(mk('recruit'), { type: 'attack', unit: 's1', target: 'e1' }).s
    expect([U(loud, 'c1').panicked, U(loud, 'c2').panicked]).toEqual([true, false]) // c2 is 9 tiles away
    const quiet = act(mk('marksman'), { type: 'attack', unit: 's1', target: 'e1' }).s
    expect(U(quiet, 'c1').panicked).toBe(false)
    const boom = act(mk('recruit'), { type: 'ability', unit: 's1', ability: 'frag', at: { x: 7, y: 3 } }).s
    expect(U(boom, 'c1').panicked).toBe(true)
    const after = endPhase(endPhase(loud).s).s
    expect(U(after, 'c1').panicked).toBe(true)
  })

  it('CIV-3 calm civilians wander 0-2 steps each round; panicked ones run up to 6 toward the nearest exit and leave safely', () => {
    let s = build(R20, { civilians: [{ x: 8, y: 3 }] })
    const from = { x: 8, y: 3 }
    const seen = new Set<number>()
    for (let i = 0; i < 25; i++) {
      s = endPhase(endPhase(s).s).s
      const u = U(s, 'c1')
      const moved = Math.max(Math.abs(u.x - from.x), Math.abs(u.y - from.y))
      seen.add(moved === 0 ? 0 : 1)
      from.x = u.x; from.y = u.y
      expect(u.status).toBe('active')
    }
    expect(seen.has(1)).toBe(true)
    const p = build(R20, { civilians: [{ x: 8, y: 3 }] })
    setTile(p, 19, 3, { k: 'exit' })
    U(p, 'c1').panicked = true
    const one = endPhase(endPhase(p).s)
    expect(U(one.s, 'c1').x).toBe(14) // 6 steps toward the exit
    expect(all(one.ev, 'civilianFlee')).toHaveLength(1)
    let s2 = one.s
    s2 = endPhase(endPhase(s2).s).s
    expect(U(s2, 'c1').status).toBe('safe')
    expect(query.summary(s2).civiliansSafe).toBe(1)
  })

  it('CIV-4 a civilian reduced to 0 Health is a casualty counted in the summary', () => {
    const s = build(ARENA, { enemies: [{ type: 'gunman', x: 7, y: 3 }], civilians: [{ x: 8, y: 3 }], tuning: LIT, forced: [99, 0, 4] })
    const r = act(s, { type: 'attack', unit: 's1', target: 'e1' }).s
    expect(U(r, 'c1').status).toBe('dead')
    expect(query.summary(r).civilianCasualties).toBe(1)
  })
})

describe('DST destructible cover', () => {
  const duelWith = (obj: 'halfCover' | 'fullCover', forced: number[]): State => {
    const s = build(ARENA, { enemies: [{ type: 'gunman', x: 7, y: 3 }], tuning: LIT, forced })
    addObj(s, 6, 3, obj)
    return s
  }
  const shoot = (s: State): State => { U(s, 's1').actions = 2; return act(s, { type: 'attack', unit: 's1', target: 'e1' }).s }

  it('DST-1 cover objects have HP (half 2, full 4); walls and doors are indestructible', () => {
    const s = build(ARENA)
    addObj(s, 6, 3, 'halfCover')
    addObj(s, 6, 4, 'fullCover')
    expect(s.map.tiles[3 * 12 + 6]!.hp).toBe(2)
    expect(s.map.tiles[4 * 12 + 6]!.hp).toBe(4)
    const bust = build(['#####', '#..+#', '#####'], { squad: [{ cls: 'recruit', x: 1, y: 1 }] })
    expect(bust.map.tiles[0]!.hp).toBeUndefined()
    expect(bust.map.tiles[1 * 5 + 3]!.hp).toBeUndefined()
  })

  it('DST-2 a miss chips the cover piece that applied; walls (and the riot shield) are ignored', () => {
    let s = shoot(duelWith('halfCover', [99]))
    expect(s.map.tiles[3 * 12 + 6]!.hp).toBe(1)
    const w = build(ARENA, { enemies: [{ type: 'gunman', x: 7, y: 3 }], tuning: LIT, forced: [99] })
    setTile(w, 6, 3, { k: 'wall' })
    setTile(w, 6, 2, { k: 'floor' })
    place(w, 's1', 5, 1)
    s = act(w, { type: 'attack', unit: 's1', target: 'e1' }).s
    expect(s.map.tiles[3 * 12 + 6]).toEqual({ k: 'wall' })
  })

  it('DST-3 explosions set every cover object in their area to 0 HP', () => {
    const s = build(ARENA, { tuning: LIT })
    addObj(s, 6, 3, 'halfCover')
    addObj(s, 7, 4, 'fullCover')
    addObj(s, 8, 3, 'halfCover')
    const r = act(s, { type: 'ability', unit: 's1', ability: 'frag', at: { x: 7, y: 3 } }).s
    expect(r.map.tiles[3 * 12 + 6]!.o).toBeUndefined()
    expect(r.map.tiles[4 * 12 + 7]).toMatchObject({ o: 'rubble', hp: 2 })
    expect(r.map.tiles[3 * 12 + 8]!.o).toBeUndefined()
  })

  it('DST-4 at 0 HP full cover becomes rubble (half cover); half cover and rubble are removed', () => {
    let s = duelWith('fullCover', [99, 99, 99, 99, 99, 99])
    for (let i = 0; i < 3; i++) s = shoot(s)
    expect(s.map.tiles[3 * 12 + 6]).toMatchObject({ o: 'fullCover', hp: 1 })
    s = shoot(s)
    expect(s.map.tiles[3 * 12 + 6]).toMatchObject({ o: 'rubble', hp: 2 })
    expect(query.hitChance(s, 's1', 'e1')!.cover).toMatchObject({ level: 'half', value: 20 })
    s = shoot(s)
    s = shoot(s)
    expect(s.map.tiles[3 * 12 + 6]!.o).toBeUndefined()
    expect(kinds(act(s, { type: 'endPhase' }).ev)).not.toContain('coverDestroyed')
  })
})
