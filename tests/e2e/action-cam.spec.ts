import { expect, test, type Page } from '@playwright/test'
import { beginGame, cam, openStart } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 760 })
  await openStart(page)
})

/** World x/z of a unit's tile (the board is centred on the origin). */
async function unitWorld(page: Page, id: string): Promise<{ x: number; z: number }> {
  return page.evaluate((uid) => {
    const s = window.__px.state()!
    const u = s.units.find((x: { id: string }) => x.id === uid)!
    return { x: u.x - s.map.w / 2 + 0.5, z: u.y - s.map.h / 2 + 0.5 }
  }, id)
}

test('unit box click centres the camera on that trooper and keeps rotation, tilt and zoom', async ({ page }) => {
  await beginGame(page)
  await page.keyboard.press('e') // turn the camera, so "keeps the orientation" is not the default angle
  await page.mouse.move(540, 380)
  await page.mouse.wheel(0, -600)
  await page.waitForTimeout(1200)
  const ids = await page.evaluate(() => window.__px.state()!.units.filter((u: { side: string; status: string }) => u.side === 'squad' && u.status === 'active').map((u: { id: string }) => u.id))
  const before = await cam(page)
  for (const id of ids.slice(0, 3)) {
    await page.locator(`[data-unit="${id}"]`).click()
    await expect.poll(() => page.evaluate(() => window.__px.selected())).toBe(id)
    const w = await unitWorld(page, id)
    await expect.poll(async () => { const c = await cam(page); return Math.hypot(c.x - w.x, c.z - w.z) }, { timeout: 5000 }).toBeLessThan(0.05)
    const c = await cam(page)
    expect(c.az).toBeCloseTo(before.az, 4)
    expect(c.pol).toBeCloseTo(before.pol, 4)
    expect(c.dist).toBeCloseTo(before.dist, 4)
  }
})

test('a shot plays over the shooter\'s shoulder, then the camera returns to the board view', async ({ page }) => {
  await beginGame(page) // instant: random squad steps until a ranged shot is legal
  let shot: unknown = null
  for (let i = 0; i < 400 && !shot; i++) {
    shot = await page.evaluate(() => window.__px.legal().find((a) => a.type === 'attack' && 'target' in a && !!a.target) ?? null)
    if (!shot) await page.evaluate((salt) => window.__px.randomStep(salt, 0.05), i)
    await page.waitForFunction(() => !window.__px.busy())
  }
  expect(shot).not.toBeNull()
  const before = await cam(page)
  const high = (await page.evaluate(() => window.__px.cameraPos()))!.y
  await page.evaluate(() => window.__px.setSpeed('normal'))
  const n0 = await page.evaluate(() => window.__px.cineLog().length)
  await page.evaluate((a) => { void window.__px.dispatch(a as never) }, shot)
  await expect.poll(() => page.evaluate(() => window.__px.cinematic()), { timeout: 5000 }).toBe('on')
  // the camera comes down to shoulder height behind the shooter
  await expect.poll(async () => (await page.evaluate(() => window.__px.cameraPos()))!.y, { timeout: 5000 }).toBeLessThan(2)
  expect((await page.evaluate(() => window.__px.cineLog())).slice(n0)[0]).toMatch(/^shot:/)
  await page.waitForFunction(() => !window.__px.busy(), undefined, { timeout: 20_000 })
  await expect.poll(() => page.evaluate(() => window.__px.cinematic()), { timeout: 5000 }).toBe('off')
  expect((await page.evaluate(() => window.__px.cameraPos()))!.y).toBeCloseTo(high, 1)
  const after = await cam(page)
  expect(after.az).toBeCloseTo(before.az, 4)
  expect(after.dist).toBeCloseTo(before.dist, 4)
})

test('with the action camera off in Settings, a shot keeps the board view', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('px-settings', JSON.stringify({ speed: 'instant', actionCam: false })))
  await page.reload()
  await expect(page.getByTestId('new-op')).toBeEnabled({ timeout: 60_000 })
  await beginGame(page)
  let shot: unknown = null
  for (let i = 0; i < 400 && !shot; i++) {
    shot = await page.evaluate(() => window.__px.legal().find((a) => a.type === 'attack' && 'target' in a && !!a.target) ?? null)
    if (!shot) await page.evaluate((salt) => window.__px.randomStep(salt, 0.05), i)
    await page.waitForFunction(() => !window.__px.busy())
  }
  expect(shot).not.toBeNull()
  await page.evaluate(() => window.__px.setSpeed('normal'))
  await page.evaluate((a) => { void window.__px.dispatch(a as never) }, shot)
  const seen = new Set<string>()
  for (let i = 0; i < 20; i++) { seen.add(await page.evaluate(() => window.__px.cinematic())); await page.waitForTimeout(100) }
  expect([...seen]).toEqual(['off'])
})
