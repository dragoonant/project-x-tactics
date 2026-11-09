import { describe, expect, it } from 'vitest'
import { legalActions, query } from '../../src/engine'
import type { State } from '../../src/engine'
import { ARENA, U, act, addObj, all, build, endPhase, find, place, rejected, setTile } from './helpers'

const LIT = { light: { darkSightRange: 99 } }
const R20 = ['####################', '#..................#', '#..................#', '#..................#', '#..................#', '#..................#', '####################']

/** Recruit s1 at (2,3), Gunman e1 at (7,3) behind half cover at (6,3), everything visible. */
const duel = (forced: number[] = [], extra: Partial<Parameters<typeof build>[1]> = {}): State => {
  const s = build(ARENA, { enemies: [{ type: 'gunman', x: 7, y: 3 }], tuning: LIT, forced, ...extra })
  addObj(s, 6, 3, 'halfCover')
  return s
}

describe('HIT hitting', () => {
  it('HIT-1 chance = aim + range - cover - defence, clamped to 5..95', () => {
    const s = duel()
    U(s, 'e1').defense = 10
    expect(query.hitChance(s, 's1', 'e1')).toMatchObject({ aim: 65, range: 0, defence: 10, raw: 35, chance: 35 })
    expect(query.hitChance(s, 's1', 'e1')!.cover.value).toBe(20)
    const hi = build(ARENA, { squad: [{ cls: 'marksman', x: 1, y: 3 }], enemies: [{ type: 'gunman', x: 10, y: 3 }], aware: false, tuning: LIT })
    U(hi, 'e1').marked = 2
    expect(query.hitChance(hi, 's1', 'e1')).toMatchObject({ range: 0, raw: 110, chance: 95 })
    const lo = duel()
    addObj(lo, 6, 3, 'fullCover')
    U(lo, 's1').suppressedBy = 'e1'
    expect(query.hitChance(lo, 's1', 'e1', 'overwatch')!.chance).toBe(5) // 65 - 40 - 20 - 15 < 5
  })

  it('HIT-2 modifiers: mark +15, ambush +20, overwatch -15, suppressed -20, gas -20 (not for gas-immune units)', () => {
    const mods = (s: State, a = 's1', t = 'e1', ab?: string): Record<string, number> =>
      Object.fromEntries(query.hitChance(s, a, t, ab)!.mods.map((m) => [m.name, m.value]))
    const s = duel()
    expect(mods(s)).toEqual({})
    U(s, 'e1').marked = 2
    expect(mods(s)).toEqual({ mark: 15 })
    expect(mods(s, 's1', 'e1', 'overwatch')).toEqual({ mark: 15, overwatch: -15 })
    U(s, 's1').suppressedBy = 'e1'
    expect(mods(s).suppressed).toBe(-20)
    const amb = build(ARENA, { enemies: [{ type: 'gunman', x: 7, y: 3 }], aware: false, tuning: LIT })
    expect(mods(amb)).toEqual({ ambush: 20 })
    const gas = build(ARENA, { enemies: [{ type: 'gunman', x: 7, y: 3 }, { type: 'heavy', x: 7, y: 5 }], tuning: LIT })
    gas.gas.push({ x: 7, y: 4, r: 1, t: 3 })
    gas.gas.push({ x: 2, y: 3, r: 1, t: 3 })
    expect(mods(gas, 'e1', 's1')).toEqual({ gas: -20 })
    expect(mods(gas, 'e2', 's1')).toEqual({})
    expect(mods(gas, 's1', 'e1')).toEqual({}) // troopers have respirators
  })

  it('HIT-3 roll < chance hits; chance <= roll < chance+15 grazes; otherwise misses', () => {
    const outcome = (roll: number): string => find(act(duel([roll, 4]), { type: 'attack', unit: 's1', target: 'e1' }).ev, 'attack')!.outcome
    expect(query.hitChance(duel(), 's1', 'e1')!.chance).toBe(45)
    expect(outcome(44)).toBe('hit')
    expect(outcome(45)).toBe('graze')
    expect(outcome(59)).toBe('graze')
    expect(outcome(60)).toBe('miss')
    expect(query.hitChance(duel(), 's1', 'e1')).toMatchObject({ grazeChance: 15, missChance: 40 })
  })

  it('HIT-4 grenades and lamp attacks always hit and consume no d100', () => {
    let s = build(ARENA, { squad: [{ cls: 'recruit', x: 2, y: 3 }], enemies: [{ type: 'gunman', x: 6, y: 3 }], lamps: [{ x: 4, y: 1 }], tuning: LIT, forced: [55] })
    s = act(s, { type: 'ability', unit: 's1', ability: 'frag', at: { x: 6, y: 3 } }).s
    expect(s.forcedRolls).toEqual([55])
    expect(U(s, 'e1').hp).toBe(2)
    s.units.find((u) => u.id === 's1')!.actions = 2
    s = act(s, { type: 'attack', unit: 's1', at: { x: 4, y: 1 } }).s
    expect(s.forcedRolls).toEqual([55])
    const c = build(ARENA, { squad: [{ cls: 'chem', x: 2, y: 3 }], enemies: [{ type: 'gunman', x: 6, y: 3 }], tuning: LIT, forced: [55] })
    expect(act(c, { type: 'ability', unit: 's1', ability: 'gas', at: { x: 6, y: 3 } }).s.forcedRolls).toEqual([55])
  })

  it('HIT-5 melee uses base 85 + Mark; cover and range do not apply; grazes apply', () => {
    const s = build(ARENA, { squad: [{ cls: 'bulwark', x: 5, y: 2 }], enemies: [{ type: 'gunman', x: 6, y: 3 }], tuning: LIT, forced: [90] })
    addObj(s, 6, 2, 'fullCover')
    const hc = query.hitChance(s, 's1', 'e1', 'maul')!
    expect(hc).toMatchObject({ melee: true, aim: 85, range: 0, chance: 85 })
    expect(hc.cover).toMatchObject({ level: 'full', value: 0, flanked: false })
    U(s, 'e1').marked = 2
    expect(query.hitChance(s, 's1', 'e1', 'maul')!.chance).toBe(95)
    U(s, 'e1').marked = 0
    const r = act(s, { type: 'ability', unit: 's1', ability: 'maul', target: 'e1' })
    expect(find(r.ev, 'attack')!.outcome).toBe('graze') // 85 <= 90 < 100
    expect(U(r.s, 'e1').hp).toBe(5 - Math.ceil(3 / 2)) // graze halves 3 to 2; the cover is ignored but it is not a flank
  })
})

describe('DMG damage and Resolve', () => {
  it('DMG-1 hits roll weapon damage in [min,max]; grazes deal ceil(damage/2)', () => {
    const hit = act(duel([0, 3]), { type: 'attack', unit: 's1', target: 'e1' }).s
    expect(U(hit, 'e1').hp).toBe(5 - 3)
    const hit4 = act(duel([0, 4]), { type: 'attack', unit: 's1', target: 'e1' }).s
    expect(U(hit4, 'e1').hp).toBe(5 - 4)
    const graze = act(duel([50, 3]), { type: 'attack', unit: 's1', target: 'e1' }).s
    expect(U(graze, 'e1').hp).toBe(5 - 2)
  })

  it('DMG-2 a flanked target takes +1 damage and +2 Resolve damage on hits and grazes', () => {
    const open = build(ARENA, { enemies: [{ type: 'heavy', x: 7, y: 3 }], tuning: LIT, forced: [0, 3] })
    const r = act(open, { type: 'attack', unit: 's1', target: 'e1' }).s
    expect(U(r, 'e1').hp).toBe(9 - 4)
    expect(U(r, 'e1').resolve).toBe(8 - (1 + 2)) // 5 hp of 9 is not wounded, so no doubling
  })

  it('DMG-3 Health first, then Resolve: base (+flank) x1.5 up if marked x2 if now wounded (<50% Health)', () => {
    // Heavy 9hp / 8 resolve, cover so no flank, rifle dmg 3, 1 resolve.
    const run = (marked: boolean, dmg = 3): State => {
      const s = build(ARENA, { enemies: [{ type: 'heavy', x: 7, y: 3 }], tuning: LIT, forced: [0, dmg] })
      addObj(s, 6, 3, 'halfCover')
      if (marked) U(s, 'e1').marked = 2
      return act(s, { type: 'attack', unit: 's1', target: 'e1' }).s
    }
    expect(U(run(false), 'e1')).toMatchObject({ hp: 6, resolve: 7 }) // not wounded
    expect(U(run(true), 'e1')).toMatchObject({ hp: 6, resolve: 6 }) // ceil(1 * 1.5) = 2
    // Gunman 5hp: rifle 3 leaves 2hp = wounded.
    const g = duel([0, 3])
    expect(U(act(g, { type: 'attack', unit: 's1', target: 'e1' }).s, 'e1')).toMatchObject({ hp: 2, resolve: 6 - 2 })
    const gm = duel([0, 3])
    U(gm, 'e1').marked = 2
    expect(U(act(gm, { type: 'attack', unit: 's1', target: 'e1' }).s, 'e1')).toMatchObject({ hp: 2, resolve: 6 - 4 }) // ceil(1.5)=2, x2
    // flanked and wounded: (1 + 2) x 2 = 6 -> surrenders at 0
    const f = build(ARENA, { enemies: [{ type: 'gunman', x: 7, y: 3 }], tuning: LIT, forced: [0, 3] })
    const fr = act(f, { type: 'attack', unit: 's1', target: 'e1' }).s
    expect(U(fr, 'e1')).toMatchObject({ hp: 1, resolve: 0, status: 'surrendered' })
  })

  it('DMG-4 grazes and hits both deal full Resolve damage (only Health is halved)', () => {
    const mk = (roll: number): State => {
      const s = build(ARENA, { enemies: [{ type: 'heavy', x: 7, y: 3 }], tuning: LIT, forced: [roll, 3] })
      addObj(s, 6, 3, 'halfCover')
      return act(s, { type: 'attack', unit: 's1', target: 'e1' }).s
    }
    expect(U(mk(0), 'e1')).toMatchObject({ hp: 6, resolve: 7 })
    expect(U(mk(50), 'e1')).toMatchObject({ hp: 7, resolve: 7 })
  })

  it('DMG-5 a miss deals 1 Resolve damage to the target and 1 damage to the cover piece', () => {
    const r = act(duel([99]), { type: 'attack', unit: 's1', target: 'e1' })
    expect(U(r.s, 'e1')).toMatchObject({ hp: 5, resolve: 5 })
    expect(r.s.map.tiles[3 * 12 + 6]!.hp).toBe(1)
    expect(find(r.ev, 'coverChipped')).toBeTruthy()
  })

  it('DMG-6 a missed ranged attack on a target beside a civilian may hit the civilian (d100 < 20)', () => {
    const mk = (forced: number[]): State => build(ARENA, { enemies: [{ type: 'gunman', x: 7, y: 3 }], civilians: [{ x: 8, y: 3 }, { x: 8, y: 4 }], tuning: LIT, forced })
    const hit = act(mk([99, 5, 3]), { type: 'attack', unit: 's1', target: 'e1' })
    expect(U(hit.s, 'c1').status).toBe('dead')
    expect(U(hit.s, 'c2').hp).toBe(2)
    expect(find(hit.ev, 'civilianCasualty')).toBeTruthy()
    const safe = act(mk([99, 20]), { type: 'attack', unit: 's1', target: 'e1' })
    expect(U(safe.s, 'c1').hp).toBe(2)
    expect(find(safe.ev, 'strayRoll')).toMatchObject({ hit: false })
    // a hit never rolls the stray check
    expect(find(act(mk([0, 3]), { type: 'attack', unit: 's1', target: 'e1' }).ev, 'strayRoll')).toBeUndefined()
  })

  it('DMG-7 troopers have no Resolve: Resolve damage against a trooper is ignored', () => {
    let s = build(ARENA, { enemies: [{ type: 'gunman', x: 7, y: 3 }], tuning: LIT, forced: [0, 3] })
    s = endPhase(s).s
    const r = act(s, { type: 'attack', unit: 'e1', target: 's1' })
    expect(U(r.s, 's1').hp).toBeLessThan(6)
    expect(U(r.s, 's1')).toMatchObject({ resolve: 0, maxResolve: 0 })
    expect(find(r.ev, 'damage')).toMatchObject({ resolve: 0 })
  })
})

describe('RES resolve, surrender, ripple', () => {
  it('RES-1 enemies have Health and Resolve; Resolve never goes below 0', () => {
    const s = build(ARENA, { enemies: [{ type: 'heavy', x: 7, y: 3 }], tuning: LIT, forced: [0, 4] })
    expect(U(s, 'e1')).toMatchObject({ maxHp: 9, maxResolve: 8 })
    U(s, 'e1').resolve = 1
    const r = act(s, { type: 'attack', unit: 's1', target: 'e1' }).s
    expect(U(r, 'e1').resolve).toBe(0)
  })

  it('RES-2 Health 0 means dead, even when Resolve also reaches 0 on the same hit', () => {
    const s = duel([0, 3])
    U(s, 'e1').hp = 1
    U(s, 'e1').resolve = 1
    expect(U(act(s, { type: 'attack', unit: 's1', target: 'e1' }).s, 'e1').status).toBe('dead')
  })

  it('RES-3 Resolve 0 with Health left means surrendered: unarmed, keeps its tile, takes no actions', () => {
    let s = duel([0, 3])
    U(s, 'e1').resolve = 1
    s = act(s, { type: 'attack', unit: 's1', target: 'e1' }).s
    const e = U(s, 'e1')
    expect(e).toMatchObject({ status: 'surrendered', armed: false, x: 7, y: 3, actions: 0 })
    s = endPhase(s).s
    expect(legalActions(s).some((a) => 'unit' in a && a.unit === 'e1')).toBe(false)
    expect(rejected(s, { type: 'attack', unit: 'e1', target: 's1' })).toMatch(/surrendered/)
  })

  it('RES-4 ripple: a surrender, cuff or death costs 1 Resolve to other active enemies within 4 with LOS; ripples do not chain', () => {
    const s = build(R20, {
      squad: [{ cls: 'recruit', x: 2, y: 3 }],
      enemies: [{ type: 'gunman', x: 6, y: 3 }, { type: 'gunman', x: 8, y: 3 }, { type: 'gunman', x: 12, y: 3 }, { type: 'gunman', x: 8, y: 5 }, { type: 'gunman', x: 11, y: 4 }],
      tuning: LIT, forced: [0, 3],
    })
    setTile(s, 7, 4, { k: 'wall' })
    setTile(s, 7, 5, { k: 'wall' })
    U(s, 'e1').hp = 1
    U(s, 'e2').resolve = 1 // will surrender from the ripple
    const r = act(s, { type: 'attack', unit: 's1', target: 'e1' })
    expect(U(r.s, 'e1').status).toBe('dead')
    expect(U(r.s, 'e2')).toMatchObject({ resolve: 0, status: 'surrendered' })
    expect(U(r.s, 'e3').resolve).toBe(6) // 6 tiles away
    expect(U(r.s, 'e4').resolve).toBe(6) // no line of sight
    expect(U(r.s, 'e5').resolve).toBe(6) // near e2 but ripples do not chain
    expect(all(r.ev, 'ripple').map((e) => e.unit)).toEqual(['e2'])
  })

  it('RES-5 Suppress deals Resolve damage without the Health multipliers; Resolve damage listed by ability is exact', () => {
    const s = build(ARENA, { enemies: [{ type: 'gunman', x: 7, y: 3 }], tuning: LIT })
    U(s, 'e1').marked = 2
    U(s, 'e1').hp = 2 // wounded
    const r = act(s, { type: 'ability', unit: 's1', ability: 'suppress', target: 'e1' }).s
    expect(U(r, 'e1').resolve).toBe(6 - 2)
  })

  it('RES-6 troopers have no Resolve and never panic; suppression only gives them an aim penalty', () => {
    let s = build(ARENA, { enemies: [{ type: 'heavy', x: 7, y: 3 }], tuning: LIT })
    s = endPhase(s).s
    s = act(s, { type: 'ability', unit: 'e1', ability: 'suppress', target: 's1' }).s
    expect(U(s, 's1')).toMatchObject({ resolve: 0, maxResolve: 0, suppressedBy: 'e1', status: 'active' })
    expect(query.hitChance(s, 's1', 'e1')!.mods).toContainEqual({ name: 'suppressed', value: -20 })
  })
})

describe('ARR arrest and flight', () => {
  const surrendered = (extra: Parameters<typeof build>[1] = {}): State => {
    const s = build(ARENA, { enemies: [{ type: 'gunman', x: 9, y: 3 }], tuning: LIT, ...extra })
    setTile(s, 11, 3, { k: 'exit' })
    const e = U(s, 'e1')
    e.status = 'surrendered'; e.armed = false; e.resolve = 0; e.actions = 0
    return s
  }

  it('ARR-1 / ARR-2 an uncovered surrendered enemy flees toward the nearest exit at the start of the syndicate phase and escapes on reaching it', () => {
    let s = surrendered()
    const r = endPhase(s)
    expect(find(r.ev, 'flee')).toBeTruthy()
    expect(U(r.s, 'e1').status).toBe('escaped')
    expect(find(r.ev, 'escaped')).toMatchObject({ unit: 'e1', via: 'exit' })
    // far from the exit: runs up to its Mobility (6) and stops
    s = surrendered()
    setTile(s, 11, 3, { k: 'wall' })
    setTile(s, 11, 5, { k: 'exit' })
    place(s, 'e1', 1, 1)
    place(s, 's1', 1, 5)
    const far = endPhase(s)
    expect(U(far.s, 'e1').status).toBe('surrendered')
    expect(Math.max(Math.abs(U(far.s, 'e1').x - 1), Math.abs(U(far.s, 'e1').y - 1))).toBe(6)
  })

  it('ARR-1 covered surrender: a trooper within 3 tiles with LOS keeps the enemy where it is', () => {
    const s = surrendered({ squad: [{ cls: 'recruit', x: 7, y: 3 }] })
    const r = endPhase(s)
    expect(U(r.s, 'e1')).toMatchObject({ status: 'surrendered', x: 9, y: 3 })
    expect(find(r.ev, 'holdsSurrender')).toBeTruthy()
  })

  it('ARR-3 Cuff: 1 action by an adjacent trooper; the cuffed enemy is inert, cannot flee and cannot be rallied', () => {
    let s = surrendered({ squad: [{ cls: 'recruit', x: 8, y: 3 }] })
    place(s, 's1', 5, 3)
    expect(rejected(s, { type: 'ability', unit: 's1', ability: 'cuff', target: 'e1' })).toMatch(/adjacent/)
    place(s, 's1', 8, 4)
    const r = act(s, { type: 'ability', unit: 's1', ability: 'cuff', target: 'e1' })
    s = r.s
    expect(U(s, 'e1')).toMatchObject({ status: 'cuffed', x: 9, y: 3 })
    expect(U(s, 's1').actions).toBe(1)
    place(s, 's1', 1, 1)
    s = endPhase(s).s
    expect(U(s, 'e1').status).toBe('cuffed') // does not flee
    const live = build(ARENA, { squad: [{ cls: 'recruit', x: 8, y: 3 }], enemies: [{ type: 'gunman', x: 9, y: 3 }], tuning: LIT })
    expect(rejected(live, { type: 'ability', unit: 's1', ability: 'cuff', target: 'e1' })).toMatch(/not a surrendered/)
  })

  it('ARR-5 at a mission win every cuffed enemy is secured and counted as an arrest', () => {
    const s = build(ARENA, { squad: [{ cls: 'recruit', x: 8, y: 3 }], enemies: [{ type: 'bagman', x: 9, y: 3 }, { type: 'gunman', x: 9, y: 5 }], tuning: LIT })
    const b = U(s, 'e1'); b.status = 'surrendered'; b.armed = false; b.resolve = 0
    const g = U(s, 'e2'); g.status = 'surrendered'; g.armed = false; g.resolve = 0
    place(s, 's1', 8, 4)
    const r = act(s, { type: 'ability', unit: 's1', ability: 'cuff', target: 'e2' })
    expect(r.s.outcome).toBeNull()
    const w = act(r.s, { type: 'ability', unit: 's1', ability: 'cuff', target: 'e1' }).s
    expect(w.outcome).toBe('win')
    expect(query.summary(w).enemies.bagman!.arrests).toBe(1)
    expect(query.summary(w).enemies.gunman!.arrests).toBe(1)
  })
})

describe('DWN downed troopers', () => {
  const downedGame = (): State => {
    let s = build(ARENA, { squad: [{ cls: 'recruit', x: 2, y: 3 }, { cls: 'chem', x: 2, y: 5 }, { cls: 'recon', x: 3, y: 2 }], enemies: [{ type: 'gunman', x: 7, y: 3 }], tuning: LIT, forced: [0, 4] })
    U(s, 's1').hp = 1
    s = endPhase(s).s
    s = act(s, { type: 'attack', unit: 'e1', target: 's1' }).s
    return s
  }

  it('DWN-1 a trooper at 0 Health is downed: no actions, keeps its tile, cannot be targeted, bleed-out counter 2', () => {
    const s = downedGame()
    expect(U(s, 's1')).toMatchObject({ status: 'downed', hp: 0, actions: 0, x: 2, y: 3, bleed: 2 })
    const legal = legalActions(s)
    expect(legal.some((a) => a.type === 'attack' && 'target' in a && a.target === 's1')).toBe(false)
    expect(rejected(s, { type: 'move', unit: 's1', to: { x: 2, y: 2 } })).toMatch(/phase|downed/)
  })

  it('DWN-2 each round an unstabilized downed trooper bleeds out one step and dies at 0', () => {
    let s = downedGame()
    s = endPhase(s).s
    expect(U(s, 's1')).toMatchObject({ status: 'downed', bleed: 1 })
    s = endPhase(s).s
    s = endPhase(s).s
    expect(U(s, 's1').status).toBe('dead')
    expect(query.summary(s)).toMatchObject({ troopersDead: 1, troopersDowned: 1 })
  })

  it('DWN-3 Stabilize: 1 action by an adjacent ally (Chem within 2 with LOS) keeps the downed trooper alive but out of the fight', () => {
    let s = downedGame()
    s = endPhase(s).s // into the next squad phase
    const r = act(s, { type: 'ability', unit: 's2', ability: 'stabilize', target: 's1' })
    s = r.s
    expect(U(s, 's1').status).toBe('stabilized')
    expect(U(s, 's2').actions).toBe(1)
    for (let i = 0; i < 3; i++) s = endPhase(s).s
    expect(U(s, 's1').status).toBe('stabilized') // never dies
    expect(U(s, 's1').actions).toBe(0)
  })
})
