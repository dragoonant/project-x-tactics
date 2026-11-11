import { expect, test, type Page } from '@playwright/test'
import { beginGame, openStart } from './helpers'

// Set SHOTS_DIR to a folder to also save frames of the shot in flight (for a look at the effect; the test passes either way).
const SHOTS_DIR = process.env.SHOTS_DIR

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 760 })
  await openStart(page)
})

/** Random squad steps (instant speed) until a trooper with `weapon` (or, after a while, anyone) has a ranged shot. */
async function findShot(page: Page, weapon: string): Promise<unknown> {
  for (let i = 0; i < 500; i++) {
    const shot = await page.evaluate((w) => {
      const s = window.__px.state()!
      const shots = window.__px.legal().filter((a) => a.type === 'attack' && 'target' in a && !!a.target)
      if (!w) return shots[0] ?? null
      return shots.find((a) => s.units.find((u: { id: string; weapon?: string }) => u.id === (a as { unit: string }).unit)?.weapon === w) ?? null
    }, i < 300 ? weapon : '')
    if (shot) return shot
    await page.evaluate((salt) => window.__px.randomStep(salt, 0.05), i)
    await page.waitForFunction(() => !window.__px.busy())
  }
  return null
}

for (const weapon of ['rifle', 'shotgun']) {
  test(`a ${weapon} shot fires real rounds in bullet time, then time runs at full speed again`, async ({ page }) => {
    await beginGame(page)
    const shot = await findShot(page, weapon)
    expect(shot).not.toBeNull()
    await page.evaluate(() => window.__px.setSpeed('normal'))
    await page.evaluate((a) => { void window.__px.dispatch(a as never) }, shot)
    await expect.poll(() => page.evaluate(() => window.__px.volleys().length), { timeout: 8000, intervals: [30] }).toBeGreaterThan(0)
    const v = (await page.evaluate(() => window.__px.volleys()))[0]!
    expect(v.rounds).toBeGreaterThanOrEqual(1)
    await expect.poll(() => page.evaluate(() => window.__px.timeRate()), { timeout: 3000, intervals: [20] }).toBeLessThan(1)
    if (SHOTS_DIR) for (let f = 0; f < 4; f++) { await page.screenshot({ path: `${SHOTS_DIR}/${weapon}-${f}.png` }); await page.waitForTimeout(140) }
    await page.waitForFunction(() => !window.__px.busy(), undefined, { timeout: 20_000 })
    expect(await page.evaluate(() => window.__px.timeRate())).toBe(1)
  })
}

test('with slow-motion shots off in Settings, time never slows', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('px-settings', JSON.stringify({ speed: 'instant', slowMo: false })))
  await page.reload()
  await expect(page.getByTestId('new-op')).toBeEnabled({ timeout: 60_000 })
  await beginGame(page)
  const shot = await findShot(page, '')
  expect(shot).not.toBeNull()
  await page.evaluate(() => window.__px.setSpeed('normal'))
  await page.evaluate((a) => { void window.__px.dispatch(a as never) }, shot)
  await expect.poll(() => page.evaluate(() => window.__px.volleys().length), { timeout: 8000, intervals: [30] }).toBeGreaterThan(0)
  const rates = new Set<number>()
  for (let i = 0; i < 15; i++) { rates.add(await page.evaluate(() => window.__px.timeRate())); await page.waitForTimeout(60) }
  expect([...rates]).toEqual([1])
})
