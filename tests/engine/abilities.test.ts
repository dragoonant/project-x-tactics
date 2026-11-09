import { describe, expect, it } from 'vitest'
import { checkInvariants, createGame, legalActions, query, randomAction, step, view } from '../../src/engine'
import type { State } from '../../src/engine'
import { ARENA, U, act, addObj, all, build, endPhase, find, place, rejected, setTile } from './helpers'

const LIT = { light: { darkSightRange: 99 } }
const WIDE = ['################', '#..............#', '#..............#', '#..............#', '################']
const R20 = ['####################', '#..................#', '#..................#', '#..................#', '#..................#', '#..................#', '####################']
const surrender = (s: State, id: string): void => { const e = U(s, id); e.status = 'surrendered'; e.armed = false; e.resolve = 0; e.actions = 0 }
const next = (s: State): State => endPhase(endPhase(s).s).s // a full round

describe('Recruit', () => {
  it('ABL-RCT-1 Suppress: 1 action, ends turn, loud, needs a seen target in range; 2 Resolve now', () => {
    let s = build(ARENA, { enemies: [{ type: 'gunman', x: 8, y: 3 }], tuning: LIT })
    const r = act(s, { type: 'ability', unit: 's1', ability: 'suppress', target: 'e1' })
    s = r.s
    expect(U(s, 's1').actions).toBe(0)
    expect(U(s, 'e1').resolve).toBe(4)
    expect(find(r.ev, 'noise')).toBeTruthy()
    expect(s.alarm).toBe(1)
    const dark = build(ARENA, { enemies: [{ type: 'gunman', x: 8, y: 3 }] })
    expect(rejected(dark, { type: 'ability', unit: 's1', ability: 'suppress', target: 'e1' })).toMatch(/not seen/)
  })

  it('ABL-RCT-2 Frag grenade: 1 use, range 8, needs a clear line; radius 1 hits every unit for 3 damage and 2 Resolve; loud; +2 Alarm', () => {
    const mk = (): State => build(ARENA, { squad: [{ cls: 'recruit', x: 2, y: 3 }, { cls: 'recon', x: 5, y: 2 }], enemies: [{ type: 'gunman', x: 6, y: 3 }], civilians: [{ x: 7, y: 4 }], tuning: LIT })
    let s = act(mk(), { type: 'ability', unit: 's1', ability: 'frag', at: { x: 6, y: 3 } }).s
    expect(U(s, 'e1')).toMatchObject({ hp: 2, resolve: 2 })
    expect(U(s, 's2').hp).toBe(7 - 3) // friendly fire
    expect(U(s, 'c1').status).toBe('dead')
    expect(s.alarm).toBe(1 + 2)
    expect(U(s, 's1').uses.frag).toBe(0)
    U(s, 's1').actions = 2
    expect(rejected(s, { type: 'ability', unit: 's1', ability: 'frag', at: { x: 6, y: 3 } })).toMatch(/no frag/)
    const far = build(ARENA, { squad: [{ cls: 'recruit', x: 1, y: 3 }], tuning: LIT })
    expect(rejected(far, { type: 'ability', unit: 's1', ability: 'frag', at: { x: 10, y: 3 } })).toMatch(/range/)
    const walled = mk()
    setTile(walled, 4, 3, { k: 'wall' })
    expect(rejected(walled, { type: 'ability', unit: 's1', ability: 'frag', at: { x: 6, y: 3 } })).toMatch(/clear line/)
    s = mk()
    expect(query.noiseInfo(s, 's1', 'frag').loud).toBe(true)
  })
})

describe('Enforcer', () => {
  const rooms = ['##########', '#..#.....#', '#..+.....#', '#..#.....#', '##########']
  it('ABL-ENF-1 Breach: opens an adjacent closed door, then fires at the nearest enemy now seen with +15 aim; with none it only opens the door; loud', () => {
    const s = build(rooms, { squad: [{ cls: 'enforcer', x: 2, y: 2 }], enemies: [{ type: 'gunman', x: 6, y: 2 }], tuning: LIT, forced: [0, 5] })
    expect(query.canSee(s, 's1', 'e1')).toBe(false)
    const r = act(s, { type: 'ability', unit: 's1', ability: 'breach', at: { x: 3, y: 2 } })
    expect(r.s.map.tiles[2 * 10 + 3]!.open).toBe(true)
    expect(find(r.ev, 'attack')!.breakdown.mods).toContainEqual({ name: 'breach', value: 15 })
    expect(U(r.s, 'e1').status).toBe('dead')
    expect(U(r.s, 's1').actions).toBe(0)
    expect(find(r.ev, 'noise')).toBeTruthy()
    const empty = build(rooms, { squad: [{ cls: 'enforcer', x: 2, y: 2 }], tuning: LIT })
    const e = act(empty, { type: 'ability', unit: 's1', ability: 'breach', at: { x: 3, y: 2 } })
    expect(find(e.ev, 'attack')).toBeUndefined()
    expect(find(e.ev, 'doorOpened')).toBeTruthy()
    expect(find(e.ev, 'noise')).toBeTruthy()
    const diag = build(rooms, { squad: [{ cls: 'enforcer', x: 2, y: 1 }], tuning: LIT })
    expect(rejected(diag, { type: 'ability', unit: 's1', ability: 'breach', at: { x: 3, y: 2 } })).toMatch(/adjacent/)
  })

  it('ABL-ENF-2 Quick Cuffs: the first Cuff each phase costs no action', () => {
    let s = build(ARENA, { squad: [{ cls: 'enforcer', x: 3, y: 3 }], enemies: [{ type: 'gunman', x: 4, y: 3 }, { type: 'gunman', x: 4, y: 4 }], tuning: LIT })
    surrender(s, 'e1'); surrender(s, 'e2')
    s = act(s, { type: 'ability', unit: 's1', ability: 'cuff', target: 'e1' }).s
    expect(U(s, 's1').actions).toBe(2)
    s = act(s, { type: 'ability', unit: 's1', ability: 'cuff', target: 'e2' }).s
    expect(U(s, 's1').actions).toBe(1)
  })
})

describe('Bulwark', () => {
  const shieldGame = (): State => build(ARENA, { squad: [{ cls: 'bulwark', x: 5, y: 3 }, { cls: 'recon', x: 5, y: 4 }, { cls: 'recruit', x: 5, y: 5 }], enemies: [{ type: 'gunman', x: 9, y: 3 }], tuning: LIT, facing: { x: 1, y: 0 } })

  it('ABL-BUL-1 Riot Shield: half cover for the Bulwark and adjacent allies against attackers in front; it follows the facing; flanking cancels it; never damaged', () => {
    let s = shieldGame()
    expect(query.coverFrom(s, 's1', { x: 9, y: 3 })).toMatchObject({ level: 'half', value: 20, source: 'shield', flanked: false })
    expect(query.coverFrom(s, 's2', { x: 9, y: 3 })).toMatchObject({ level: 'half', source: 'shield' })
    expect(query.coverFrom(s, 's3', { x: 9, y: 3 })!.level).toBe('none') // not adjacent
    expect(query.coverFrom(s, 's1', { x: 1, y: 3 })).toMatchObject({ level: 'none', flanked: true })
    s = act(s, { type: 'move', unit: 's1', to: { x: 5, y: 2 } }).s // last step north: the shield faces north
    expect(U(s, 's1').facing).toEqual({ x: 0, y: -1 })
    expect(query.coverFrom(s, 's1', { x: 5, y: 0 })!.level).toBe('half')
    expect(query.coverFrom(s, 's1', { x: 9, y: 2 })!.level).toBe('none')
    // never damaged: an enemy shot that misses chips nothing
    let t = shieldGame()
    t.forcedRolls = [99]
    t = endPhase(t).s
    const r = act(t, { type: 'attack', unit: 'e1', target: 's1' })
    expect(find(r.ev, 'coverChipped')).toBeUndefined()
    expect(find(r.ev, 'attack')!.breakdown.cover).toMatchObject({ level: 'half', source: 'shield' })
  })

  it('ABL-BUL-2 Shield Bash: melee, quiet, 1 damage and 4 Resolve; a hit or graze stuns the target (1 action fewer next phase)', () => {
    let s = build(ARENA, { squad: [{ cls: 'bulwark', x: 5, y: 3 }], enemies: [{ type: 'heavy', x: 6, y: 3 }], tuning: LIT, forced: [0] })
    const r = act(s, { type: 'ability', unit: 's1', ability: 'shieldBash', target: 'e1' })
    s = r.s
    expect(U(s, 'e1')).toMatchObject({ hp: 9 - 2, resolve: 8 - 6, stunned: true }) // flanked: +1 damage, +2 Resolve
    expect(find(r.ev, 'noise')).toBeUndefined()
    s = endPhase(s).s
    expect(U(s, 'e1').actions).toBe(1)
  })

  it('ABL-BUL-3 Maul Strike: melee with the shock maul (3 damage, 3 Resolve), quiet', () => {
    const s = build(ARENA, { squad: [{ cls: 'bulwark', x: 5, y: 3 }], enemies: [{ type: 'heavy', x: 6, y: 3 }], tuning: LIT, forced: [0] })
    const r = act(s, { type: 'ability', unit: 's1', ability: 'maul', target: 'e1' })
    expect(U(r.s, 'e1')).toMatchObject({ hp: 9 - 4, resolve: 8 - 5 })
    expect(find(r.ev, 'noise')).toBeUndefined()
    expect(U(r.s, 's1').actions).toBe(0)
  })
})

describe('Marksman', () => {
  it('ABL-MRK-1 Pinning Shot: quiet, 1 damage and 3 Resolve with the long-rifle profile; a hit pins the target for its next phase', () => {
    let s = build(ARENA, { squad: [{ cls: 'marksman', x: 1, y: 3 }], enemies: [{ type: 'heavy', x: 8, y: 3 }], tuning: LIT, forced: [0] })
    expect(query.hitChance(s, 's1', 'e1', 'pinningShot')).toMatchObject({ aim: 75, range: -10, chance: 65 })
    const r = act(s, { type: 'ability', unit: 's1', ability: 'pinningShot', target: 'e1' })
    s = r.s
    expect(U(s, 'e1')).toMatchObject({ hp: 9 - 2, resolve: 8 - 5, pinned: true })
    expect(find(r.ev, 'noise')).toBeUndefined()
    s = endPhase(s).s
    expect(rejected(s, { type: 'move', unit: 'e1', to: { x: 8, y: 4 } })).toMatch(/pinned/)
    expect(legalActions(s).some((a) => a.type === 'move')).toBe(false)
    s = next(s)
    expect(legalActions(endPhase(s).s).some((a) => a.type === 'move')).toBe(true) // free again the phase after
  })

  it('ABL-MRK-2 Long Watch: overwatch with Squadsight; reacts to a mover seen by a teammate beyond its own sight', () => {
    let s = build(WIDE, { squad: [{ cls: 'marksman', x: 1, y: 2 }, { cls: 'recruit', x: 12, y: 2 }], enemies: [{ type: 'gunman', x: 14, y: 1 }], forced: [99] })
    s = act(s, { type: 'ability', unit: 's1', ability: 'longWatch' }).s
    expect(U(s, 's1')).toMatchObject({ overwatch: 'longWatch', actions: 0 })
    s = endPhase(s).s
    const r = act(s, { type: 'move', unit: 'e1', to: { x: 14, y: 2 } })
    expect(all(r.ev, 'overwatchFire').map((e) => e.unit)).toEqual(['s1'])
  })

  it('ABL-MRK-3 Squadsight: may target any enemy a teammate sees if it has LOS, ignoring sight radius and darkness', () => {
    const mk = (cls: string): State => build(WIDE, { squad: [{ cls, x: 1, y: 2 }, { cls: 'recruit', x: 13, y: 2 }], enemies: [{ type: 'gunman', x: 14, y: 2 }] })
    expect(act(mk('marksman'), { type: 'attack', unit: 's1', target: 'e1' }).s.log).toHaveLength(1)
    expect(rejected(mk('recruit'), { type: 'attack', unit: 's1', target: 'e1' })).toMatch(/not seen/)
  })
})

describe('Vox Operator', () => {
  it('ABL-VOX-1 Relay Orders: 1 action, once per phase, does not end turn; another trooper the Vox sees gains +1 action', () => {
    let s = build(ARENA, { squad: [{ cls: 'vox', x: 2, y: 3 }, { cls: 'recruit', x: 2, y: 4 }] })
    s = act(s, { type: 'ability', unit: 's1', ability: 'relay', target: 's2' }).s
    expect([U(s, 's1').actions, U(s, 's2').actions]).toEqual([1, 3])
    expect(rejected(s, { type: 'ability', unit: 's1', ability: 'relay', target: 's2' })).toMatch(/already used/)
    expect(rejected(build(ARENA, { squad: [{ cls: 'vox', x: 2, y: 3 }] }), { type: 'ability', unit: 's1', ability: 'relay', target: 's1' })).toMatch(/another/)
    s = next(s)
    expect(act(s, { type: 'ability', unit: 's1', ability: 'relay', target: 's2' }).s.log.length).toBeGreaterThan(0)
  })

  it('ABL-VOX-2 Call Support: 1 action, 2 shared charges, range 12 without LOS, +1 Alarm each, does not end turn', () => {
    let s = build(WIDE, { squad: [{ cls: 'vox', x: 1, y: 2 }, { cls: 'vox', x: 1, y: 3 }] })
    expect(rejected(s, { type: 'ability', unit: 's1', ability: 'callSupport', option: 'scan', at: { x: 14, y: 2 } })).toMatch(/range/)
    expect(rejected(s, { type: 'ability', unit: 's1', ability: 'callSupport', option: 'laser', at: { x: 5, y: 2 } })).toMatch(/option/)
    s = act(s, { type: 'ability', unit: 's1', ability: 'callSupport', option: 'scan', at: { x: 13, y: 2 } }).s
    expect([s.alarm, s.supportCharges, U(s, 's1').actions]).toEqual([1, 1, 1])
    s = act(s, { type: 'ability', unit: 's2', ability: 'callSupport', option: 'smoke', at: { x: 5, y: 2 } }).s
    expect([s.alarm, s.supportCharges]).toEqual([2, 0])
    expect(rejected(s, { type: 'ability', unit: 's1', ability: 'callSupport', option: 'scan', at: { x: 5, y: 2 } })).toMatch(/charges/)
  })

  it('SUP-1 Drone Scan: reveals every unit within radius 4 to the squad for 2 rounds', () => {
    let s = build(ARENA, { squad: [{ cls: 'vox', x: 2, y: 3 }], enemies: [{ type: 'gunman', x: 9, y: 3 }] })
    expect(view(s, 'squad').units.some((u) => u.id === 'e1')).toBe(false)
    s = act(s, { type: 'ability', unit: 's1', ability: 'callSupport', option: 'scan', at: { x: 8, y: 3 } }).s
    expect(view(s, 'squad').units.some((u) => u.id === 'e1')).toBe(true)
    s = next(s)
    expect(view(s, 'squad').units.some((u) => u.id === 'e1')).toBe(true)
    s = next(s)
    expect(view(s, 'squad').units.some((u) => u.id === 'e1')).toBe(false)
  })

  it('SUP-2 Smoke: radius 1 (square) tiles block sight for 2 rounds', () => {
    let s = build(ARENA, { squad: [{ cls: 'vox', x: 2, y: 3 }], enemies: [{ type: 'gunman', x: 9, y: 3 }], tuning: LIT })
    expect(query.canSee(s, 's1', 'e1')).toBe(true)
    s = act(s, { type: 'ability', unit: 's1', ability: 'callSupport', option: 'smoke', at: { x: 6, y: 3 } }).s
    expect(query.canSee(s, 's1', 'e1')).toBe(false)
    s = next(s)
    expect(query.canSee(s, 's1', 'e1')).toBe(false)
    s = next(s)
    expect(query.canSee(s, 's1', 'e1')).toBe(true)
  })

  it('SUP-3 Spotlight: tiles within radius 3 are lit for 2 rounds', () => {
    let s = build(ARENA, { squad: [{ cls: 'vox', x: 2, y: 3 }], enemies: [{ type: 'gunman', x: 9, y: 3 }] })
    expect(query.canSee(s, 's1', 'e1')).toBe(false)
    s = act(s, { type: 'ability', unit: 's1', ability: 'callSupport', option: 'spotlight', at: { x: 8, y: 3 } }).s
    expect(query.canSee(s, 's1', 'e1')).toBe(true)
    s = next(next(s))
    expect(query.canSee(s, 's1', 'e1')).toBe(false)
  })
})

describe('Chem Trooper', () => {
  it('ABL-CHM-1 Gas Grenade: 2 uses, quiet, no damage, creates gas; ends turn', () => {
    let s = build(ARENA, { squad: [{ cls: 'chem', x: 2, y: 3 }], enemies: [{ type: 'gunman', x: 7, y: 3 }], tuning: LIT })
    const r = act(s, { type: 'ability', unit: 's1', ability: 'gas', at: { x: 7, y: 3 } })
    s = r.s
    expect(find(r.ev, 'noise')).toBeUndefined()
    expect(U(s, 'e1').hp).toBe(5)
    expect(s.gas).toHaveLength(1)
    expect(U(s, 's1').actions).toBe(0)
    s = next(s)
    s = act(s, { type: 'ability', unit: 's1', ability: 'gas', at: { x: 7, y: 3 } }).s
    s = next(s)
    expect(rejected(s, { type: 'ability', unit: 's1', ability: 'gas', at: { x: 7, y: 3 } })).toMatch(/no gas/)
  })

  it('ABL-CHM-2 Stim: 2 uses, 1 action, does not end turn; heal 3 up to max or +1 action; adjacent ally or self that is not downed', () => {
    let s = build(ARENA, { squad: [{ cls: 'chem', x: 2, y: 3 }, { cls: 'recruit', x: 2, y: 4 }, { cls: 'recon', x: 2, y: 2 }, { cls: 'recruit', x: 8, y: 3 }] })
    U(s, 's2').hp = 4
    U(s, 's3').status = 'downed'
    expect(rejected(s, { type: 'ability', unit: 's1', ability: 'stim', target: 's3', option: 'heal' })).toMatch(/able trooper/)
    expect(rejected(s, { type: 'ability', unit: 's1', ability: 'stim', target: 's4', option: 'heal' })).toMatch(/adjacent/)
    s = act(s, { type: 'ability', unit: 's1', ability: 'stim', target: 's2', option: 'heal' }).s
    expect(U(s, 's2').hp).toBe(6) // 4 + 3 capped at 6
    expect(U(s, 's1').actions).toBe(1)
    s = act(s, { type: 'ability', unit: 's1', ability: 'stim', option: 'action' }).s // self
    expect(U(s, 's1').actions).toBe(1 - 1 + 1)
    expect(U(s, 's1').uses.stim).toBe(0)
    expect(rejected(s, { type: 'ability', unit: 's1', ability: 'stim', target: 's2', option: 'action' })).toMatch(/no stims/)
  })

  it('ABL-CHM-3 Field Medic: may Stabilize at range 2 with LOS; other classes need to be adjacent', () => {
    const mk = (cls: string, x: number): State => {
      const s = build(ARENA, { squad: [{ cls, x, y: 3 }, { cls: 'recruit', x: 2, y: 3 }] })
      Object.assign(U(s, 's2'), { status: 'downed', hp: 0, actions: 0, bleed: 2 })
      return s
    }
    expect(act(mk('chem', 4), { type: 'ability', unit: 's1', ability: 'stabilize', target: 's2' }).s.units[1]!.status).toBe('stabilized')
    expect(rejected(mk('chem', 5), { type: 'ability', unit: 's1', ability: 'stabilize', target: 's2' })).toMatch(/too far/)
    expect(rejected(mk('recruit', 4), { type: 'ability', unit: 's1', ability: 'stabilize', target: 's2' })).toMatch(/too far/)
  })
})

describe('Recon', () => {
  it('ABL-REC-1 Night Vision: ignores darkness, so a dark target 5 tiles away can be shot', () => {
    const mk = (cls: string): State => build(ARENA, { squad: [{ cls, x: 2, y: 3 }], enemies: [{ type: 'gunman', x: 7, y: 3 }] })
    expect(act(mk('recon'), { type: 'attack', unit: 's1', target: 'e1' }).s.log).toHaveLength(1)
    expect(rejected(mk('recruit'), { type: 'attack', unit: 's1', target: 'e1' })).toMatch(/not seen/)
  })

  it('ABL-REC-2 Mark Target: quiet, does not end turn; +15 aim and x1.5 Resolve for squad attacks until the end of the next squad phase', () => {
    let s = build(ARENA, { squad: [{ cls: 'recon', x: 2, y: 3 }, { cls: 'recruit', x: 2, y: 4 }], enemies: [{ type: 'heavy', x: 7, y: 3 }], tuning: LIT, forced: [0, 3] })
    addObj(s, 6, 3, 'halfCover')
    const r = act(s, { type: 'ability', unit: 's1', ability: 'mark', target: 'e1' })
    s = r.s
    expect(U(s, 's1').actions).toBe(1)
    expect(find(r.ev, 'noise')).toBeUndefined()
    expect(query.hitChance(s, 's2', 'e1')!.mods).toContainEqual({ name: 'mark', value: 15 })
    s = act(s, { type: 'attack', unit: 's2', target: 'e1' }).s
    expect(U(s, 'e1').resolve).toBe(8 - 2) // ceil(1 * 1.5)
    s = next(s)
    expect(query.hitChance(s, 's2', 'e1')!.mods).toContainEqual({ name: 'mark', value: 15 }) // still there in the next squad phase
    s = next(s)
    expect(query.hitChance(s, 's2', 'e1')!.mods.some((m) => m.name === 'mark')).toBe(false)
  })

  it('ABL-REC-3 Baton Strike: melee with the baton (2 damage, 3 Resolve), quiet', () => {
    const s = build(ARENA, { squad: [{ cls: 'recon', x: 5, y: 3 }], enemies: [{ type: 'heavy', x: 6, y: 3 }], tuning: LIT, forced: [0] })
    const r = act(s, { type: 'ability', unit: 's1', ability: 'baton', target: 'e1' })
    expect(U(r.s, 'e1')).toMatchObject({ hp: 9 - 3, resolve: 8 - 5 }) // flanked: +1 damage, +2 Resolve
    expect(find(r.ev, 'noise')).toBeUndefined()
  })
})

describe('ENM syndicate units', () => {
  it('ENM-1 stat lines come from enemies.json; all start a phase with 2 actions; attacks end turn', () => {
    const lines: Record<string, [number, number, number, number]> = { thug: [4, 4, 7, 55], gunman: [5, 6, 6, 60], heavy: [9, 8, 5, 55], fixer: [5, 7, 6, 60], bagman: [8, 9, 4, 60] }
    for (const [type, [hp, res, mob, aim]] of Object.entries(lines)) {
      const s = build(ARENA, { enemies: [{ type, x: 8, y: 3 }], tuning: LIT })
      expect(U(s, 'e1')).toMatchObject({ maxHp: hp, maxResolve: res, mobility: mob, aim })
    }
    let s = build(ARENA, { enemies: [{ type: 'gunman', x: 8, y: 3 }], tuning: LIT, forced: [99] })
    s = endPhase(s).s
    expect(U(s, 'e1').actions).toBe(2)
    s = act(s, { type: 'attack', unit: 'e1', target: 's1' }).s
    expect(U(s, 'e1').actions).toBe(0)
  })

  it('ENM-2 Thug: club is melee (adjacent only), pistol is ranged, per the map loadout', () => {
    let s = build(ARENA, { enemies: [{ type: 'thug', x: 5, y: 3, loadout: 'club' }, { type: 'thug', x: 8, y: 3, loadout: 'pistol' }], tuning: LIT, forced: [99, 99] })
    expect(U(s, 'e1').weapon).toBe('club')
    expect(U(s, 'e2').weapon).toBe('pistol')
    s = endPhase(s).s
    expect(rejected(s, { type: 'attack', unit: 'e1', target: 's1' })).toMatch(/adjacent/)
    expect(act(s, { type: 'attack', unit: 'e2', target: 's1' }).s.log.length).toBeGreaterThan(1)
    place(s, 'e1', 3, 3)
    expect(act(s, { type: 'attack', unit: 'e1', target: 's1' }).s.log.length).toBeGreaterThan(1)
  })

  it('ENM-3 Heavy: LMG, Suppress without Resolve damage to troopers, gas-immune', () => {
    const s = build(ARENA, { enemies: [{ type: 'heavy', x: 8, y: 3 }], tuning: LIT })
    expect(U(s, 'e1')).toMatchObject({ weapon: 'lmg', gasImmune: true })
    expect(U(s, 'e1').abilities).toContain('suppress')
    const r = act(endPhase(s).s, { type: 'ability', unit: 'e1', ability: 'suppress', target: 's1' }).s
    expect(U(r, 's1')).toMatchObject({ suppressedBy: 'e1', resolve: 0 })
  })

  it('ENM-4 ARR-4 Fixer Rally: a surrendered, uncuffed ally within 5 with LOS gets Resolve = half its max and is armed again', () => {
    let s = build(ARENA, { enemies: [{ type: 'fixer', x: 1, y: 1 }, { type: 'gunman', x: 5, y: 1 }, { type: 'gunman', x: 3, y: 3 }, { type: 'gunman', x: 10, y: 5 }] })
    surrender(s, 'e2'); surrender(s, 'e3'); surrender(s, 'e4')
    U(s, 'e3').status = 'cuffed'
    s = endPhase(s).s
    expect(rejected(s, { type: 'ability', unit: 'e1', ability: 'rally', target: 'e3' })).toMatch(/not a surrendered/)
    expect(rejected(s, { type: 'ability', unit: 'e1', ability: 'rally', target: 'e4' })).toMatch(/range/)
    const r = act(s, { type: 'ability', unit: 'e1', ability: 'rally', target: 'e2' })
    expect(U(r.s, 'e2')).toMatchObject({ status: 'active', armed: true, resolve: 3 })
    expect(U(r.s, 'e1').actions).toBe(1)
  })

  it('ENM-5 the Bagman flees from Alarm 7: his only legal moves end closer to the escape tile, and ending on it escapes', () => {
    let s = build(R20, { enemies: [{ type: 'bagman', x: 12, y: 3 }] })
    setTile(s, 17, 1, { k: 'escape' })
    s.alarm = 6
    s = endPhase(endPhase(s).s).s
    expect(U(s, 'e1').fleeing).toBe(true)
    s = endPhase(s).s
    const mine = legalActions(s).filter((a) => a.type === 'move')
    expect(mine.length).toBeGreaterThan(0)
    const d = (x: number, y: number): number => Math.max(Math.abs(x - 17), Math.abs(y - 1))
    for (const a of mine) if (a.type === 'move') expect(d(a.to.x, a.to.y)).toBeLessThan(d(12, 3))
    expect(rejected(s, { type: 'move', unit: 'e1', to: { x: 8, y: 3 } })).toMatch(/fleeing/)
    place(s, 'e1', 15, 1)
    const r = act(s, { type: 'move', unit: 'e1', to: { x: 17, y: 1 } })
    expect(U(r.s, 'e1').status).toBe('escaped')
    expect(r.s.outcome).toBe('loss')
  })

  it('ENM-6 syndicate decisions come from a seeded random legal-action policy', () => {
    let s = build(ARENA, { enemies: [{ type: 'gunman', x: 7, y: 3 }, { type: 'thug', x: 8, y: 4, loadout: 'club' }], tuning: LIT })
    s = endPhase(s).s
    expect(randomAction(s)).toEqual(randomAction(s))
    const legal = legalActions(s)
    const seen = new Set<string>()
    for (let i = 0; i < 40; i++) {
      const a = randomAction(s, i)
      expect(legal.some((l) => JSON.stringify(l) === JSON.stringify(a))).toBe(true)
      seen.add(JSON.stringify(a))
    }
    expect(seen.size).toBeGreaterThan(5)
    for (let i = 0; i < 30 && s.phase === 'syndicate'; i++) s = act(s, randomAction(s, 0, undefined, 0.2)).s
  })
})

describe('MSN mission: Bust', () => {
  const finish = (extra: Parameters<typeof build>[1] = {}): State => {
    const s = build(ARENA, { squad: [{ cls: 'recruit', x: 3, y: 3 }], enemies: [{ type: 'bagman', x: 4, y: 3 }, { type: 'gunman', x: 9, y: 5 }], tuning: LIT, extraction: [{ x: 3, y: 3, w: 1, h: 1 }], ...extra })
    return s
  }

  it('MSN-1 bust-01 loads 22x22 with the squad start, three enemy groups, lamps, civilians, spawns and waves', () => {
    const s = createGame({ mapId: 'bust-01', squad: ['recruit', 'enforcer', 'bulwark', 'marksman', 'vox', 'chem'], seed: 1 })
    expect(s.map.w).toBe(22)
    expect(s.map.h).toBe(22)
    expect(s.groups.map((g) => [g.id, g.aware, g.members.length])).toEqual([['patrol', false, 3], ['bar', false, 3], ['backroom', false, 2]])
    expect(s.units.filter((u) => u.side === 'civilians')).toHaveLength(6)
    expect(s.units.filter((u) => u.kind === 'thug').map((u) => u.weapon).sort()).toEqual(['club', 'pistol'])
    expect(s.map.tiles.filter((t) => t.o === 'lamp')).toHaveLength(4)
    expect(s.map.spawns.length).toBe(2)
    expect(Object.keys(s.map.waves)).toEqual(['A', 'B', 'C'])
    expect(U(s, 's3')).toMatchObject({ kind: 'bulwark', facing: { x: 0, y: -1 } })
  })

  it('MSN-2 Win: the Bagman is cuffed and every able trooper stands in the extraction zone, or no active enemy remains', () => {
    const s = finish()
    surrender(s, 'e1')
    const r = act(s, { type: 'ability', unit: 's1', ability: 'cuff', target: 'e1' })
    expect(r.s.outcome).toBe('win') // trooper is in the zone though the gunman is still active
    const out = finish({ extraction: [{ x: 10, y: 1, w: 1, h: 1 }] })
    surrender(out, 'e1')
    expect(act(out, { type: 'ability', unit: 's1', ability: 'cuff', target: 'e1' }).s.outcome).toBeNull()
    const clear = finish({ extraction: [{ x: 10, y: 1, w: 1, h: 1 }] })
    surrender(clear, 'e1'); surrender(clear, 'e2')
    expect(act(clear, { type: 'ability', unit: 's1', ability: 'cuff', target: 'e1' }).s.outcome).toBe('win')
  })

  it('MSN-3 Loss: the Bagman escapes, or no able trooper remains', () => {
    let s = build(ARENA, { enemies: [{ type: 'gunman', x: 8, y: 3 }], tuning: LIT, forced: [0, 6] })
    U(s, 's1').hp = 1
    s = endPhase(s).s
    s = act(s, { type: 'attack', unit: 'e1', target: 's1' }).s
    expect(U(s, 's1').status).toBe('downed')
    expect(s.outcome).toBe('loss')
  })

  it('MSN-4 Partial win (case setback): the Bagman is dead and a win clause second half holds', () => {
    const s = finish({ forced: [0, 4] })
    U(s, 'e1').hp = 1
    const r = act(s, { type: 'attack', unit: 's1', target: 'e1' })
    expect(r.s.outcome).toBe('partial')
    const far = finish({ forced: [0, 4], extraction: [{ x: 10, y: 1, w: 1, h: 1 }] })
    U(far, 'e1').hp = 1
    expect(act(far, { type: 'attack', unit: 's1', target: 'e1' }).s.outcome).toBeNull()
  })

  it('MSN-5 the game ends as soon as an outcome holds; downed troopers survive, cuffed enemies are secured, surrendered but uncuffed ones are lost', () => {
    const s = finish({ squad: [{ cls: 'recruit', x: 3, y: 3 }, { cls: 'recon', x: 2, y: 2 }] })
    surrender(s, 'e1'); surrender(s, 'e2')
    Object.assign(U(s, 's2'), { status: 'downed', hp: 0, bleed: 2 })
    const r = act(s, { type: 'ability', unit: 's1', ability: 'cuff', target: 'e1' })
    expect(r.s.outcome).toBe('win')
    expect(rejected(r.s, { type: 'endPhase' })).toMatch(/over/)
    expect(legalActions(r.s)).toEqual([])
    const sum = query.summary(r.s)
    expect(sum.enemies.bagman!.arrests).toBe(1)
    expect(sum.enemies.gunman).toMatchObject({ arrests: 0, lost: 1 })
    expect(U(r.s, 's2').status).toBe('downed')
    expect(sum.troopersDead).toBe(0)
  })

  it('MSN-6 summary: outcome, rounds, peak Alarm, per-type arrests/kills/escapes, intel (cuffed only), civilian casualties, troopers downed/dead, seed', () => {
    const s = build(ARENA, {
      squad: [{ cls: 'recruit', x: 2, y: 3 }, { cls: 'recon', x: 2, y: 4 }, { cls: 'recon', x: 2, y: 2 }],
      enemies: [{ type: 'thug', x: 8, y: 1 }, { type: 'gunman', x: 8, y: 2 }, { type: 'fixer', x: 8, y: 3 }, { type: 'heavy', x: 8, y: 4 }, { type: 'bagman', x: 8, y: 5 }, { type: 'gunman', x: 9, y: 1 }],
      civilians: [{ x: 5, y: 5 }], seed: 77,
    })
    for (const [id, st] of [['e1', 'cuffed'], ['e2', 'dead'], ['e3', 'cuffed'], ['e4', 'cuffed'], ['e5', 'cuffed'], ['e6', 'escaped']] as const) U(s, id).status = st
    U(s, 'c1').status = 'dead'
    Object.assign(U(s, 's2'), { status: 'downed', wasDowned: true })
    Object.assign(U(s, 's3'), { status: 'dead', wasDowned: true })
    s.alarm = 7
    s.round = 5
    const sum = query.summary(s)
    expect(sum).toMatchObject({ rounds: 5, peakAlarm: 7, civilianCasualties: 1, troopersDowned: 2, troopersDead: 1, seed: 77, intel: 1 + 2 + 2 + 5 })
    expect(sum.enemies.gunman).toMatchObject({ arrests: 0, kills: 1, escapes: 1 })
    expect(sum.enemies.thug!.arrests).toBe(1)
    expect(Object.keys(sum).sort()).toEqual(['civilianCasualties', 'civiliansSafe', 'enemies', 'evidence', 'intel', 'objective', 'outcome', 'peakAlarm', 'rounds', 'seed', 'troopersDead', 'troopersDowned'])
  })
})

describe('INV invariants', () => {
  it('INV-1 INV-2 INV-3 INV-4 hold after every step of random games (the full 200-game check runs in tools/sim.ts)', () => {
    for (let seed = 1; seed <= 6; seed++) {
      let s = createGame({ mapId: 'bust-01', squad: ['recruit', 'enforcer', 'bulwark', 'marksman', 'vox', 'chem'].slice(0, 3 + (seed % 4)), seed })
      let alarm = 0
      for (let i = 0; i < 260 && !s.outcome; i++) {
        const legal = legalActions(s)
        expect(legal.length).toBeGreaterThan(0)
        const r = step(s, randomAction(s, 0, legal, 0.08))
        expect(r.ok).toBe(true)
        if (!r.ok) return
        expect(checkInvariants(r.state, alarm)).toEqual([])
        alarm = r.state.alarm
        s = r.state
      }
    }
  })

  it('INV-6 a random game ends in an outcome or is stopped by the stall cap sim.maxRounds', () => {
    let s = createGame({ mapId: 'bust-01', squad: ['recruit', 'recon', 'chem', 'vox'], seed: 3 })
    let n = 0
    while (!s.outcome && s.round <= s.tuning.sim.maxRounds && n < 8000) {
      const r = step(s, randomAction(s, 0, undefined, 0.08))
      if (!r.ok) throw new Error(r.reason)
      s = r.state
      n++
    }
    expect(n).toBeLessThan(8000)
    expect(s.outcome !== null || s.round > s.tuning.sim.maxRounds).toBe(true)
  })
})
