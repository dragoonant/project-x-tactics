// Spec 10 section 18.1: mission variants (raid objective, variant maps and tuning).
import { describe, expect, it } from 'vitest'
import { createGame, deserialize, query, replay, serialize, step } from '../../src/engine'
import type { MapData, Setup, State } from '../../src/engine'
import { MAPS } from '../../src/data'
import { ARENA, LEGEND, U, act, kinds } from './helpers'

const arenaMap = (o: Partial<MapData> = {}): MapData => ({
  id: 'test', name: 'test', width: ARENA[0]!.length, height: ARENA.length, legend: LEGEND, rows: ARENA,
  lamps: [], extraction: [{ x: 1, y: 1, w: 2, h: 1 }], squadStart: [{ x: 2, y: 3 }, { x: 2, y: 4 }], bulwarkFacing: { x: 1, y: 0 },
  spawnPoints: [{ id: 'sp', x: 10, y: 1 }], waves: { A: [], B: [], C: [] },
  groups: [{ id: 'g', aware: false, units: [{ type: 'gunman', x: 10, y: 5 }] }], civilians: [], ...o,
})
function raid(o: Partial<Setup> = {}, map: Partial<MapData> = {}): State {
  return createGame({ mapId: 'test', squad: ['recruit', 'recruit'], seed: 3, mapData: arenaMap(map), objective: 'raid', cache: { x: 6, y: 3 }, ...o })
}

describe('mission variants (VAR)', () => {
  it('VAR-1 a variant map and tuning ride in the setup and the save envelope; the map keeps its id', () => {
    const m = JSON.parse(JSON.stringify(MAPS['bust-01'])) as MapData
    m.lamps = m.lamps.slice(0, 1)
    m.groups[0]!.units.push({ type: 'heavy', x: 11, y: 14 })
    const s = createGame({ mapId: 'bust-01', squad: ['recruit'], seed: 5, mapData: m, tuning: { alarm: { t1: 3 } } })
    expect(s.map.id).toBe('bust-01')
    expect(s.tuning.alarm.t1).toBe(3)
    expect(s.map.tiles.filter((t) => t.o === 'lamp').length).toBe(1)
    expect(s.units.filter((u) => u.kind === 'heavy').length).toBe(2)
    const env = serialize(s)
    expect(env.setup.mapData?.lamps.length).toBe(1)
    const d = deserialize(JSON.parse(JSON.stringify(env)))
    expect(d.ok && d.state).toEqual(s)
    const r = replay(env.setup, [])
    expect(r.ok && r.state).toEqual(s)
  })

  it('VAR-2 a raid needs a cache on passable floor; state.raid exists only in raids', () => {
    expect(raid().raid).toEqual({ cache: { x: 6, y: 3 }, seized: false, burned: false })
    expect(createGame({ mapId: 'bust-01', squad: ['recruit'], seed: 1 }).raid).toBeUndefined()
    expect(() => raid({ cache: { x: 0, y: 0 } })).toThrow(/cache/)
    expect(() => raid({ cache: undefined })).toThrow(/cache/)
    expect(() => createGame({ mapId: 'bust-01', squad: ['recruit'], seed: 1, objective: 'heist' as never })).toThrow(/objective/)
  })

  it('VAR-3 a trooper next to the cache after a squad action seizes it', () => {
    let s = raid()
    let r = act(s, { type: 'move', unit: 's1', to: { x: 4, y: 3 } })
    expect(r.s.raid!.seized).toBe(false)
    r = act(r.s, { type: 'move', unit: 's1', to: { x: 5, y: 2 } })
    expect(r.s.raid!.seized).toBe(true)
    expect(kinds(r.ev)).toContain('cacheSeized')
    s = r.s
    expect(s.outcome).toBeNull() // still has to extract or clear
  })

  it('VAR-4 the cache burns when Alarm reaches raid.burnAlarm; seizing is checked first', () => {
    const s = raid()
    s.alarm = s.tuning.raid.burnAlarm - 1
    const r = act(s, { type: 'endPhase' })
    const r2 = act(r.s, { type: 'endPhase' }) // end of round: Alarm +1
    expect(r2.s.alarm).toBe(s.tuning.raid.burnAlarm)
    expect(r2.s.raid!.burned).toBe(true)
    expect(kinds(r2.ev)).toContain('cacheBurned')
    // seize and burn on the same action: seize wins
    const t = raid()
    t.alarm = t.tuning.raid.burnAlarm
    const r3 = act(t, { type: 'move', unit: 's1', to: { x: 5, y: 3 } })
    expect(r3.s.raid).toMatchObject({ seized: true, burned: false })
  })

  it('VAR-5 raid outcome: win with the cache and the zone, partial when it burned, loss with no able trooper', () => {
    let s = raid()
    s.raid!.seized = true
    for (const u of s.units) if (u.side === 'syndicate') u.status = 'dead'
    let r = act(s, { type: 'move', unit: 's1', to: { x: 3, y: 3 } })
    expect(r.s.outcome).toBe('win')
    s = raid()
    s.raid!.burned = true
    U(s, 's1').x = 1; U(s, 's1').y = 1
    r = act(s, { type: 'move', unit: 's2', to: { x: 2, y: 1 } })
    expect(r.s.outcome).toBe('partial')
    s = raid()
    U(s, 's2').status = 'dead'; U(s, 's2').hp = 0
    U(s, 's1').status = 'downed'; U(s, 's1').hp = 0
    r = act(s, { type: 'endPhase' })
    expect(r.s.outcome).toBe('loss')
  })

  it('VAR-6 the summary names the objective and counts the seized cache as evidence', () => {
    const s = raid()
    expect(query.summary(s)).toMatchObject({ objective: 'raid', evidence: 0 })
    s.raid!.seized = true
    expect(query.summary(s).evidence).toBe(s.tuning.raid.evidence)
    const b = createGame({ mapId: 'bust-01', squad: ['recruit'], seed: 1 })
    expect(query.summary(b)).toMatchObject({ objective: 'bust', evidence: 0 })
    expect(step(b, { type: 'endPhase' }).ok).toBe(true)
  })
})
