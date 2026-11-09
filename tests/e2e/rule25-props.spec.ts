import { expect, test } from '@playwright/test'
import { beginGame, openStart } from './helpers'

// Rule 25 with terrain props: a tap on the tile DRAWN BEHIND a tall prop (a full-cover dumpster, pillar, vending machine or container
// pile) must act on that tile. Props carry no pointer handlers and are not raycast, so the pick surface under them always answers.
test('rule 25: tapping the tile behind a full-cover prop moves to that tile', async ({ page }) => {
  await openStart(page)
  await beginGame(page)
  const pick = await page.evaluate(() => {
    const s = window.__px.state()
    const w = s.map.w
    const o = (x: number, y: number): string | undefined => s.map.tiles[y * w + x]?.o
    for (const a of window.__px.legal()) {
      if (a.type !== 'move') continue
      const t = s.map.tiles[a.to.y * w + a.to.x]
      if (t.o || t.k !== 'floor') continue
      if (o(a.to.x, a.to.y + 1) === 'fullCover') return { unit: a.unit as string, to: a.to as { x: number; y: number }, prop: { x: a.to.x, y: a.to.y + 1 } }
    }
    return null
  })
  expect(pick, 'a reachable tile directly north of a full-cover tile').not.toBeNull()
  await page.evaluate((id) => window.__px.select(id), pick!.unit)
  // a lower, closer camera (the tactical close-up): the prop's top edge (1.0 above the ground) is then drawn above the centre of the
  // tile behind it, so the tap lands on drawn prop
  await page.evaluate(([px, py]) => {
    const w = window as unknown as { __pxBoard: { controller: { setView(v: object): void } }; __pxWake: () => void }
    const c = window.__px.camera()!
    w.__pxBoard.controller.setView({ x: px! - 10.5, z: py! - 10.5 - 1, az: c.az, pol: 1.0, dist: 9 })
    w.__pxWake()
  }, [pick!.prop.x, pick!.prop.y])
  await page.waitForTimeout(600)
  const geo = await page.evaluate(([px, py, tx, ty]) => {
    const b = (window as unknown as { __pxBoard: { controller: { project(x: number, y: number, z: number): { x: number; y: number } } } }).__pxBoard
    const top = b.controller.project(px! - 10.5, 1.0, py! - 10.5)
    const far = window.__px.tileToScreen(tx!, ty!)!
    return { topY: top.y, farY: far.y, farX: far.x }
  }, [pick!.prop.x, pick!.prop.y, pick!.to.x, pick!.to.y])
  expect(geo.topY).toBeLessThan(geo.farY)
  await page.mouse.move(geo.farX, geo.farY)
  await page.mouse.click(geo.farX, geo.farY)
  await page.waitForFunction(([id, x, y]) => { const u = window.__px.state().units.find((q: any) => q.id === id); return u.x === x && u.y === y }, [pick!.unit, pick!.to.x, pick!.to.y])
  const log = await page.evaluate(() => window.__px.state().log)
  expect(log[log.length - 1]).toMatchObject({ type: 'move', unit: pick!.unit, to: pick!.to })
})

test('rule 25: a tap on the prop itself (the dumpster tile) acts on that tile, not on a mesh', async ({ page }) => {
  await openStart(page)
  await beginGame(page)
  const d = await page.evaluate(() => {
    const s = window.__px.state()
    const i = s.map.tiles.findIndex((t: any) => t.o === 'fullCover')
    return { x: i % s.map.w, y: Math.floor(i / s.map.w) }
  })
  const p = await page.evaluate(([x, y]) => window.__px.tileToScreen(x!, y!), [d.x, d.y])
  expect(await page.evaluate(() => window.__px.selected())).toBe('s1')
  await page.mouse.click(p!.x, p!.y) // full cover is not walkable: the tap must not move or crash, and must not select a prop
  await page.waitForTimeout(300)
  const u = await page.evaluate(() => window.__px.state().units.find((q: any) => q.id === 's1'))
  expect(u.x === d.x && u.y === d.y).toBe(false)
})
