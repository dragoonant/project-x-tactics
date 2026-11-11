import { describe, expect, it } from 'vitest'
import { createGame, query, step, view } from '../../src/engine'
import { blocksSight, hasLOS, lineClear } from '../../src/engine/los'
import { coverAgainst } from '../../src/engine/cover'
import { ARENA, U, act, addObj, all, build, endPhase, find, place, rejected, setTile } from './helpers'

const LIT = { light: { darkSightRange: 99 } }
const WIDE = ['################', '#..............#', '#..............#', '#..............#', '################']

describe('MOVE grid and movement', () => {
  it('MOVE-1 square grid, x east y south origin top-left; tile kinds and objects load from the map', () => {
    const s = createGame({ mapId: 'bust-01', squad: ['recruit'], seed: 1 })
    const at = (x: number, y: number) => s.map.tiles[y * s.map.w + x]!
    expect(at(0, 0).k).toBe('wall')
    expect(at(0, 12).k).toBe('exit')
    expect(at(17, 1).k).toBe('escape')
    expect(at(6, 3)).toMatchObject({ k: 'door', open: false })
    expect(at(6, 10).o).toBe('halfCover')
    expect(at(11, 11).o).toBe('fullCover')
    expect(at(8, 11).o).toBe('lamp')
    const a = build(ARENA)
    const b = act(a, { type: 'move', unit: 's1', to: { x: 4, y: 3 } }).s
    expect(U(b, 's1').x).toBeGreaterThan(U(a, 's1').x) // east = +x
    const c = act(build(ARENA), { type: 'move', unit: 's1', to: { x: 2, y: 5 } }).s
    expect(U(c, 's1').y).toBeGreaterThan(3) // south = +y
  })

  it('MOVE-2 eight-direction movement at cost 1 per step; no diagonal corner cutting', () => {
    let s = build(ARENA, { squad: [{ cls: 'recruit', x: 2, y: 2 }] })
    expect(query.reachable(s, 's1').find((r) => r.x === 5 && r.y === 5)!.cost).toBe(3)
    expect(query.reachable(s, 's1').find((r) => r.x === 3 && r.y === 3)!.cost).toBe(1)
    addObj(s, 3, 2, 'fullCover')
    const r33 = query.reachable(s, 's1').find((r) => r.x === 3 && r.y === 3)!
    expect(r33.cost).toBe(2)
    expect(rejected(s, { type: 'move', unit: 's1', to: { x: 3, y: 2 } })).toMatch(/reach/)
    s = act(s, { type: 'move', unit: 's1', to: { x: 3, y: 3 } }).s
    expect(U(s, 's1').x).toBe(3)
  })

  it('MOVE-3 walls, closed doors (entered by stepping), cover objects, lamps and any unit block the tile; no passing through units', () => {
    const corridor = ['#######', '#.....#', '#######']
    let s = build(corridor, { squad: [{ cls: 'recruit', x: 1, y: 1 }], enemies: [{ type: 'gunman', x: 3, y: 1 }] })
    expect(query.reachable(s, 's1').map((r) => r.x).sort()).toEqual([2])
    expect(rejected(s, { type: 'move', unit: 's1', to: { x: 5, y: 1 } })).toMatch(/reach/)
    s = build(ARENA, { squad: [{ cls: 'recruit', x: 2, y: 3 }, { cls: 'recon', x: 3, y: 2 }], enemies: [{ type: 'gunman', x: 4, y: 3 }] })
    addObj(s, 3, 3, 'halfCover')
    addObj(s, 3, 4, 'lamp')
    U(s, 's2').status = 'downed'
    const tiles = new Set(query.reachable(s, 's1').map((r) => `${r.x},${r.y}`))
    for (const t of ['3,3', '3,4', '3,2', '4,3']) expect(tiles.has(t)).toBe(false)
    expect(tiles.has('2,2')).toBe(true)
  })

  it('MOVE-4 a Move costs 1 action and reaches at most Mobility steps; a dash is two Moves', () => {
    let s = build(ARENA, { squad: [{ cls: 'recruit', x: 1, y: 1 }] })
    rejected(s, { type: 'move', unit: 's1', to: { x: 8, y: 1 } })
    s = act(s, { type: 'move', unit: 's1', to: { x: 7, y: 1 } }).s
    expect(U(s, 's1').actions).toBe(1)
    s = act(s, { type: 'move', unit: 's1', to: { x: 10, y: 4 } }).s
    expect(U(s, 's1').actions).toBe(0)
    expect(rejected(s, { type: 'move', unit: 's1', to: { x: 9, y: 4 } })).toMatch(/no actions/)
  })

  it('MOVE-5 a closed door opens when stepped into as part of a move and stays open', () => {
    const rows = ['#######', '#..+..#', '#######']
    let s = build(rows, { squad: [{ cls: 'recruit', x: 1, y: 1 }] })
    const r = act(s, { type: 'move', unit: 's1', to: { x: 5, y: 1 } })
    s = r.s
    expect(s.map.tiles[1 * 7 + 3]).toMatchObject({ k: 'door', open: true })
    expect(U(s, 's1').actions).toBe(1)
    expect(find(r.ev, 'doorOpened')).toBeTruthy()
    s = act(s, { type: 'move', unit: 's1', to: { x: 1, y: 1 } }).s
    expect(s.map.tiles[1 * 7 + 3]!.open).toBe(true)
  })

  it('MOVE-6 moves resolve step by step; an interrupting overwatch kill stops the mover on its current tile', () => {
    let s = build(ARENA, { squad: [{ cls: 'recruit', x: 2, y: 3 }], enemies: [{ type: 'gunman', x: 9, y: 3 }], tuning: LIT, forced: [0, 3] })
    U(s, 'e1').hp = 1
    s = act(s, { type: 'ability', unit: 's1', ability: 'overwatch' }).s
    s = endPhase(s).s
    const r = act(s, { type: 'move', unit: 'e1', to: { x: 5, y: 3 } })
    expect(U(r.s, 'e1').status).toBe('dead')
    expect(U(r.s, 'e1').x).toBe(8)
    expect(find(r.ev, 'moveInterrupted')).toBeTruthy()
    expect(all(r.ev, 'step')).toHaveLength(1)
  })

  it('MOVE-7 range is floor(euclidean distance); square radius N means Chebyshev <= N', () => {
    const s = build(ARENA, { squad: [{ cls: 'recruit', x: 2, y: 3 }], enemies: [{ type: 'gunman', x: 5, y: 5 }], tuning: LIT })
    expect(query.hitChance(s, 's1', 'e1')!.distance).toBe(3) // sqrt(13) = 3.6
    let t = build(ARENA, {
      squad: [{ cls: 'recruit', x: 1, y: 1 }],
      enemies: [{ type: 'gunman', x: 5, y: 2 }, { type: 'gunman', x: 7, y: 4 }, { type: 'gunman', x: 8, y: 3 }],
      tuning: LIT, forced: [99],
    })
    place(t, 's1', 3, 1)
    t = act(t, { type: 'ability', unit: 's1', ability: 'frag', at: { x: 6, y: 3 } }).s
    expect(U(t, 'e1').hp).toBeLessThan(5)
    expect(U(t, 'e2').hp).toBeLessThan(5) // diagonal corner of the 3x3 block
    expect(U(t, 'e3').hp).toBe(5) // two tiles away
  })
})

describe('LOS line of sight', () => {
  it('LOS-1 supercover lines: a line through a corner is blocked only if both corner tiles block', () => {
    const s = build(ARENA)
    setTile(s, 4, 2, { k: 'wall' })
    expect(lineClear(s, 3, 2, 4, 3)).toBe(true)
    setTile(s, 3, 3, { k: 'wall' })
    expect(lineClear(s, 3, 2, 4, 3)).toBe(false)
    expect(lineClear(s, 4, 3, 3, 2)).toBe(false)
    setTile(s, 6, 3, { k: 'wall' })
    expect(lineClear(s, 2, 3, 9, 3)).toBe(false)
    expect(lineClear(s, 2, 4, 9, 4)).toBe(true)
  })

  it('LOS-1 attacks need a clear line: a wall between shooter and target blocks the attack, removing it allows it', () => {
    let s = build(ARENA, { enemies: [{ type: 'gunman', x: 7, y: 3 }], tuning: LIT })
    setTile(s, 5, 3, { k: 'wall' })
    expect(rejected(s, { type: 'attack', unit: 's1', target: 'e1' })).toMatch(/not seen/)
    setTile(s, 5, 3, { k: 'floor' })
    s = act(s, { type: 'attack', unit: 's1', target: 'e1' }).s
    expect(U(s, 's1').actions).toBe(0)
  })

  it('LOS-2 walls, closed doors, full cover and smoke block sight; half cover, rubble, lamps and units do not', () => {
    const s = build(ARENA, { enemies: [{ type: 'gunman', x: 4, y: 3 }] })
    setTile(s, 6, 1, { k: 'wall' })
    setTile(s, 6, 2, { k: 'door', open: false })
    addObj(s, 6, 3, 'fullCover')
    addObj(s, 6, 4, 'halfCover')
    addObj(s, 7, 1, 'rubble')
    addObj(s, 7, 2, 'lamp')
    setTile(s, 7, 3, { k: 'door', open: true })
    expect(blocksSight(s, 6, 1)).toBe(true)
    expect(blocksSight(s, 6, 2)).toBe(true)
    expect(blocksSight(s, 6, 3)).toBe(true)
    expect(blocksSight(s, 6, 4)).toBe(false)
    expect(blocksSight(s, 7, 1)).toBe(false)
    expect(blocksSight(s, 7, 2)).toBe(false)
    expect(blocksSight(s, 7, 3)).toBe(false)
    expect(blocksSight(s, 4, 3)).toBe(false) // a unit stands here
    s.smoke.push({ x: 9, y: 5, r: 1, t: 2 })
    setTile(s, 0, 0, {}) // invalidates the terrain cache after pushing smoke
    expect(blocksSight(s, 9, 5)).toBe(true)
    expect(blocksSight(s, 10, 4)).toBe(true)
    expect(blocksSight(s, 8, 5)).toBe(true)
    expect(blocksSight(s, 7, 5)).toBe(false)
  })

  it('LOS-3 / LOS-4 peeking: a unit beside a blocker may trace from its step-out tiles; non-adjacent units may not', () => {
    const s = build(ARENA, { squad: [{ cls: 'recruit', x: 3, y: 2 }], enemies: [{ type: 'gunman', x: 6, y: 2 }], tuning: LIT })
    setTile(s, 4, 2, { k: 'wall' })
    expect(lineClear(s, 3, 2, 6, 2)).toBe(false) // the straight line clips the wall
    expect(hasLOS(s, U(s, 's1'), U(s, 'e1'))).toBe(true) // peeking from (3,1)
    const t = act(s, { type: 'attack', unit: 's1', target: 'e1' }).s
    expect(t.log).toHaveLength(1)
    place(s, 's1', 2, 2)
    expect(hasLOS(s, U(s, 's1'), U(s, 'e1'))).toBe(false)
    expect(rejected(s, { type: 'attack', unit: 's1', target: 'e1' })).toMatch(/not seen/)
  })

  it('LOS-3 query.peekFrom: the step-out tile a unit looks from when its own line is blocked; null when it sees directly or not at all', () => {
    const s = build(ARENA, { squad: [{ cls: 'recruit', x: 3, y: 2 }], enemies: [{ type: 'gunman', x: 6, y: 2 }], tuning: LIT })
    expect(query.peekFrom(s, 's1', { x: 6, y: 2 })).toBeNull() // a clear straight line: no step-out
    setTile(s, 4, 2, { k: 'wall' })
    const p = query.peekFrom(s, 's1', { x: 6, y: 2 })
    expect([{ x: 3, y: 1 }, { x: 3, y: 3 }]).toContainEqual(p)
    setTile(s, 3, 1, { k: 'wall' })
    expect(query.peekFrom(s, 's1', { x: 6, y: 2 })).toEqual({ x: 3, y: 3 }) // the other side is walled
    place(s, 's1', 2, 2)
    expect(query.peekFrom(s, 's1', { x: 6, y: 2 })).toBeNull() // not beside the blocker
    expect(query.peekFrom(s, 'nobody', { x: 6, y: 2 })).toBeNull()
  })

  it('LOS-5 sight radius is 12 tiles for every unit', () => {
    const s = build(WIDE, { squad: [{ cls: 'recruit', x: 1, y: 2 }], enemies: [{ type: 'gunman', x: 13, y: 2 }, { type: 'gunman', x: 14, y: 2 }], tuning: LIT })
    expect(query.canSee(s, 's1', 'e1')).toBe(true)
    expect(query.canSee(s, 's1', 'e2')).toBe(false)
    expect(s.tuning.sight.radius).toBe(12)
  })
})

describe('LGT light and darkness', () => {
  it('LGT-1 tiles within the lamp radius with a clear line are lit; behind walls or beyond the radius they are dark; Spotlight lights', () => {
    const s = build(WIDE, { lamps: [{ x: 6, y: 2 }] })
    expect(query.isLit(s, 10, 2)).toBe(true)
    expect(query.isLit(s, 11, 2)).toBe(false)
    for (const y of [1, 2, 3]) setTile(s, 8, y, { k: 'wall' })
    expect(query.isLit(s, 9, 2)).toBe(false)
    expect(query.isLit(s, 12, 2)).toBe(false)
    s.spotlights.push({ x: 13, y: 2, r: 3, t: 2 })
    setTile(s, 13, 2, {})
    expect(query.isLit(s, 13, 2)).toBe(true)
    expect(query.isLit(s, 11, 2)).toBe(true)
  })

  it('LGT-2 a unit on a dark tile is seen only within 2 tiles, unless the observer has Night Vision', () => {
    const mk = (cls: string): ReturnType<typeof build> => build(ARENA, { squad: [{ cls, x: 2, y: 3 }], enemies: [{ type: 'gunman', x: 4, y: 3 }, { type: 'gunman', x: 5, y: 3 }] })
    const s = mk('recruit')
    expect(query.canSee(s, 's1', 'e1')).toBe(true)
    expect(query.canSee(s, 's1', 'e2')).toBe(false)
    expect(query.canSee(mk('recon'), 's1', 'e2')).toBe(true)
  })

  it('LGT-3 any ranged attack with LOS can shoot out a lamp: auto-hit, no roll, noise follows the weapon', () => {
    let s = build(ARENA, { lamps: [{ x: 5, y: 3 }], forced: [77] })
    expect(query.isLit(s, 5, 2)).toBe(true)
    const r = act(s, { type: 'attack', unit: 's1', at: { x: 5, y: 3 } })
    s = r.s
    expect(s.map.tiles[3 * 12 + 5]!.o).toBeUndefined()
    expect(s.forcedRolls).toEqual([77]) // no roll consumed
    expect(query.isLit(s, 5, 2)).toBe(false)
    expect(find(r.ev, 'noise')).toBeTruthy()
    expect(s.alarm).toBe(1)
    const q = build(ARENA, { squad: [{ cls: 'marksman', x: 2, y: 3 }], lamps: [{ x: 5, y: 3 }] })
    const rq = act(q, { type: 'attack', unit: 's1', at: { x: 5, y: 3 } })
    expect(find(rq.ev, 'noise')).toBeUndefined() // suppressed long rifle is quiet
    const blocked = build(ARENA, { lamps: [{ x: 6, y: 3 }] })
    setTile(blocked, 4, 3, { k: 'wall' })
    expect(rejected(blocked, { type: 'attack', unit: 's1', at: { x: 6, y: 3 } })).toMatch(/line of sight/)
  })
})

describe('FOG visibility', () => {
  it('FOG-1 an observer sees a unit within radius, with LOS, if lit or within 2 tiles or with Night Vision; a Drone Scan reveals regardless', () => {
    const s = build(ARENA, { enemies: [{ type: 'gunman', x: 8, y: 3 }] })
    expect(query.canSee(s, 's1', 'e1')).toBe(false) // dark, 6 away
    s.scans.push({ x: 8, y: 3, r: 4, t: 2 })
    expect(view(s, 'squad').units.some((u) => u.id === 'e1')).toBe(true)
    expect(query.sideSees(s, 's1', 'e1')).toBe(true)
    expect(query.canSee(s, 's1', 'e1')).toBe(false) // still not seen by the unit itself
    addObj(s, 5, 3, 'lamp')
    expect(query.canSee(s, 's1', 'e1')).toBe(true) // a lamp 3 tiles from the target lights it
  })

  it('FOG-2 a side sees what any of its units sees (shared sight)', () => {
    const s = build(ARENA, { squad: [{ cls: 'recruit', x: 2, y: 3 }, { cls: 'recon', x: 8, y: 5 }], enemies: [{ type: 'gunman', x: 9, y: 4 }] })
    expect(query.canSee(s, 's1', 'e1')).toBe(false)
    expect(query.canSee(s, 's2', 'e1')).toBe(true)
    expect(query.sideSees(s, 's1', 'e1')).toBe(true)
  })

  it('FOG-3 view() removes unseen opposing units, hides unaware group composition and keeps all terrain', () => {
    const s = build(ARENA, { groups: [{ id: 'quiet', aware: false, units: [{ type: 'gunman', x: 4, y: 3 }] }, { id: 'far', aware: false, units: [{ type: 'heavy', x: 10, y: 5 }] }] })
    const v = view(s, 'squad')
    expect(v.units.map((u) => u.id).sort()).toEqual(['e1', 's1'])
    expect(v.groups.every((g) => g.members.length === 0)).toBe(true)
    expect(v.map.tiles).toEqual(s.map.tiles)
  })

  it('FOG-4 a unit may attack only a target it sees itself, except the Marksman via Squadsight', () => {
    const mk = (cls: string): ReturnType<typeof build> =>
      build(ARENA, { squad: [{ cls, x: 2, y: 3 }, { cls: 'recruit', x: 6, y: 3 }], enemies: [{ type: 'gunman', x: 7, y: 4 }] })
    const s = mk('recruit')
    expect(rejected(s, { type: 'attack', unit: 's1', target: 'e1' })).toMatch(/not seen/)
    const m = mk('marksman')
    expect(act(m, { type: 'attack', unit: 's1', target: 'e1' }).s.log).toHaveLength(1)
  })
})

describe('COV cover', () => {
  const flanked = (s: ReturnType<typeof build>, id: string, ax: number, ay: number): ReturnType<typeof coverAgainst> => coverAgainst(s, U(s, id), ax, ay)

  it('COV-1 / COV-2 cover comes from orthogonal neighbours and only applies against attackers on that side; the best piece wins', () => {
    const s = build(ARENA, { squad: [{ cls: 'recruit', x: 2, y: 3 }], enemies: [{ type: 'gunman', x: 6, y: 3 }] })
    addObj(s, 5, 3, 'halfCover')
    expect(flanked(s, 'e1', 2, 3)).toMatchObject({ level: 'half', value: 20, flanked: false })
    expect(flanked(s, 'e1', 9, 3)).toMatchObject({ level: 'none', value: 0, flanked: true })
    expect(flanked(s, 'e1', 3, 1)).toMatchObject({ level: 'half' }) // diagonal from the west side
    addObj(s, 6, 2, 'fullCover')
    expect(flanked(s, 'e1', 3, 1)).toMatchObject({ level: 'full', value: 40 })
    setTile(s, 6, 4, { k: 'wall' })
    expect(flanked(s, 'e1', 6, 8)).toMatchObject({ level: 'full', source: 'wall' })
    setTile(s, 7, 3, { k: 'door', open: false })
    expect(flanked(s, 'e1', 12, 3)).toMatchObject({ level: 'full', source: 'door' })
    setTile(s, 7, 3, { open: true })
    expect(flanked(s, 'e1', 12, 3).level).toBe('none')
    setTile(s, 5, 3, { o: 'rubble' })
    expect(flanked(s, 'e1', 2, 3).level).toBe('half')
  })

  it('COV-3 flanked means no cover piece applies; the hit chance shows full value against cover and none when flanked', () => {
    const s = build(ARENA, { squad: [{ cls: 'recruit', x: 2, y: 3 }], enemies: [{ type: 'gunman', x: 6, y: 3 }], tuning: LIT })
    addObj(s, 5, 3, 'fullCover')
    const covered = query.hitChance(s, 's1', 'e1')!
    expect(covered.cover).toMatchObject({ level: 'full', value: 40, flanked: false })
    place(s, 's1', 6, 1)
    const open = query.hitChance(s, 's1', 'e1')!
    expect(open.cover).toMatchObject({ level: 'none', flanked: true })
  })

  it('COV-4 half = 20, full = 40 from tuning; Hunker doubles the value except for flanked units (HNK-1)', () => {
    const s = build(ARENA, { squad: [{ cls: 'recruit', x: 2, y: 3 }], enemies: [{ type: 'gunman', x: 6, y: 3 }], tuning: { cover: { half: 25, full: 50 } } })
    addObj(s, 5, 3, 'halfCover')
    expect(flanked(s, 'e1', 2, 3).value).toBe(25)
    addObj(s, 5, 3, 'fullCover')
    expect(flanked(s, 'e1', 2, 3).value).toBe(50)
    U(s, 'e1').hunkered = true
    expect(flanked(s, 'e1', 2, 3).value).toBe(100)
    expect(flanked(s, 'e1', 9, 3).value).toBe(0)
  })

  it('COV-5 cover is directional only; a unit gets nothing from the tile it stands on', () => {
    const s = build(ARENA, { squad: [{ cls: 'recruit', x: 2, y: 3 }], enemies: [{ type: 'gunman', x: 6, y: 3 }] })
    setTile(s, 6, 3, { o: 'fullCover', hp: 4 }) // an object under the unit itself
    for (const [x, y] of [[1, 1], [10, 5], [6, 1], [6, 5], [1, 3], [11, 3]] as const) expect(flanked(s, 'e1', x!, y!).level).toBe('none')
  })
})
