import { expect, test } from '@playwright/test'
import { beginGame, openStart, watchErrors } from './helpers'

test.use({ viewport: { width: 640, height: 420 } })
test.setTimeout(420_000)

// A whole game at Instant speed: the squad is driven by randomAction through the test hook, the syndicate by the real policy.
test('a full game at Instant speed reaches the end screen, then Copy report / Replay / New operation work', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const errs = watchErrors(page)
  await openStart(page)
  await beginGame(page, 'instant')
  const res = await page.evaluate(() => window.__px.autoplay(5000))
  expect(res.screen).toBe('end')
  await expect(page.getByTestId('end-screen')).toBeVisible()
  await expect(page.getByTestId('outcome')).toHaveText(/OPERATION|CASE SETBACK/)
  await expect(page.getByTestId('end-screen')).toContainText('Peak Alarm')
  await expect(page.getByTestId('end-screen')).toContainText('Civilian casualties')
  // a finished game clears the save
  expect(await page.evaluate(() => localStorage.getItem('px-save'))).toBeNull()

  await page.getByTestId('copy-report').click()
  await expect(page.getByText('Report copied')).toBeVisible()
  const clip = await page.evaluate(() => navigator.clipboard.readText())
  expect(clip).toContain('Seed: 1')
  expect(clip).toContain('Tuning:')
  expect(clip).toContain('Outcome:')

  await page.getByTestId('replay').click()
  await expect(page.getByTestId('hud')).toBeVisible()
  expect(await page.evaluate(() => ({ seed: window.__px.state().setup.seed, round: window.__px.state().round, actions: window.__px.state().log.length }))).toEqual({ seed: 1, round: 1, actions: 0 })

  // back to the start screen via the end screen again
  await page.evaluate(() => window.__px.autoplay(5000))
  await expect(page.getByTestId('end-screen')).toBeVisible()
  await page.getByTestId('new-operation').click()
  await expect(page.getByTestId('start-screen')).toBeVisible()
  expect(errs).toEqual([])
})
