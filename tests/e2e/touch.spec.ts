import { expect, test, type CDPSession, type Page } from '@playwright/test'
import { beginGame, cam, openStart } from './helpers'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

type Pt = { x: number; y: number; id: number }
const sessions = new WeakMap<Page, CDPSession>()
async function touch(page: Page, type: 'touchStart' | 'touchMove' | 'touchEnd', pts: Pt[]): Promise<void> {
  let cdp = sessions.get(page)
  if (!cdp) { cdp = await page.context().newCDPSession(page); sessions.set(page, cdp) }
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts })
}

test('touch: one finger pans, two fingers pinch and twist', async ({ page }) => {
  await openStart(page)
  await beginGame(page)
  // pinch out to zoom in first so the pan limits do not clamp
  const a0 = await cam(page)
  await touch(page, 'touchStart', [{ x: 150, y: 400, id: 1 }, { x: 240, y: 400, id: 2 }])
  for (let i = 1; i <= 6; i++) await touch(page, 'touchMove', [{ x: 150 - i * 12, y: 400 - i * 4, id: 1 }, { x: 240 + i * 12, y: 400 + i * 4, id: 2 }])
  await touch(page, 'touchEnd', [])
  await page.waitForTimeout(200)
  const a1 = await cam(page)
  expect(a1.dist).toBeLessThan(a0.dist - 1) // pinch zoomed in
  expect(Math.abs(a1.az - a0.az)).toBeGreaterThan(0.05) // the fingers also twisted

  await touch(page, 'touchStart', [{ x: 200, y: 420, id: 1 }])
  for (let i = 1; i <= 8; i++) await touch(page, 'touchMove', [{ x: 200 - i * 12, y: 420 + i * 6, id: 1 }])
  await touch(page, 'touchEnd', [])
  await page.waitForTimeout(200)
  const a2 = await cam(page)
  expect(Math.hypot(a2.x - a1.x, a2.z - a1.z)).toBeGreaterThan(0.5)
  // and the drag did not act on the board
  expect(await page.evaluate(() => window.__px.state().log.length)).toBe(0)
})

test('touch: a two-finger twist turns the board the same way as the fingers', async ({ page }) => {
  await openStart(page)
  await beginGame(page)
  const s1 = await page.evaluate(() => { const u = window.__px.state().units.find((q: any) => q.id === 's1'); return { x: u.x, y: u.y } })
  const screenAngle = (): Promise<number> => page.evaluate(([x, y]) => {
    const a = window.__px.tileToScreen(x!, y!)!, b = window.__px.tileToScreen(x! + 4, y!)!
    return Math.atan2(b.y - a.y, b.x - a.x)
  }, [s1.x, s1.y])
  const before = await screenAngle()
  // twist clockwise on screen (y down) by 30 degrees around (195, 420), finger spacing unchanged (no pinch)
  const at = (deg: number, sign: number) => { const r = (deg * Math.PI) / 180; return { x: 195 + sign * 60 * Math.cos(r), y: 420 + sign * 60 * Math.sin(r) } }
  await touch(page, 'touchStart', [{ ...at(0, -1), id: 1 }, { ...at(0, 1), id: 2 }])
  for (let i = 1; i <= 6; i++) await touch(page, 'touchMove', [{ ...at(i * 5, -1), id: 1 }, { ...at(i * 5, 1), id: 2 }])
  await touch(page, 'touchEnd', [])
  await page.waitForTimeout(200)
  let turn = (await screenAngle()) - before
  while (turn > Math.PI) turn -= Math.PI * 2
  while (turn < -Math.PI) turn += Math.PI * 2
  expect(turn).toBeGreaterThan(0.1) // the board turned clockwise on screen, like the fingers
})

test('touch: the first tap on a tile previews, the second confirms (no accidental moves)', async ({ page }) => {
  await openStart(page)
  await beginGame(page)
  const target = await page.evaluate(() => {
    const m = window.__px.legal().find((a: any) => a.type === 'move' && a.unit === 's1' && a.to.y === 17)
    return m.to as { x: number; y: number }
  })
  const pt = await page.evaluate(([x, y]) => window.__px.tileToScreen(x!, y!), [target.x, target.y])
  await page.touchscreen.tap(pt!.x, pt!.y)
  await expect(page.getByTestId('hint')).toContainText('Tap the tile again')
  expect(await page.evaluate(() => window.__px.state().log.length)).toBe(0)
  await page.touchscreen.tap(pt!.x, pt!.y)
  await page.waitForFunction(([x, y]) => { const u = window.__px.state().units.find((q: any) => q.id === 's1'); return u.x === x && u.y === y }, [target.x, target.y], { timeout: 15_000 })
})
