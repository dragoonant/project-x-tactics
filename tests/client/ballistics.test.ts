import { afterEach, describe, expect, it } from 'vitest'
import { createGame, randomAction, step } from '../../src/engine'
import type { GameEvent, State } from '../../src/engine'
import { SLOW, WEAPON_FX, fxFor, landing, planVolley, type V3 } from '../../src/client/game/ballistics'
import { present } from '../../src/client/game/director'
import { fxList, slowTime, timeRate, warp } from '../../src/client/game/presentation'

const open = (): boolean => false
const from: V3 = [0, 0.8, 0]
const aim: V3 = [0, 0.58, -8] // eight units north
const fast = { slow: false, k: 1 }

describe('shot volleys per weapon', () => {
  it('rifles fire a three-round burst with a tracer, machine guns a longer burst, a pistol one round', () => {
    const r = planVolley('rifle', from, aim, 'hit', 's', open, fast)
    expect(r.shots.length).toBe(3)
    expect(r.rounds.filter((x) => x.tracer).length).toBe(1)
    expect(planVolley('lmg', from, aim, 'hit', 's', open, fast).shots.length).toBe(WEAPON_FX.lmg!.rounds)
    expect(planVolley('lmg', from, aim, 'hit', 's', open, fast).rounds.filter((x) => x.tracer).length).toBe(3)
    expect(planVolley('smg', from, aim, 'hit', 's', open, fast).shots.length).toBe(5)
    expect(planVolley('pistol', from, aim, 'hit', 's', open, fast).rounds.length).toBe(1)
    // burst shots are spaced by the weapon's gap
    expect(r.shots[1]! - r.shots[0]!).toBeCloseTo(WEAPON_FX.rifle!.gap, 5)
  })

  it('a shotgun throws one blast of pellets in a cone', () => {
    const v = planVolley('shotgun', from, aim, 'hit', 's', open, fast)
    expect(v.shots).toEqual([0])
    expect(v.rounds.length).toBe(WEAPON_FX.shotgun!.pellets)
    const xs = v.rounds.map((r) => r.to[0])
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.1) // spread, not one line
  })

  it('the roll decides how many rounds land: most on a hit, a few on a graze, none on a miss', () => {
    expect(landing(3, 'hit')).toBe(2)
    expect(landing(1, 'hit')).toBe(1)
    expect(landing(5, 'graze')).toBe(2)
    expect(landing(6, 'miss')).toBe(0)
    const hit = planVolley('rifle', from, aim, 'hit', 's', open, fast)
    expect(hit.rounds[0]!.hit).toBe(true) // the first round of a hit lands, so the hit reads at once
    expect(hit.firstHit).toBeCloseTo(hit.rounds[0]!.flight, 5)
    const miss = planVolley('rifle', from, aim, 'miss', 's', open, fast)
    expect(miss.rounds.every((r) => !r.hit)).toBe(true)
    expect(miss.firstHit).toBeNull()
    // a round that lands stops on the body; a miss passes beside it and carries on past it
    for (const r of hit.rounds.filter((x) => x.hit)) expect(Math.hypot(r.to[0] - aim[0], r.to[2] - aim[2])).toBeLessThan(0.4)
    for (const r of miss.rounds) expect(Math.hypot(r.to[0] - aim[0], r.to[2] - aim[2])).toBeGreaterThan(0.3)
  })

  it('a missed round ends in the first wall behind the target, or in the ground', () => {
    const wallAt = (_x: number, z: number): boolean => z < -9 // a wall one unit behind the target
    const v = planVolley('pistol', from, aim, 'miss', 'w', wallAt, fast)
    expect(v.rounds[0]!.impact).toBe('spark')
    expect(v.rounds[0]!.to[2]).toBeGreaterThan(-9.3)
    const low = planVolley('pistol', [0, 0.8, 0], [0, 0.1, -2], 'miss', 'g', open, fast)
    expect(['dust', null]).toContain(low.rounds[0]!.impact)
  })

  it('bullet time slows the flights and stretches the burst; a replayed shot looks the same', () => {
    const a = planVolley('rifle', from, aim, 'hit', 'x', open, { slow: false, k: 1 })
    const b = planVolley('rifle', from, aim, 'hit', 'x', open, { slow: true, k: 1 })
    expect(b.rounds[0]!.flight).toBeCloseTo(a.rounds[0]!.flight / SLOW.scale, 5)
    expect(b.end).toBeCloseTo(a.end / SLOW.scale, 5)
    // Fast speed shortens everything by the speed factor
    expect(planVolley('rifle', from, aim, 'hit', 'x', open, { slow: true, k: 0.4 }).end).toBeCloseTo(b.end * 0.4, 5)
    expect(planVolley('shotgun', from, aim, 'graze', 'same', open, fast)).toEqual(planVolley('shotgun', from, aim, 'graze', 'same', open, fast))
    expect(fxFor('nonsense')).toBe(WEAPON_FX.pistol)
  })

  it('the time rate drops to the bullet-time scale and eases back to 1', () => {
    const now = 1_000_000
    slowTime(now, now + 500, SLOW.scale, 100)
    expect(timeRate(now + 250)).toBeCloseTo(SLOW.scale, 5)
    expect(timeRate(now - 200)).toBe(1)
    expect(timeRate(now + 700)).toBe(1)
    const mid = timeRate(now + 550)
    expect(mid).toBeGreaterThan(SLOW.scale)
    expect(mid).toBeLessThan(1)
    warp.t0 = warp.t1 = 0
  })
})

describe('the director draws real rounds', () => {
  afterEach(() => { fxList.length = 0; warp.t0 = warp.t1 = 0 })

  function firstShot(weapon: string): { before: State; after: State; events: GameEvent[] } {
    for (let seed = 1; seed <= 80; seed++) {
      let s = createGame({ mapId: 'bust-01', squad: ['recruit', 'enforcer', 'bulwark', 'recon'], seed })
      for (let i = 0; i < 400 && !s.outcome; i++) {
        const r = step(s, randomAction(s, i, undefined, 0.1))
        if (!r.ok) continue
        if (r.events.some((e) => e.kind === 'attack' && e.weapon === weapon && e.via === 'attack')) return { before: s, after: r.state, events: r.events }
        s = r.state
      }
    }
    throw new Error(`no ${weapon} shot found`)
  }

  it('a rifle attack becomes a three-round volley, and bullet time runs while it flies', async () => {
    const { before, after, events } = firstShot('rifle')
    const kinds: string[] = []
    let slowed = false
    const watch = setInterval(() => { for (const f of fxList) kinds.push(`${f.kind}:${f.volley?.shots.length ?? ''}`); if (timeRate() < 1) slowed = true }, 5)
    await present(events, before, after, { speed: 'fast', follow: false, slowMo: true, alive: () => true })
    clearInterval(watch)
    expect(kinds).toContain('volley:3')
    expect(kinds.some((k) => k.startsWith('tracer'))).toBe(false)
    expect(slowed).toBe(true)
  }, 20_000)

  it('a shotgun attack becomes one blast of pellets, with no bullet time when it is switched off', async () => {
    const { before, after, events } = firstShot('shotgun')
    let pellets = 0, slowed = false
    const watch = setInterval(() => { for (const f of fxList) if (f.volley) pellets = Math.max(pellets, f.volley.rounds.length); if (timeRate() < 1) slowed = true }, 5)
    await present(events, before, after, { speed: 'fast', follow: false, slowMo: false, alive: () => true })
    clearInterval(watch)
    expect(pellets).toBe(WEAPON_FX.shotgun!.pellets)
    expect(slowed).toBe(false)
  }, 20_000)
})
