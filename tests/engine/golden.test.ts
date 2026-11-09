// A worked round on a small hand-built map with forced dice, asserting the exact event sequence and numbers.
// Forced rolls (state.forcedRolls) are consumed first, one per roll: d100 results and damage rolls alike.
import { describe, expect, it } from 'vitest'
import { replay, serialize } from '../../src/engine'
import { U, act, build, find, kinds } from './helpers'

// 12 x 7 arena with a half-cover stall at (6,3).
const GOLD = ['############', '#..........#', '#..........#', '#.....s....#', '#..........#', '#..........#', '############']

describe('golden turn', () => {
  it('ARCH-7 / ARCH-8 / HIT-1 / HIT-3 / DMG-3 / ABL-REC-2 / ALM-2 / TURN-2 worked round: mark, shot, return fire, end of round', () => {
    // Forced dice in order: s1 attack d100 = 30, damage 3; e1 attack d100 = 70, damage 4.
    let s = build(GOLD, {
      squad: [{ cls: 'recruit', x: 2, y: 3 }, { cls: 'recon', x: 2, y: 4 }],
      enemies: [{ type: 'gunman', x: 7, y: 3 }],
      tuning: { light: { darkSightRange: 99 } },
      forced: [30, 3, 70, 4],
    })
    expect(s.forcedRolls).toEqual([30, 3, 70, 4])
    const setup = s.setup

    // 1. Recon marks the gunman: 1 action, quiet, does not end the turn.
    let r = act(s, { type: 'ability', unit: 's2', ability: 'mark', target: 'e1' })
    expect(kinds(r.ev)).toEqual(['ability', 'marked'])
    expect(U(r.s, 'e1').marked).toBe(2)
    expect(U(r.s, 's2').actions).toBe(1)
    s = r.s

    // 2. Recruit fires: aim 65 + range 0 + mark 15 - half cover 20 = 60; roll 30 hits; rifle damage 3.
    //    Resolve: base 1 -> marked ceil(1.5)=2 -> wounded (2/5 hp) x2 = 4.
    r = act(s, { type: 'attack', unit: 's1', target: 'e1' })
    expect(kinds(r.ev)).toEqual(['attackAction', 'attack', 'damage', 'noise', 'alarm'])
    const atk = find(r.ev, 'attack')!
    expect(atk.breakdown).toMatchObject({
      distance: 5, aim: 65, range: 0, mods: [{ name: 'mark', value: 15 }],
      cover: { level: 'half', value: 20, flanked: false }, defence: 0, raw: 60, chance: 60, grazeChance: 15, missChance: 25,
    })
    expect(atk).toMatchObject({ roll: 30, outcome: 'hit', attacker: 's1', target: 'e1' })
    expect(find(r.ev, 'damage')).toMatchObject({ target: 'e1', hp: 3, hpLeft: 2, resolve: 4, resolveLeft: 2 })
    expect(find(r.ev, 'alarm')).toMatchObject({ from: 0, to: 1, reason: 'loud action' })
    expect(U(r.s, 'e1')).toMatchObject({ hp: 2, resolve: 2, status: 'active' })
    expect(U(r.s, 's1').actions).toBe(0)
    expect(r.s.forcedRolls).toEqual([70, 4])
    s = r.s

    // 3. End of the squad phase: the gunman gets its 2 actions.
    r = act(s, { type: 'endPhase' })
    expect(kinds(r.ev)).toEqual(['phaseEnd', 'phaseStart'])
    expect(U(r.s, 'e1').actions).toBe(2)
    s = r.s

    // 4. Return fire at the open (flanked) recruit: aim 60 + range 0 - 0 cover = 60; roll 70 is a graze
    //    (60 <= 70 < 75). Damage 4 -> graze ceil(4/2) = 2, flanked +1 = 3.
    r = act(s, { type: 'attack', unit: 'e1', target: 's1' })
    expect(kinds(r.ev)).toEqual(['attackAction', 'attack', 'damage', 'noise'])
    expect(find(r.ev, 'attack')).toMatchObject({ roll: 70, outcome: 'graze' })
    expect(find(r.ev, 'attack')!.breakdown).toMatchObject({ raw: 60, chance: 60, cover: { flanked: true, value: 0 } })
    expect(find(r.ev, 'damage')).toMatchObject({ target: 's1', hp: 3, hpLeft: 3, resolve: 0 })
    expect(U(r.s, 's1').hp).toBe(3)
    expect(r.s.alarm).toBe(1) // enemy fire does not raise Alarm
    s = r.s

    // 5. End of the syndicate phase: civilian phase, end of round (Alarm +1, mark -1), round 2.
    r = act(s, { type: 'endPhase' })
    expect(kinds(r.ev)).toEqual(['phaseEnd', 'phaseStart', 'alarm', 'roundEnd', 'phaseStart'])
    expect(r.ev.filter((e) => e.kind === 'phaseStart').map((e) => e.side)).toEqual(['civilians', 'squad'])
    expect(r.s).toMatchObject({ round: 2, phase: 'squad', alarm: 2, forcedRolls: [] })
    expect(U(r.s, 'e1').marked).toBe(1)
    expect([U(r.s, 's1').actions, U(r.s, 's2').actions, U(r.s, 'e1').actions]).toEqual([2, 2, 0])
    s = r.s

    // SAV-2 on the golden game: the action list plus setup reproduces the final state exactly.
    const rep = replay(setup, s.log)
    expect(rep.ok && rep.state).toEqual(s)
    expect(serialize(s).actions).toHaveLength(5)
  })
})
