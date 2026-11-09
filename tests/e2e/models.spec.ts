import { expect, test } from '@playwright/test'
import { watchErrors } from './helpers'

// Rule 26: load before show. The manifest is faked here (the real one is produced by the art pipeline); the GLBs are the ones
// already in public/assets/models. The start button must wait ("Loading models n/m") until every listed model has loaded.
test('rule 26: models listed in the manifest preload before New Operation is enabled', async ({ page }) => {
  const errs = watchErrors(page)
  await page.route('**/assets/models/manifest.json', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ models: { recruit: 'recruit.glb', enforcer: { file: 'enforcer.glb' }, gunman: 'does-not-exist.glb' } }) }),
  )
  // the rigged-figure manifest is faked empty so the count below is the static one (3)
  await page.route('**/assets/anim/manifest.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 1, figures: {}, items: {} }) }))
  await page.goto('/')
  await expect(page.getByTestId('start-screen')).toBeVisible()
  const btn = page.getByTestId('new-op')
  await expect(btn).toBeEnabled({ timeout: 90_000 })
  const m = await page.evaluate(() => window.__px.models())
  expect(m).toMatchObject({ total: 3, ready: true })
  await page.evaluate(() => window.__px.setSpeed('instant'))
  await btn.click()
  await expect(page.getByTestId('hud')).toBeVisible()
  await page.waitForTimeout(1000)
  // a missing model falls back to the stand-in without breaking the board; only the deliberate 404 is allowed in the error list
  expect(errs.filter((e) => !/does-not-exist|404|Failed to load resource|could not load/.test(e))).toEqual([])
})
