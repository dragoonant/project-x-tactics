import { describe, expect, it } from 'vitest'
import { PerspectiveCamera } from 'three'
import { CameraController, PAN_SPEED } from '../../src/client/board/camera'

const dom = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } as unknown as HTMLElement

function rig(az: number): CameraController {
  const c = new CameraController(new PerspectiveCamera(40, 800 / 600, 0.5, 400), dom)
  c.lim = { x: 50, z: 50 }
  c.setView({ x: 0, z: 0, az, dist: 20 })
  return c
}

describe('keyboard pan (WASD)', () => {
  it('W pans away from the camera and D to the screen right, at any rotation', () => {
    for (const az of [0, Math.PI / 2, 1.1]) {
      const c = rig(az)
      const before = c.orbitPose()
      const toLook = before.look.clone().sub(before.pos).setY(0).normalize()
      c.setPanKey('KeyW', true)
      expect(c.update(0.1)).toBe(true)
      c.setPanKey('KeyW', false)
      const moved = { x: c.view.x, z: c.view.z }
      expect(Math.hypot(moved.x, moved.z)).toBeCloseTo(20 * PAN_SPEED * 0.1, 5)
      expect(moved.x * toLook.x + moved.z * toLook.z).toBeGreaterThan(0)

      c.setView({ x: 0, z: 0 })
      c.setPanKey('KeyD', true)
      c.update(0.1)
      c.setPanKey('KeyD', false)
      const right = { x: -toLook.z, z: toLook.x } // forward rotated 90 degrees clockwise seen from above
      expect(c.view.x * right.x + c.view.z * right.z).toBeCloseTo(20 * PAN_SPEED * 0.1, 5)
    }
  })

  it('stops when the key is released, ignores other keys, and stays inside the board limits', () => {
    const c = rig(0)
    expect(c.setPanKey('KeyQ', true)).toBe(false)
    expect(c.update(0.1)).toBe(false)
    c.lim = { x: 1, z: 1 }
    c.setPanKey('KeyA', true)
    for (let i = 0; i < 50; i++) c.update(0.1)
    expect(c.view.x).toBe(-1)
    c.setPanKey('KeyA', false)
    expect(c.update(0.1)).toBe(false)
  })

  it('diagonals are not faster than a single direction; Shift doubles the speed', () => {
    const c = rig(0)
    c.setPanKey('KeyW', true); c.setPanKey('KeyD', true)
    c.update(0.1)
    expect(Math.hypot(c.view.x, c.view.z)).toBeCloseTo(20 * PAN_SPEED * 0.1, 5)
    c.clearPanKeys()
    c.setView({ x: 0, z: 0 })
    c.setPanKey('KeyS', true, true)
    c.update(0.1)
    expect(Math.hypot(c.view.x, c.view.z)).toBeCloseTo(2 * 20 * PAN_SPEED * 0.1, 5)
  })
})

describe('number keys select troopers', () => {
  it('key n picks the trooper on channel CH-n; empty slots and the dead pick nothing', async () => {
    const { createGame } = await import('../../src/engine')
    const { trooperForKey } = await import('../../src/client/game/controller')
    const s = createGame({ mapId: 'bust-01', squad: ['recruit', 'enforcer', 'bulwark', 'recon'], seed: 1 })
    const squad = s.units.filter((u) => u.side === 'squad')
    expect(trooperForKey(s, 1)).toBe(squad[0]!.id)
    expect(trooperForKey(s, 4)).toBe(squad[3]!.id)
    expect(trooperForKey(s, 5)).toBeNull()
    squad[1]!.status = 'dead'
    expect(trooperForKey(s, 2)).toBeNull()
  })
})
