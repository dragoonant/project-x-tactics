import { expect, test } from '@playwright/test'
import { beginGame, openStart } from './helpers'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

// Owner report: swiping the ability bar on an iPhone hit the home bar instead. On iOS the bottom bars keep clear of the bottom
// 34px (portrait) / 24px (landscape) even when the page is framed and reports no safe area; other phones keep the small margin.
for (const o of [{ name: 'portrait', w: 390, h: 844, gap: 34 }, { name: 'landscape', w: 844, h: 390, gap: 24 }]) {
  test(`iOS home bar (${o.name}): the bottom bars sit above it`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: o.w, height: o.h }, hasTouch: true, isMobile: true, userAgent: IPHONE })
    const page = await ctx.newPage()
    await openStart(page)
    await beginGame(page)
    expect(await page.evaluate(() => document.documentElement.classList.contains('ios'))).toBe(true)
    await page.evaluate(() => window.__px.select('s1'))
    for (const id of ['abilities', 'channels']) {
      const box = (await page.getByTestId(id).boundingBox())!
      expect(o.h - (box.y + box.height)).toBeGreaterThanOrEqual(o.gap - 0.5)
    }
    const bottomBar = await page.evaluate(() => { const r = document.querySelector('.bottom')!.getBoundingClientRect(); return innerHeight - r.bottom })
    expect(bottomBar).toBeGreaterThanOrEqual(o.gap - 0.5)
    await ctx.close()
  })
}

test('not iOS: the bottom bars keep their small margin', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const page = await ctx.newPage()
  await openStart(page)
  await beginGame(page)
  expect(await page.evaluate(() => document.documentElement.classList.contains('ios'))).toBe(false)
  const gap = await page.evaluate(() => innerHeight - document.querySelector('.bottom')!.getBoundingClientRect().bottom)
  expect(gap).toBeLessThan(12)
  await ctx.close()
})
