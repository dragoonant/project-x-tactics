import { expect, test } from '@playwright/test'
import { beginGame, openStart } from './helpers'

test.use({ viewport: { width: 1100, height: 760 } })

test.beforeEach(async ({ page }) => {
  await openStart(page)
  await beginGame(page)
})

test('F1-F6 select the trooper on that channel; an empty slot changes nothing; F5 does not reload', async ({ page }) => {
  const ids: string[] = await page.evaluate(() => window.__px.state().units.filter((u: { side: string }) => u.side === 'squad').map((u: { id: string }) => u.id))
  await page.keyboard.press('F2')
  await page.waitForFunction((id) => window.__px.selected() === id, ids[1])
  await page.keyboard.press('F1')
  await page.waitForFunction((id) => window.__px.selected() === id, ids[0])
  expect(ids.length).toBeLessThan(5)
  await page.keyboard.press('F5') // empty slot (4 troopers): no reload, selection unchanged
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => window.__px.selected())).toBe(ids[0])
})

test('number keys pick orders in bar order (1 is Fire); Escape cancels an armed order', async ({ page }) => {
  const bar = page.getByTestId('abilities')
  const keys = await bar.locator('[data-ability]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.ability!))
  expect(keys[0]).toBe('attack')
  await expect(bar.locator('[data-ability=attack] .hk')).toHaveText('1')
  const n = keys.indexOf('frag') + 1
  expect(n).toBeGreaterThan(0)
  await page.keyboard.press(String(n % 10))
  await expect(bar.locator('[data-ability=frag]')).toHaveClass(/armed/)
  await page.keyboard.press('Escape')
  await expect(bar.locator('[data-ability=frag]')).not.toHaveClass(/armed/)
  // a disabled order explains itself, the same as a click
  const cuff = keys.indexOf('cuff') + 1
  if (cuff > 0 && cuff <= 10) {
    await page.keyboard.press(String(cuff % 10))
    await expect(page.getByTestId('hint')).toContainText('Cuff')
  }
})
