import { expect, test } from '@playwright/test'
import { beginGame, openStart, watchErrors } from './helpers'

test.use({ viewport: { width: 1280, height: 760 } })

// STL / ABL-TKD on the board: unaware enemies carry a tag and a sight cone, dark tiles are shaded, Takedown is on every trooper's bar.
test('stealth layer: unaware tags and cones, Takedown on the ability bar with its explanation', async ({ page }) => {
  const errs = watchErrors(page)
  await openStart(page)
  await beginGame(page)
  await expect(page.getByTestId('unaware-tag').first()).toBeVisible()
  const tags = await page.getByTestId('unaware-tag').allTextContents()
  expect(tags.some((t) => /UNAWARE · PATROL/.test(t))).toBe(true)
  // the cones come from the engine and cover tiles in front of the patrol
  const cones = await page.evaluate(() => (window as any).__px.fog().groups.filter((g: any) => !g.aware).length)
  expect(cones).toBeGreaterThan(0)
  await page.evaluate(() => window.__px.select('s4'))
  const bar = page.getByTestId('abilities')
  await expect(bar.locator('[data-ability=takedown]')).toBeVisible()
  await bar.locator('[data-ability=takedown]').click({ force: true })
  await expect(page.getByTestId('hint')).toContainText(/Takedown/)
  await page.mouse.move(5, 5)
  if (process.env.PX_SHOTS) await page.screenshot({ path: 'docs/status/stealth/board.png' })
  expect(errs).toEqual([])
})
