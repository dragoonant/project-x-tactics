import { describe, expect, it } from 'vitest'
import { createGame, query } from '../../src/engine'
import type { State } from '../../src/engine'
import { bfs, pathFrom, tilesOfKind } from '../../src/engine/grid'
import { validateData } from '../../tools/validate-data'

const game = (): State => createGame({ mapId: 'bust-01', squad: ['recruit', 'enforcer', 'bulwark', 'marksman', 'vox', 'chem'], seed: 1 })
const tile = (s: State, x: number, y: number) => s.map.tiles[y * s.map.w + x]!
const reach = (s: State, from: { x: number; y: number }) => bfs(s, from.x, from.y, 999, true)
const can = (s: State, from: { x: number; y: number }, to: { x: number; y: number }): boolean => reach(s, from).cost[to.y * s.map.w + to.x]! >= 0

describe('bust-01 Night Market', () => {
  it('MSN-1 data files validate against their schemas and cross-checks (every tuning key the engine reads exists)', () => {
    expect(validateData()).toEqual([])
  })

  it('MSN-1 the map is 22x22 with 6 squad starts, an extraction zone near the start, the van tile and exits on the edges', () => {
    const s = game()
    expect([s.map.w, s.map.h]).toEqual([22, 22])
    const starts = s.units.filter((u) => u.side === 'squad')
    expect(starts).toHaveLength(6)
    expect(new Set(starts.map((u) => `${u.x},${u.y}`)).size).toBe(6)
    expect(starts.every((u) => u.y >= 19)).toBe(true) // the south
    expect(starts.every((u) => s.map.extraction.some((p) => p.x === u.x && p.y === u.y))).toBe(true)
    expect(tilesOfKind(s, 'escape')).toEqual([{ x: 17, y: 1 }]) // north back alley
    const exits = tilesOfKind(s, 'exit')
    expect(exits.length).toBeGreaterThanOrEqual(4)
    expect(exits.every((p) => p.x === 0 || p.y === 0 || p.x === 21 || p.y === 21)).toBe(true)
    expect(s.map.spawns.some((p) => p.x <= 2)).toBe(true) // west edge
    expect(s.map.spawns.some((p) => p.x >= 19)).toBe(true) // east edge
  })

  it('MSN-1 the Bagman back room is reachable from the squad start through the front door AND through the dark back alley', () => {
    const start = { x: 8, y: 20 }
    const bagman = game().units.find((u) => u.kind === 'bagman')!
    const target = { x: bagman.x, y: bagman.y }
    // front door only: wall off the back door
    const front = game()
    front.map.tiles[3 * 22 + 6] = { k: 'wall' }
    expect(can(front, start, target)).toBe(true)
    const frontPath = pathFrom(front, reach(front, start), target.x, target.y)
    expect(frontPath.some((p) => p.x === 12 && p.y === 8)).toBe(true)
    // back alley only: wall off the front door
    const back = game()
    back.map.tiles[8 * 22 + 12] = { k: 'wall' }
    expect(can(back, start, target)).toBe(true)
    const backPath = pathFrom(back, reach(back, start), target.x, target.y)
    expect(backPath.some((p) => p.x === 6 && p.y === 3)).toBe(true) // through the back door
    expect(backPath.some((p) => p.y <= 2)).toBe(true)
    // a route that never touches a lit tile exists: wall off every lit tile and the room is still reachable
    const dark = game()
    dark.map.tiles[8 * 22 + 12] = { k: 'wall' }
    const litNow: number[] = []
    for (let y = 0; y < 22; y++) for (let x = 0; x < 22; x++) if (query.isLit(dark, x, y)) litNow.push(y * 22 + x)
    for (const i of litNow) dark.map.tiles[i] = { k: 'wall' }
    expect(can(dark, start, target)).toBe(true)
    const darkPath = pathFrom(dark, reach(dark, start), target.x, target.y)
    expect(darkPath.some((p) => p.y <= 2)).toBe(true)
    // with both doors walled off the room is sealed
    const sealed = game()
    sealed.map.tiles[3 * 22 + 6] = { k: 'wall' }
    sealed.map.tiles[8 * 22 + 12] = { k: 'wall' }
    expect(can(sealed, start, target)).toBe(false)
  })

  it('MSN-1 every spawn point, exit, escape tile, extraction tile, civilian and enemy start is reachable from the squad start', () => {
    const s = game()
    const r = reach(s, { x: 8, y: 20 })
    const ok = (p: { x: number; y: number }): boolean => r.cost[p.y * 22 + p.x]! >= 0
    for (const p of s.map.spawns) expect(ok(p), `spawn ${p.id}`).toBe(true)
    for (const p of tilesOfKind(s, 'exit')) expect(ok(p), `exit ${p.x},${p.y}`).toBe(true)
    for (const p of tilesOfKind(s, 'escape')) expect(ok(p), 'escape').toBe(true)
    for (const p of s.map.extraction) expect(ok(p), `extraction ${p.x},${p.y}`).toBe(true)
    for (const u of s.units) expect(ok(u), `${u.id} at ${u.x},${u.y}`).toBe(true)
  })

  it('LGT-1 the lamps light the market street; the side alley and the back alley are dark', () => {
    const s = game()
    const lit = (x: number, y: number): boolean => query.isLit(s, x, y)
    // the units standing in the market, the front-door approach and the stall lanes
    for (const u of s.units.filter((x) => x.group === 'patrol' || x.side === 'civilians')) expect(lit(u.x, u.y), `${u.id} at ${u.x},${u.y}`).toBe(true)
    expect(lit(12, 9)).toBe(true)
    let marketFloor = 0, marketLit = 0
    for (let y = 9; y <= 17; y++) for (let x = 4; x <= 19; x++) {
      const t = tile(s, x, y)
      if (t.k !== 'floor' || t.o) continue
      marketFloor++
      if (lit(x, y)) marketLit++
    }
    expect(marketLit / marketFloor).toBeGreaterThan(0.75)
    for (let y = 9; y <= 20; y++) for (const x of [1, 2, 3]) if (tile(s, x, y).k === 'floor' && !tile(s, x, y).o) expect(lit(x, y), `side alley ${x},${y}`).toBe(false)
    for (const y of [1, 2]) for (let x = 1; x <= 20; x++) if (!tile(s, x, y).o) expect(lit(x, y), `back alley ${x},${y}`).toBe(false)
    for (const u of s.units.filter((x) => x.side === 'squad')) expect(lit(u.x, u.y), `squad start ${u.id}`).toBe(false)
  })

  it('MSN-1 groups: market patrol (2 Thugs + Heavy), bar (Fixer + 2 Gunmen) and the back room (Bagman + 1 Gunman), all unaware, with stalls and dumpsters as cover', () => {
    const s = game()
    const comp = (g: string): string[] => s.units.filter((u) => u.group === g).map((u) => u.kind).sort()
    expect(comp('patrol')).toEqual(['heavy', 'thug', 'thug'])
    expect(comp('bar')).toEqual(['fixer', 'gunman', 'gunman'])
    expect(comp('backroom')).toEqual(['bagman', 'gunman'])
    expect(s.groups.every((g) => !g.aware)).toBe(true)
    const objs = s.map.tiles.map((t) => t.o)
    expect(objs.filter((o) => o === 'halfCover').length).toBeGreaterThan(8)
    expect(objs.filter((o) => o === 'fullCover').length).toBeGreaterThan(3)
    expect(Object.fromEntries(Object.entries(s.map.waves).map(([k, v]) => [k, v.map((d) => d.type).sort().join('+')]))).toEqual({ A: 'gunman+gunman+thug', B: 'gunman+gunman', C: 'gunman+gunman+heavy' })
  })
})
