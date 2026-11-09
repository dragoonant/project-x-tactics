import { expect, test } from '@playwright/test'
import { beginGame, openStart } from './helpers'

// Rule 25: pick by tile only. A tap on a tile that is DRAWN BEHIND a standing figure must still act on that tile.
test('rule 25: tapping the tile behind a standing figure moves to that tile', async ({ page }) => {
  await openStart(page)
  await beginGame(page)
  // Squad start (8..11, 20). s1 at (8,20) is selected. s2 stands at (9,20), directly in front of tile (9,19) as seen from the south.
  const s = await page.evaluate(() => window.__px.state().units.filter((u: any) => u.side === 'squad').map((u: any) => ({ id: u.id, x: u.x, y: u.y })))
  const s2 = s.find((u: any) => u.id === 's2')!
  const behind = { x: s2.x, y: s2.y - 1 }
  const near = await page.evaluate(([x, y]) => window.__px.tileToScreen(x!, y!), [s2.x, s2.y])
  const far = await page.evaluate(([x, y]) => window.__px.tileToScreen(x!, y!), [behind.x, behind.y])
  // the figure (about one tile tall) covers the tile behind it on screen: that tile's centre is just above the figure's feet
  expect(far!.y).toBeLessThan(near!.y)
  expect(near!.y - far!.y).toBeLessThan(60)
  expect(await page.evaluate(() => window.__px.selected())).toBe('s1')
  await page.mouse.move(far!.x, far!.y)
  await page.mouse.click(far!.x, far!.y)
  await page.waitForFunction(([x, y]) => { const u = window.__px.state().units.find((q: any) => q.id === 's1'); return u.x === x && u.y === y }, [behind.x, behind.y])
  const log = await page.evaluate(() => window.__px.state().log)
  expect(log[log.length - 1]).toMatchObject({ type: 'move', unit: 's1', to: behind })
})

test('rule 25: a tap on a trooper selects it; a tap on empty unreachable ground clears', async ({ page }) => {
  await openStart(page)
  await beginGame(page)
  const p = await page.evaluate(() => window.__px.tileToScreen(10, 20))
  await page.mouse.click(p!.x, p!.y)
  expect(await page.evaluate(() => window.__px.selected())).toBe('s3')
  const f = await page.evaluate(() => window.__px.tileToScreen(1, 1)) // far corner: not reachable
  await page.mouse.click(f!.x, f!.y)
  expect(await page.evaluate(() => window.__px.selected())).toBeNull()
})
