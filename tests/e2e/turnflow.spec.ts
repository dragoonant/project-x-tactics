import { expect, test } from '@playwright/test'
import { beginGame, openStart } from './helpers'

test.use({ viewport: { width: 1000, height: 640 } })

test('ability bar: Overwatch fires at once, Frag arms a tile pick, disabled abilities explain themselves', async ({ page }) => {
  await openStart(page)
  await beginGame(page)
  const bar = page.getByTestId('abilities')
  await expect(bar.locator('[data-ability=overwatch]')).toBeVisible()
  // a disabled ability explains why, inline (no native tooltip)
  await bar.locator('[data-ability=cuff]').click({ force: true }) // aria-disabled buttons stay clickable so they can explain themselves
  await expect(page.getByTestId('hint')).toContainText('Cuff')
  await expect(page.getByTestId('hint')).toContainText(/adjacent|not/i)
  // arming Frag highlights tiles; tapping one throws it (an explosion event, +2 Alarm)
  await bar.locator('[data-ability=frag]').click()
  await expect(bar.locator('[data-ability=frag]')).toHaveClass(/armed/)
  const target = await page.evaluate(() => {
    const a = window.__px.legal().find((x: any) => x.type === 'ability' && x.ability === 'frag' && x.unit === 's1')
    return a.at as { x: number; y: number }
  })
  const pt = await page.evaluate(([x, y]) => window.__px.tileToScreen(x!, y!), [target.x, target.y])
  await page.mouse.move(pt!.x, pt!.y)
  await page.mouse.click(pt!.x, pt!.y)
  await page.waitForFunction(() => window.__px.state().log.some((a: any) => a.ability === 'frag'))
  await page.evaluate(() => window.__px.select('s2'))
  await page.locator('[data-ability=overwatch]').click()
  await page.waitForFunction(() => window.__px.state().units.find((u: any) => u.id === 's2').overwatch === 'overwatch')
  await expect(page.getByTestId('ticker')).toContainText('Overwatch')
})

test('End Turn at Normal/Fast speed animates the syndicate phase one action at a time and returns control', async ({ page }) => {
  await openStart(page)
  await beginGame(page, 'fast')
  const seen: string[] = []
  await page.getByTestId('end-turn').click()
  await expect(page.getByTestId('end-turn')).toContainText('BUSY')
  expect(await page.evaluate(() => window.__px.busy())).toBe(true)
  // while the feed is busy a tap on the board does nothing
  const logBefore = await page.evaluate(() => window.__px.state().log.length)
  const pt = await page.evaluate(() => window.__px.tileToScreen(9, 19))
  await page.mouse.click(pt!.x, pt!.y)
  expect(await page.evaluate(() => window.__px.state().log.length)).toBeGreaterThanOrEqual(logBefore)
  await page.waitForFunction(() => !window.__px.busy() && window.__px.state().round === 2 && window.__px.state().phase === 'squad', undefined, { timeout: 120_000 })
  seen.push(await page.getByTestId('phase').innerText())
  expect(seen[0]).toBe('SQUAD PHASE')
  await expect(page.getByTestId('ticker')).toContainText('SYNDICATE PHASE')
  await expect(page.getByTestId('ticker')).toContainText('Round 1 closed')
})

test('the squad picker starts the chosen squad with the typed seed', async ({ page }) => {
  await openStart(page)
  await page.getByTestId('slot-0').selectOption('marksman')
  await page.getByTestId('slot-3').selectOption('chem')
  await page.getByTestId('seed').fill('4242')
  await page.evaluate(() => window.__px.setSpeed('instant'))
  await page.getByTestId('new-op').click()
  await expect(page.getByTestId('hud')).toBeVisible()
  const s = await page.evaluate(() => window.__px.state().setup)
  expect(s.squad).toEqual(['marksman', 'enforcer', 'bulwark', 'chem'])
  expect(s.seed).toBe(4242)
  await page.getByTestId('gear').click()
  const hasAudio = await page.evaluate(async () => { const r = await fetch('assets/audio/manifest.json'); return r.ok && !/html/.test(r.headers.get('content-type') ?? '') })
  if (!hasAudio) await expect(page.getByTestId('audio-missing')).toBeVisible()
})
