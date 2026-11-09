import { expect, test } from '@playwright/test'
import { beginGame, openStart, watchErrors } from './helpers'

test('smoke: start screen, New Operation, board renders, no console errors', async ({ page }) => {
  const errs = watchErrors(page)
  await openStart(page)
  await expect(page.getByText('Unofficial prototype')).toContainText('credit: evilgouki')
  await expect(page.locator('canvas')).toHaveCount(1)
  await beginGame(page)
  await expect(page.locator('canvas')).toHaveCount(1) // one persistent canvas
  await expect(page.getByTestId('phase')).toHaveText('SQUAD PHASE')
  const st = await page.evaluate(() => ({ screen: window.__px.screen(), units: window.__px.state().units.length, cam: window.__px.camera() }))
  expect(st.screen).toBe('play')
  expect(st.units).toBeGreaterThan(8)
  expect(st.cam).not.toBeNull()
  await page.waitForTimeout(800)
  // the canvas really drew the board: the page looks different with the canvas hidden
  const clip = { x: 200, y: 150, width: 400, height: 300 }
  const withCanvas = await page.screenshot({ clip })
  await page.evaluate(() => { (document.querySelector('canvas') as HTMLElement).style.visibility = 'hidden' })
  const without = await page.screenshot({ clip })
  expect(withCanvas.equals(without)).toBe(false)
  await page.evaluate(() => { (document.querySelector('canvas') as HTMLElement).style.visibility = 'visible' })
  expect(errs).toEqual([])
})
