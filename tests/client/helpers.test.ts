import { describe, expect, it } from 'vitest'
import { createGame, legalActions, randomAction, step, view } from '../../src/engine'
import type { GameEvent, State } from '../../src/engine'
import { describeEvent } from '../../src/client/game/describe'
import { abilityEntries, legalFor, reachFor, resolveTap } from '../../src/client/game/tap'
import { callSign } from '../../src/client/game/names'

const mk = (seed = 1): State => createGame({ mapId: 'bust-01', squad: ['recruit', 'enforcer', 'bulwark', 'recon'], seed })

describe('client helpers: telemetry text (rule 8)', () => {
  it('describes every event of many random games without undefined or NaN', () => {
    const kinds = new Set<string>()
    for (let seed = 1; seed <= 6; seed++) {
      let s = mk(seed)
      for (let i = 0; i < 260 && !s.outcome; i++) {
        const a = randomAction(s, 0, undefined, 0.12)
        const r = step(s, a)
        if (!r.ok) continue
        for (const e of r.events) {
          kinds.add(e.kind)
          const l = describeEvent(e, { state: r.state, visible: null })
          if (l) { expect(l.text).not.toMatch(/undefined|NaN|\[object/); expect(l.text.length).toBeGreaterThan(2) }
          const v = new Set(view(r.state, 'squad').units.map((u) => u.id))
          const l2 = describeEvent(e, { state: r.state, visible: v })
          if (l2) expect(l2.text).not.toMatch(/undefined|NaN|\[object/)
        }
        s = r.state
      }
    }
    expect(kinds.size).toBeGreaterThan(12)
  })

  it('survives malformed events', () => {
    const s = mk()
    const odd: GameEvent[] = [{ kind: 'attack', round: 1 }, { kind: 'damage', round: 1 }, { kind: 'alarm', round: 1 }, { kind: 'wave', round: 1 }, { kind: 'brandNew', round: 1 }, { kind: 'move', round: 1 }]
    for (const e of odd) { const l = describeEvent(e, { state: s, visible: null }); if (l) expect(l.text).not.toMatch(/undefined|NaN/) }
  })

  it('hides names of unseen enemies', () => {
    const s = mk()
    const e = s.units.find((u) => u.side === 'syndicate')!
    const l = describeEvent({ kind: 'surrender', round: 1, unit: e.id }, { state: s, visible: new Set() })!
    expect(l.text).toContain('unseen contact')
    expect(callSign({ id: 's2', side: 'squad' })).toBe('BRAVO')
  })
})

describe('client helpers: tap resolution (rule 25)', () => {
  const fogUnits = (s: State) => view(s, 'squad').units

  it('a tap on a reachable tile moves the selected trooper; on another trooper selects it', () => {
    const s = mk()
    const legal = legalFor(s)
    const mv = legal.find((a) => a.type === 'move' && a.unit === 's1')!
    if (mv.type !== 'move') throw new Error('no move')
    const r = resolveTap(s, fogUnits(s), legal, 's1', null, mv.to)
    expect(r).toMatchObject({ kind: 'actions', why: 'move' })
    const s2 = s.units.find((u) => u.id === 's2')!
    expect(resolveTap(s, fogUnits(s), legal, 's1', null, { x: s2.x, y: s2.y })).toEqual({ kind: 'select', unit: 's2' })
  })

  it('dash tiles resolve to two Move actions that the engine accepts', () => {
    const s = mk()
    const reach = reachFor(s, 's1')
    expect(reach.two.size).toBeGreaterThan(0)
    const d = [...reach.two.values()][0]!
    const r = resolveTap(s, fogUnits(s), legalFor(s), 's1', null, { x: d.x, y: d.y })
    expect(r.kind).toBe('actions')
    if (r.kind !== 'actions') return
    let cur = s
    for (const a of r.actions) { const st = step(cur, a); expect(st.ok).toBe(true); if (st.ok) cur = st.state }
    const u = cur.units.find((x) => x.id === 's1')!
    expect({ x: u.x, y: u.y }).toEqual({ x: d.x, y: d.y })
  })

  it('a tap on an adjacent unaware enemy takes it down quietly (ABL-TKD-1) instead of an ambush attack', () => {
    const s = mk()
    const e = s.units.find((u) => u.side === 'syndicate' && u.kind === 'heavy')!
    const r1 = s.units.find((u) => u.id === 's4')! // the Recon, placed on the Heavy's blind side (it looks south)
    r1.x = e.x; r1.y = e.y - 1
    const r = resolveTap(s, fogUnits(s), legalActions(s), 's4', null, { x: e.x, y: e.y })
    expect(r).toEqual({ kind: 'actions', actions: [{ type: 'ability', unit: 's4', ability: 'takedown', target: e.id }], why: 'takedown' })
    const entry = abilityEntries(s, legalActions(s), r1).find((x) => x.ability === 'takedown')!
    expect(entry).toMatchObject({ enabled: true, loud: false, label: 'Takedown' })
  })

  it('walls and unreachable ground do nothing or clear; never throws', () => {
    const s = mk()
    expect(resolveTap(s, fogUnits(s), legalFor(s), 's1', null, { x: 0, y: 0 })).toEqual({ kind: 'none' })
    expect(resolveTap(s, fogUnits(s), legalFor(s), 's1', null, { x: 1, y: 1 })).toEqual({ kind: 'clear' })
  })

  it('an armed ability only accepts tiles from legalActions', () => {
    const s = mk()
    const legal = legalFor(s)
    const frag = legal.find((a) => a.type === 'ability' && a.ability === 'frag')
    expect(frag).toBeTruthy()
    if (!frag || frag.type !== 'ability' || !frag.at) return
    expect(resolveTap(s, fogUnits(s), legal, frag.unit, { ability: 'frag' }, frag.at)).toMatchObject({ kind: 'actions' })
    expect(resolveTap(s, fogUnits(s), legal, frag.unit, { ability: 'frag' }, { x: 1, y: 1 }).kind).toBe('invalid')
  })

  it('hidden enemies are never selected or targeted by a tap', () => {
    const s = mk()
    const seen = new Set(fogUnits(s).map((u) => u.id))
    const hidden = s.units.filter((u) => u.side === 'syndicate' && !seen.has(u.id))
    expect(hidden.length).toBeGreaterThan(0)
    for (const e of hidden) {
      const r = resolveTap(s, fogUnits(s), legalFor(s), 's1', null, { x: e.x, y: e.y })
      expect(['select', 'actions'].includes(r.kind) && JSON.stringify(r).includes(e.id)).toBe(false)
    }
  })
})

describe('client helpers: ability bar', () => {
  it('lists every ability with a reason for the disabled ones', () => {
    const s = mk()
    for (const id of ['s1', 's2', 's3', 's4']) {
      const u = s.units.find((x) => x.id === id)!
      const entries = abilityEntries(s, legalActions(s), u)
      expect(entries.length).toBeGreaterThan(3)
      for (const e of entries) {
        expect(e.label).not.toMatch(/undefined/)
        if (!e.enabled) expect(e.reason.length).toBeGreaterThan(2)
      }
    }
    const recruit = abilityEntries(s, legalActions(s), s.units.find((x) => x.id === 's1')!)
    expect(recruit.find((e) => e.ability === 'cuff')!.enabled).toBe(false)
    expect(recruit.find((e) => e.ability === 'overwatch')!.enabled).toBe(true)
  })
})
