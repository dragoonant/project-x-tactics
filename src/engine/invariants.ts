// INV-1..4: cheap per-step invariants (INV-5 save round-trip and INV-6 stall cap are checked by tools/sim.ts).
import type { State } from './types'
import { legalActions } from './legal'
import { onBoard, tn } from './util'

export function checkInvariants(s: State, prevAlarm = 0): string[] {
  const bad: string[] = []
  // INV-1
  if (!s.outcome) {
    const l = legalActions(s)
    if (l.length === 0) bad.push('INV-1: legalActions is empty while the game is not over')
    if (!l.some((a) => a.type === 'endPhase')) bad.push('INV-1: endPhase missing from legalActions')
  }
  // INV-2
  const seen = new Map<string, string>()
  for (const u of s.units) {
    if (!onBoard(u)) continue
    const k = `${u.x},${u.y}`
    const other = seen.get(k)
    if (other) bad.push(`INV-2: ${u.id} and ${other} share tile ${k}`)
    seen.set(k, u.id)
    const t = s.map.tiles[u.y * s.map.w + u.x]
    if (!t || u.x < 0 || u.y < 0 || u.x >= s.map.w || u.y >= s.map.h) { bad.push(`INV-2: ${u.id} is off the map`); continue }
    if (t.k === 'wall') bad.push(`INV-2: ${u.id} stands in a wall at ${k}`)
    if (t.k === 'door' && !t.open) bad.push(`INV-2: ${u.id} stands in a closed door at ${k}`)
    if (t.o) bad.push(`INV-2: ${u.id} stands on object ${t.o} at ${k}`)
  }
  // INV-3
  for (const u of s.units) {
    if (u.hp < 0 || u.hp > u.maxHp) bad.push(`INV-3: ${u.id} hp ${u.hp}/${u.maxHp}`)
    if (u.resolve < 0 || u.resolve > u.maxResolve) bad.push(`INV-3: ${u.id} resolve ${u.resolve}/${u.maxResolve}`)
    if (u.actions < 0) bad.push(`INV-3: ${u.id} actions ${u.actions}`)
    if (!Number.isInteger(u.hp) || !Number.isInteger(u.resolve)) bad.push(`INV-3: ${u.id} non-integer hp/resolve`)
    if (u.status === 'active' && u.hp <= 0) bad.push(`INV-3: ${u.id} is active with 0 hp`)
  }
  // INV-4
  if (s.alarm < prevAlarm) bad.push(`INV-4: alarm decreased ${prevAlarm} -> ${s.alarm}`)
  if (s.alarm < 0 || s.alarm > tn(s, 'alarm.max')) bad.push(`INV-4: alarm ${s.alarm} out of range`)
  return bad
}
