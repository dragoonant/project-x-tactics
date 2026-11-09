import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { openStart } from './helpers'

// Writes docs/status/s1/*.png (S1 report). Run with PX_SHOTS=1 (skipped otherwise so a normal e2e run does not rewrite the images).
const OUT = 'docs/status/s1'
test.skip(!process.env.PX_SHOTS, 'set PX_SHOTS=1 to regenerate the S1 screenshots')
test.setTimeout(400_000)

async function city(page: Page, w: number, h: number): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  await page.setViewportSize({ width: w, height: h })
  await openStart(page)
  await page.evaluate(() => window.__px.setSpeed('instant'))
  await page.getByTestId('new-campaign').click()
  await expect(page.getByTestId('city-hud')).toBeVisible()
  await page.waitForTimeout(1500)
}
const step = (page: Page, a: unknown): Promise<unknown> => page.evaluate((x) => window.__px.cstep(x), a)

test('s1 desktop: start, city map and brief, after-action, roster, a deployed raid, the campaign end', async ({ page }) => {
  await city(page, 1440, 900)
  await page.screenshot({ path: `${OUT}/city-brief.png` })
  await page.getByTestId('brief-back').click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/city-map.png` })
  await page.getByTestId('incident-card').first().click()
  await page.getByTestId('auto-resolve').click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/after-action.png` })
  await page.getByTestId('aar-close').click()
  // a few weeks on, with promotions, so the roster has some history
  for (let w = 0; w < 5; w++) {
    await page.evaluate(() => {
      const px = window.__px
      const c = px.campaign()
      const inc = c.incidents.find((i: any) => i.result === null)
      const squad = c.roster.filter((t: any) => t.status === 'ready').slice(0, 4).map((t: any) => t.id)
      if (inc && c.missionsThisWeek === 0) px.cstep({ type: 'autoResolve', incident: inc.id, squad })
      for (const t of px.campaign().roster) if (t.cls === 'recruit' && t.rank >= 2 && t.status !== 'dead') px.cstep({ type: 'promote', trooper: t.id, cls: ['enforcer', 'recon', 'bulwark', 'chem', 'marksman', 'vox'][Number(t.id.slice(1)) % 6] })
      px.cstep({ type: 'endWeek' })
    })
  }
  await page.getByTestId('open-roster').click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/roster.png` })
  await page.getByTestId('roster-close').click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/city-week6.png` })
  // deploy into a raid if one is open, else the first incident
  const inc = await page.evaluate(() => { const c = window.__px.campaign(); return (c.incidents.find((i: any) => i.kind === 'raid' && i.result === null) ?? c.incidents.find((i: any) => i.result === null)).id })
  if (await page.getByTestId('brief-back').isVisible()) await page.getByTestId('brief-back').click()
  await page.locator(`[data-incident="${inc}"]`).click()
  await page.getByTestId('deploy').click()
  await expect(page.getByTestId('hud')).toBeVisible()
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${OUT}/deployed-variant.png` })
  await page.evaluate(() => window.__px.autoplay(6000))
  await page.getByTestId('return-city').click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/after-action-deployed.png` })
  await page.getByTestId('aar-close').click()
  // let the clock run out: end weeks with no missions until the city is lost
  for (let i = 0; i < 45; i++) { const r = await step(page, { type: 'endWeek' }); if (r) break }
  await expect(page.getByTestId('campaign-end')).toBeVisible()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/campaign-end.png` })
  await page.getByTestId('end-standby').click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}/start.png` })
})

test('s1 phone 390x844: city, brief, roster', async ({ page }) => {
  await city(page, 390, 844)
  await page.screenshot({ path: `${OUT}/phone-brief.png` })
  await page.getByTestId('brief-back').click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/phone-city.png` })
  await page.getByTestId('open-roster').click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/phone-roster.png` })
})
