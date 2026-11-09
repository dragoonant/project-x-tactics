import { describe, expect, it } from 'vitest'
import { createGame } from '../../src/engine'
import type { State } from '../../src/engine'
import { tx, tz } from '../../src/client/board/layout'
import { indoorMask, propKindAt } from '../../src/client/board/terrain/terrainV2'
import { buildDressing, type WallRef } from '../../src/client/board/terrain/dressing'
import { pickTint, pickVariant, pickYaw } from '../../src/client/board/terrain/variants'
import { ventSpots } from '../../src/client/board/terrain/mood'

const mk = (): State => createGame({ mapId: 'bust-01', squad: ['recruit', 'enforcer', 'bulwark', 'recon'], seed: 1 })
const defs = [
  { slug: 'a', where: 'outdoor' as const, weight: 3, tints: [[1, 1, 1], [0.5, 0.5, 1]] as [number, number, number][] },
  { slug: 'b', where: 'outdoor' as const, weight: 1, tints: [[1, 1, 1]] as [number, number, number][] },
  { slug: 'c', where: 'indoor' as const, weight: 1, tints: [[1, 1, 1]] as [number, number, number][] },
  { slug: 'd', where: 'any' as const, weight: 2, tints: [[1, 1, 1]] as [number, number, number][] },
]

describe('terrain v2: deterministic variants', () => {
  it('the same tile always gets the same variant, yaw and tint', () => {
    for (let y = 0; y < 22; y++) for (let x = 0; x < 22; x++) {
      expect(pickVariant(defs, x, y, false)?.slug).toBe(pickVariant(defs, x, y, false)?.slug)
      expect(pickYaw(x, y)).toBe(pickYaw(x, y))
      expect(pickTint(defs[0]!, x, y)).toEqual(pickTint(defs[0]!, x, y))
    }
  })
  it('respects indoor / outdoor and uses every allowed variant across a map', () => {
    const seenOut = new Set<string>(), seenIn = new Set<string>()
    for (let y = 0; y < 22; y++) for (let x = 0; x < 22; x++) { seenOut.add(pickVariant(defs, x, y, false)!.slug); seenIn.add(pickVariant(defs, x, y, true)!.slug) }
    expect([...seenOut].sort()).toEqual(['a', 'b', 'd'])
    expect([...seenIn].sort()).toEqual(['c', 'd'])
  })
  it('returns null when nothing is allowed on that side', () => {
    expect(pickVariant([defs[2]!], 3, 3, false)).toBeNull()
  })
})

describe('terrain v2: indoor mask and cover kinds follow the map and the engine state', () => {
  it('the bar and the back rooms are indoor, the street is not', () => {
    const s = mk()
    const m = indoorMask(s)
    const at = (x: number, y: number): number => m[y * 22 + x]!
    expect(at(12, 5)).toBe(1) // the noodle bar
    expect(at(6, 6)).toBe(1) // back room
    expect(at(10, 12)).toBe(0) // street
    expect(at(12, 9)).toBe(0)
  })
  it('a destroyed full cover is rubble, a destroyed half cover keeps a debris decal, plain tiles show nothing', () => {
    const s = mk()
    const orig = new Uint8Array(22 * 22)
    for (let y = 0; y < 22; y++) for (let x = 0; x < 22; x++) { const o = s.map.tiles[y * 22 + x]!.o; if (o === 'halfCover' || o === 'fullCover') orig[y * 22 + x] = 1 }
    const full = s.map.tiles.findIndex((t) => t.o === 'fullCover')
    const half = s.map.tiles.findIndex((t) => t.o === 'halfCover')
    expect(propKindAt(s, full, orig)).toBe('fullCover')
    s.map.tiles[full]!.o = 'rubble'
    expect(propKindAt(s, full, orig)).toBe('rubble')
    delete s.map.tiles[half]!.o
    expect(propKindAt(s, half, orig)).toBe('@debris')
    expect(propKindAt(s, 0, orig)).toBeNull()
  })
})

describe('terrain v2: wall dressing stays on the rules grid', () => {
  const s = mk()
  const w = 22, h = 22
  const walls: WallRef[] = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (s.map.tiles[y * w + x]!.k === 'wall') walls.push({ x, y, wx: tx(x, w), wz: tz(y, h), boundary: x === 0 || y === 0 || x === w - 1 || y === h - 1 })
  const indoor = indoorMask(s)
  const d = buildDressing(s, indoor, walls, null)
  it('every item sits within the footprint of the wall tile it belongs to, plus a few centimetres', () => {
    expect(d.items.length).toBeGreaterThan(100)
    for (const it of d.items) {
      const wl = walls[it.wall]!
      // storefront awnings and neon outlines hang on the door tile next to their wall (one tile along the run), everything else on its own tile
      const lim = it.k === 'awning' || it.k === 'neon' ? 1.62 : 0.62
      expect(Math.abs(it.p[0] - wl.wx)).toBeLessThanOrEqual(lim)
      expect(Math.abs(it.p[2] - wl.wz)).toBeLessThanOrEqual(lim)
    }
  })
  it('both storefront doors get an awning and neon, and the roof trim caps every building wall', () => {
    expect(d.items.filter((i) => i.k === 'awning').length).toBe(2)
    expect(d.items.filter((i) => i.k === 'neon').length).toBeGreaterThanOrEqual(10)
    expect(d.items.filter((i) => i.k === 'trim').length).toBe(walls.filter((q) => !q.boundary).length)
  })
  it('is identical on every build, and the Low tier drops pipes and cables first but keeps windows, trim and neon', () => {
    expect(JSON.stringify(buildDressing(s, indoor, walls, null).items)).toBe(JSON.stringify(d.items))
    const low = buildDressing(s, indoor, walls, null, true)
    expect(low.items.some((i) => i.k === 'pipe' || i.k === 'cable')).toBe(false)
    expect(low.items.filter((i) => i.k === 'glass').length).toBe(d.items.filter((i) => i.k === 'glass').length)
    expect(low.items.length).toBeLessThan(d.items.length)
  })
  it('vent stacks stand on the boundary only', () => {
    const v = ventSpots(w, h, () => false)
    expect(v.length).toBeGreaterThan(2)
    for (const p of v) expect(p.x === 0 || p.y === 0 || p.x === w - 1 || p.y === h - 1).toBe(true)
  })
})
