import { expect, test } from '@playwright/test'
import { beginGame, openStart } from './helpers'

test.use({ viewport: { width: 900, height: 600 } })
test.setTimeout(300_000)

// Rule 8: no native tooltips (no title attributes, no SVG <title>), and no "undefined" / "NaN" in the telemetry or anywhere.
test('rule 8: no title attributes; the ticker never shows undefined or NaN', async ({ page }) => {
  await openStart(page)
  expect(await page.evaluate(() => document.querySelectorAll('[title]').length)).toBe(0)
  await beginGame(page)
  await page.getByTestId('gear').click()
  await expect(page.getByTestId('settings')).toBeVisible()
  expect(await page.evaluate(() => document.querySelectorAll('[title]').length)).toBe(0)
  await page.getByTestId('gear').click()
  // play several rounds so many event kinds occur (moves, shots, noise, alarm, waves, civilians, syndicate turns)
  await page.evaluate(async () => {
    for (let r = 0; r < 6; r++) {
      for (let i = 0; i < 8; i++) await window.__px.randomStep(r * 31 + i, 0.2)
      if (window.__px.screen() !== 'play') break
      if (window.__px.state().phase === 'squad') await window.__px.endTurn()
    }
  })
  const lines = await page.evaluate(() => window.__px.ticker())
  expect(lines.length).toBeGreaterThan(10)
  for (const l of lines) { expect(l).not.toMatch(/undefined|NaN|\[object/) }
  const kinds = await page.evaluate(() => window.__px.state().log.length)
  expect(kinds).toBeGreaterThan(10)
  expect(await page.evaluate(() => document.querySelectorAll('[title]').length)).toBe(0)
  expect(await page.evaluate(() => document.querySelectorAll('svg title').length)).toBe(0)
  expect(await page.evaluate(() => document.body.innerText)).not.toMatch(/undefined|NaN/)
})
