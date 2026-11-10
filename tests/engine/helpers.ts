// Test helpers: tiny hand-built maps, direct state edits, and step wrappers.
import { expect } from 'vitest'
import { createGame, step } from '../../src/engine'
import type { Action, GameEvent, MapData, Pt, State, Unit } from '../../src/engine'
import { dirty } from '../../src/engine/grid'

export const LEGEND: MapData['legend'] = {
  '#': { kind: 'wall' },
  '.': { kind: 'floor' },
  '+': { kind: 'door' },
  E: { kind: 'exit' },
  V: { kind: 'escape' },
  s: { kind: 'floor', object: 'halfCover' },
  D: { kind: 'floor', object: 'fullCover' },
  r: { kind: 'floor', object: 'rubble' },
}

/** 12 x 7 open arena. */
export const ARENA = [
  '############',
  '#..........#',
  '#..........#',
  '#..........#',
  '#..........#',
  '#..........#',
  '############',
]

export interface EnemyDef { type: string; x: number; y: number; loadout?: string; facing?: Pt }
export interface BuildOpts {
  squad?: { cls: string; x: number; y: number }[]
  enemies?: EnemyDef[]
  aware?: boolean
  groups?: { id: string; aware: boolean; units: EnemyDef[] }[]
  civilians?: Pt[]
  lamps?: Pt[]
  extraction?: { x: number; y: number; w: number; h: number }[]
  spawns?: { id: string; x: number; y: number }[]
  waves?: MapData['waves']
  seed?: number
  forced?: number[]
  tuning?: any
  facing?: Pt
}

export function build(rows: string[], o: BuildOpts = {}): State {
  const squad = o.squad ?? [{ cls: 'recruit', x: 2, y: 3 }]
  const groups = o.groups ?? (o.enemies && o.enemies.length ? [{ id: 'g1', aware: o.aware ?? true, units: o.enemies }] : [])
  const map: MapData = {
    id: 'test', name: 'test', width: rows[0]!.length, height: rows.length,
    legend: LEGEND, rows,
    lamps: o.lamps ?? [],
    extraction: o.extraction ?? [],
    squadStart: squad.map((q) => ({ x: q.x, y: q.y })),
    bulwarkFacing: o.facing ?? { x: 1, y: 0 },
    spawnPoints: o.spawns ?? [{ id: 'sp', x: 1, y: 1 }],
    waves: o.waves ?? { A: [], B: [], C: [] },
    groups,
    civilians: o.civilians ?? [],
  }
  return createGame({ mapId: 'test', squad: squad.map((q) => q.cls), seed: o.seed ?? 1, mapData: map, forcedRolls: o.forced, tuning: o.tuning })
}

export const U = (s: State, id: string): Unit => {
  const u = s.units.find((x) => x.id === id)
  if (!u) throw new Error(`no unit ${id}`)
  return u
}
export function place(s: State, id: string, x: number, y: number): void { const u = U(s, id); u.x = x; u.y = y }
export function setTile(s: State, x: number, y: number, patch: Record<string, unknown>): void {
  Object.assign(s.map.tiles[y * s.map.w + x]!, patch)
  dirty(s)
}
export function addObj(s: State, x: number, y: number, o: 'halfCover' | 'fullCover' | 'rubble' | 'lamp'): void {
  setTile(s, x, y, { o, hp: o === 'fullCover' ? 4 : o === 'lamp' ? 1 : 2 })
}
export function removeObj(s: State, x: number, y: number): void {
  const t = s.map.tiles[y * s.map.w + x]!
  delete t.o; delete t.hp
  dirty(s)
}

export interface Out { s: State; ev: GameEvent[] }
export function act(s: State, a: Action): Out {
  const r = step(s, a)
  if (!r.ok) throw new Error(`action ${JSON.stringify(a)} was rejected: ${r.reason}`)
  return { s: r.state, ev: r.events }
}
export function rejected(s: State, a: unknown): string {
  const r = step(s, a as Action)
  expect(r.ok).toBe(false)
  return r.ok ? '' : r.reason
}
export function endPhase(s: State): Out { return act(s, { type: 'endPhase' }) }
/** End the squad phase so the syndicate acts. */
export function toSyndicate(s: State): Out { return endPhase(s) }
/** Finish the syndicate phase, civilian phase and end of round; lands in the next squad phase. */
export function toNextSquad(s: State): Out { return endPhase(s) }

export const kinds = (ev: GameEvent[]): string[] => ev.map((e) => e.kind)
export const find = (ev: GameEvent[], kind: string): GameEvent | undefined => ev.find((e) => e.kind === kind)
export const all = (ev: GameEvent[], kind: string): GameEvent[] => ev.filter((e) => e.kind === kind)
export const dist2 = (a: Pt, b: Pt): number => Math.floor(Math.hypot(a.x - b.x, a.y - b.y))
