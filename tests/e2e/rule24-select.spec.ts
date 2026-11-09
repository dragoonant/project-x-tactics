import { expect, test } from '@playwright/test'
import { beginGame, openStart } from './helpers'

test.use({ viewport: { width: 390, height: 844 } })

test('rule 24: no text selection on a phone-sized screen; inputs stay selectable', async ({ page }) => {
  await openStart(page)
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('input')!).userSelect)).toBe('text')
  await beginGame(page)
  expect(await page.evaluate(() => getComputedStyle(document.body).userSelect)).toBe('none')
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('root')!).userSelect)).toBe('none')
  await page.locator('.topleft .cam').click({ clickCount: 3 })
  expect(await page.evaluate(() => (window.getSelection()?.toString() ?? '') === '')).toBe(true)
  // a context menu (long press) is suppressed outside inputs
  const prevented = await page.evaluate(() => {
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    document.querySelector('.topleft')!.dispatchEvent(e)
    return e.defaultPrevented
  })
  expect(prevented).toBe(true)
})
