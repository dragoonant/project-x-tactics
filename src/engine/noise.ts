// NOI / ALM: group activation, noise, Alarm and reinforcement waves.
import type { Ctx, Group, Pt, State, Unit } from './types'
import { bfs, occupantAt } from './grid'
import { dirty } from './grid'
import { makeEnemy } from './enemies'
import { sees } from './fog'
import { panicAround } from './civilians'
import { dist, emit, isActive, onBoard, tn } from './util'

export function alertGroup(c: Ctx, g: Group, reason: string): void {
  if (g.aware) return
  g.aware = true
  emit(c, 'groupAware', { group: g.id, reason })
}

/** NOI-2a: unaware groups whose members see a trooper become aware. */
export function checkSight(c: Ctx): void {
  const s = c.s
  for (const g of s.groups) {
    if (g.aware) continue
    for (const mid of g.members) {
      const m = s.units.find((u) => u.id === mid)
      if (!m || !isActive(m)) continue
      const seen = s.units.find((t) => t.side === 'squad' && onBoard(t) && t.status !== 'dead' && sees(s, m, t))
      if (seen) { alertGroup(c, g, `sees ${seen.id}`); break }
    }
  }
}

export function raiseAlarm(c: Ctx, n: number, reason: string): void {
  const s = c.s
  const before = s.alarm
  s.alarm = Math.min(tn(s, 'alarm.max'), s.alarm + n)
  if (s.alarm === before) return
  emit(c, 'alarm', { from: before, to: s.alarm, reason })
  const th: [string, string][] = [['t1', 'A'], ['t2', 'B'], ['t3', 'C']]
  for (const [key, wave] of th) {
    if (s.alarm >= tn(s, `alarm.${key}`) && !s.alarmFired.includes(key)) {
      s.alarmFired.push(key)
      emit(c, 'alarmThreshold', { threshold: key, level: tn(s, `alarm.${key}`) })
      if (key === 't1') for (const g of s.groups) alertGroup(c, g, 'alarm')
      if (key === 't2') {
        for (const u of s.units) if (u.kind === 'bagman' && isActive(u)) { u.fleeing = true; emit(c, 'bagmanFlees', { unit: u.id }) }
        // A fleeing Bagman who is still unaware would never move (TURN-8): wake his group.
        for (const g of s.groups) alertGroup(c, g, 'alarm')
      }
      spawnWave(c, wave)
    }
  }
}

/** Nearest free passable tiles around a point, in BFS order. */
export function freeTilesNear(s: State, p: Pt, n: number): Pt[] {
  const b = bfs(s, p.x, p.y, 99, true)
  const cand: { x: number; y: number; c: number }[] = []
  for (let i = 0; i < b.cost.length; i++) {
    if ((b.cost[i] as number) < 0) continue
    const x = i % s.map.w, y = (i - x) / s.map.w
    if (occupantAt(s, x, y)) continue
    if (s.map.tiles[i]!.k === 'door' || s.map.tiles[i]!.k === 'exit') continue
    cand.push({ x, y, c: b.cost[i] as number })
  }
  cand.sort((a, b2) => a.c - b2.c || a.y - b2.y || a.x - b2.x)
  return cand.slice(0, n).map((q) => ({ x: q.x, y: q.y }))
}

/** ALM-4: reinforcement wave from the map's spawn points (R-5: spawn point = wave order, round-robin). */
export function spawnWave(c: Ctx, name: string): void {
  const s = c.s
  const defs = s.map.waves[name] ?? []
  if (defs.length === 0 || s.map.spawns.length === 0) return
  const order = ['A', 'B', 'C'].indexOf(name)
  const sp = s.map.spawns[(order < 0 ? 0 : order) % s.map.spawns.length]!
  const tiles = freeTilesNear(s, sp, defs.length)
  const g: Group = { id: `wave-${name}`, aware: true, members: [] }
  defs.forEach((d, i) => {
    const t = tiles[i]
    if (!t) return
    const id = `e${++s.nextIds.e}`
    const u = makeEnemy(id, d.type, t.x, t.y, d.loadout)
    u.group = g.id
    u.actions = tn(s, 'actions.perPhase')
    s.units.push(u)
    g.members.push(id)
  })
  s.groups.push(g)
  dirty(s)
  emit(c, 'wave', { wave: name, spawn: sp.id, units: g.members })
}

/**
 * NOI-2b/3/4: a noise at `origin`. Loud noises wake nearby groups and panic civilians; the first loud squad action
 * each round raises Alarm (ALM-3).
 */
export function makeNoise(c: Ctx, origin: Pt, loud: boolean, actor: Unit | null, label: string): void {
  const s = c.s
  if (!loud) return
  emit(c, 'noise', { at: origin, by: actor?.id ?? null, label, radius: tn(s, 'noise.hearingRadius') })
  panicAround(c, origin.x, origin.y, tn(s, 'civilian.panicRadius'), 'loud')
  for (const g of s.groups) {
    if (g.aware) continue
    const hears = g.members.some((id) => {
      const m = s.units.find((u) => u.id === id)
      return !!m && isActive(m) && dist(m.x, m.y, origin.x, origin.y) <= tn(s, 'noise.hearingRadius')
    })
    if (hears) alertGroup(c, g, 'noise')
  }
  if (actor?.side === 'squad' && s.loudRound !== s.round) {
    s.loudRound = s.round
    raiseAlarm(c, tn(s, 'alarm.loudShot'), 'loud action')
  }
}

/** NOI-5: attacking a member wakes the whole group (after the attack resolved). */
export function attackedGroup(c: Ctx, attacker: Unit, target: Unit): void {
  if (attacker.side !== 'squad' || !target.group) return
  const g = c.s.groups.find((x) => x.id === target.group)
  if (g) alertGroup(c, g, 'attacked')
}
