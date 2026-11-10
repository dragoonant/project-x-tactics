import { afterEach, describe, expect, it } from 'vitest'
import { createGame, randomAction, step } from '../../src/engine'
import type { GameEvent, State } from '../../src/engine'
import { KILL, SHOT, killPose, shotPose } from '../../src/client/game/cinematic'
import { killsBeforeNextAttack, present } from '../../src/client/game/director'
import { camApi, cineLog, focus } from '../../src/client/game/presentation'

const open = (): boolean => false

describe('action camera poses', () => {
  it('shot pose sits behind the shooter, off its right shoulder, looking at the target', () => {
    const p = shotPose({ x: 0, z: 0 }, { x: 0, z: -6 }, open) // shooting north (-z)
    expect(p.pos[2]).toBeCloseTo(SHOT.backs[0]!, 5) // behind: +z
    expect(p.pos[0]).toBeCloseTo(SHOT.side, 5) // facing -z, the right is +x
    expect(p.pos[1]).toBe(SHOT.height)
    expect(p.look).toEqual([0, SHOT.lookY, -6])
  })

  it('shot pose moves to the left shoulder, then closer, when walls are behind the shooter', () => {
    const rightWalled = (x: number): boolean => x > 0.1
    const l = shotPose({ x: 0, z: 0 }, { x: 0, z: -6 }, rightWalled)
    expect(l.pos[0]).toBeCloseTo(-SHOT.side, 5)
    const farWalled = (_x: number, z: number): boolean => z > 1.2
    const n = shotPose({ x: 0, z: 0 }, { x: 0, z: -6 }, farWalled)
    expect(n.pos[2]).toBeLessThanOrEqual(1.2)
    const boxed = shotPose({ x: 0, z: 0 }, { x: 0, z: -6 }, () => true)
    expect(boxed.pos[1]).toBeGreaterThan(SHOT.height) // over the head
  })

  it('kill pose is close to the victim on the shooter side and looks at the body', () => {
    const v = { x: 3, z: -5 }
    const p = killPose({ x: 0, z: 0 }, v, open)
    const d = Math.hypot(p.pos[0] - v.x, p.pos[2] - v.z)
    expect(d).toBeCloseTo(KILL.dists[0]!, 5)
    const toShooter = { x: -v.x, z: -v.z }, toCam = { x: p.pos[0] - v.x, z: p.pos[2] - v.z }
    expect(toShooter.x * toCam.x + toShooter.z * toCam.z).toBeGreaterThan(0)
    expect(p.look).toEqual([v.x, KILL.lookY, v.z])
  })

  it('kill pose avoids walls', () => {
    const v = { x: 0, z: 0 }
    const walled = (x: number): boolean => x > 0.2 || x < -0.2 // only straight along z is open
    const p = killPose({ x: 0, z: 8 }, v, walled)
    expect(Math.abs(p.pos[0])).toBeLessThan(0.2)
  })
})

describe('action camera: which shot kills', () => {
  const ev = (kind: string, more: Record<string, unknown> = {}): GameEvent => ({ kind, round: 1, ...more }) as unknown as GameEvent
  it('the death of the target before the next attack makes it the killing shot', () => {
    const evs = [ev('attack', { attacker: 'a', target: 'b' }), ev('damage', { target: 'b' }), ev('death', { unit: 'b' })]
    expect(killsBeforeNextAttack(evs, 0, 'b')).toBe(true)
  })
  it('a later attack owns a later death; another unit dying is not this kill', () => {
    const evs = [ev('attack', { attacker: 'a', target: 'b' }), ev('attack', { attacker: 'c', target: 'b' }), ev('death', { unit: 'b' })]
    expect(killsBeforeNextAttack(evs, 0, 'b')).toBe(false)
    expect(killsBeforeNextAttack(evs, 1, 'b')).toBe(true)
    expect(killsBeforeNextAttack([ev('attack', { attacker: 'a', target: 'b' }), ev('death', { unit: 'x' })], 0, 'b')).toBe(false)
  })
})

describe('action camera: the director', () => {
  const calls: string[] = []
  const saved = { ...camApi }
  afterEach(() => { Object.assign(camApi, saved); calls.length = 0 })

  /** First accepted squad action whose events include a ranged attack that kills its target (and the state before it). */
  function findKill(): { before: State; after: State; events: GameEvent[] } {
    for (let seed = 1; seed <= 60; seed++) {
      let s = createGame({ mapId: 'bust-01', squad: ['recruit', 'enforcer', 'bulwark', 'recon'], seed })
      for (let i = 0; i < 400 && !s.outcome; i++) {
        const r = step(s, randomAction(s, i, undefined, 0.1))
        if (!r.ok) continue
        const evs = r.events
        const idx = evs.findIndex((e) => e.kind === 'attack' && e.via === 'attack' && typeof e.target === 'string' && killsBeforeNextAttack(evs, evs.indexOf(e), e.target as string))
        if (idx >= 0 && s.phase === 'squad' && s.units.find((u) => u.id === evs[idx]!.attacker)?.side === 'squad') return { before: s, after: r.state, events: evs }
        s = r.state
      }
    }
    throw new Error('no killing shot found')
  }

  it('plays the shoulder camera, cuts to the victim for the death, then hands the camera back', async () => {
    const { before, after, events } = findKill()
    camApi.shot = (pos, look) => { calls.push(`shot ${pos.map((n) => n.toFixed(1)).join(',')} -> ${look.map((n) => n.toFixed(1)).join(',')}`) }
    camApi.release = () => { calls.push('release') }
    const n0 = cineLog.length
    await present(events, before, after, { speed: 'fast', follow: false, cine: true, alive: () => true })
    const log = cineLog.slice(n0)
    expect(log.some((l) => l.startsWith('shot:'))).toBe(true)
    expect(log.some((l) => l.startsWith('kill:'))).toBe(true)
    expect(log.findIndex((l) => l.startsWith('kill:'))).toBeGreaterThan(log.findIndex((l) => l.startsWith('shot:')))
    expect(calls.filter((c) => c.startsWith('shot')).length).toBeGreaterThanOrEqual(2)
    expect(calls[calls.length - 1]).toBe('release')
    expect(focus.cine).toBeNull()
  }, 20_000)

  it('does nothing with the action camera switched off', async () => {
    const { before, after, events } = findKill()
    camApi.shot = () => { calls.push('shot') }
    const n0 = cineLog.length
    await present(events, before, after, { speed: 'fast', follow: false, cine: false, alive: () => true })
    expect(cineLog.length).toBe(n0)
    expect(calls).not.toContain('shot')
  }, 20_000)
})

describe('bodies stay on the board', () => {
  it('a unit the squad saw die keeps its figure (the fog view drops dead units)', async () => {
    const { view } = await import('../../src/engine')
    const { boardUnits, newBodies } = await import('../../src/client/game/vision')
    for (let seed = 1; seed <= 60; seed++) {
      let s = createGame({ mapId: 'bust-01', squad: ['recruit', 'enforcer', 'bulwark', 'recon'], seed })
      for (let i = 0; i < 400 && !s.outcome; i++) {
        const r = step(s, randomAction(s, i, undefined, 0.1))
        if (!r.ok) continue
        const seen = view(s, 'squad').units.map((u) => u.id)
        const died = r.events.find((e) => e.kind === 'death' && seen.includes(e.unit as string) && r.state.units.find((u) => u.id === e.unit)?.side !== 'squad')
        if (died) {
          const fog = view(r.state, 'squad')
          const bodies = newBodies(seen, r.state, [])
          expect(bodies).toContain(died.unit)
          const shown = boardUnits(r.state, fog, bodies)
          expect(shown.find((u) => u.id === died.unit)?.status).toBe('dead')
          expect(newBodies(seen, r.state, bodies)).toBe(bodies) // no change: same array
          return
        }
        s = r.state
      }
    }
    throw new Error('no death found')
  })
})
