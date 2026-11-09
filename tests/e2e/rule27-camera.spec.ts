import { expect, test, type Page } from '@playwright/test'
import { beginGame, cam, openStart } from './helpers'

const centre = { x: 540, y: 380 }
async function drag(page: Page, button: 'left' | 'middle' | 'right', dx: number, dy: number): Promise<void> {
  await page.mouse.move(centre.x, centre.y)
  await page.mouse.down({ button })
  for (let i = 1; i <= 8; i++) await page.mouse.move(centre.x + (dx * i) / 8, centre.y + (dy * i) / 8)
  await page.mouse.up({ button })
}
const moved = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z)

async function zoomIn(page: Page): Promise<void> {
  await page.mouse.move(centre.x, centre.y)
  await page.mouse.wheel(0, -700)
  await page.waitForTimeout(250)
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 760 })
  await openStart(page)
  await beginGame(page)
})

test('rule 27: left drag pans on a fresh profile (no middle press seen)', async ({ page }) => {
  await zoomIn(page) // zoomed in, so the pan limits do not clamp the movement
  const a = await cam(page)
  await drag(page, 'left', 140, 60)
  const b = await cam(page)
  expect(moved(a, b)).toBeGreaterThan(0.5)
  expect(await page.evaluate(() => localStorage.getItem('px-mouse-3btn'))).toBeNull()
  expect(b.az).toBeCloseTo(a.az, 5) // panning does not rotate
})

test('rule 27: middle drag pans, and the first middle press is remembered', async ({ page }) => {
  await zoomIn(page)
  const a = await cam(page)
  await drag(page, 'middle', -140, -60)
  const b = await cam(page)
  expect(moved(a, b)).toBeGreaterThan(0.5)
  expect(await page.evaluate(() => localStorage.getItem('px-mouse-3btn'))).toBe('1')
})

test('rule 27: left drag after a middle press leaves the camera alone', async ({ page }) => {
  await zoomIn(page)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.up({ button: 'middle' })
  const a = await cam(page)
  await drag(page, 'left', 140, 60)
  const b = await cam(page)
  expect(moved(a, b)).toBeLessThan(0.01)
  expect(b.az).toBeCloseTo(a.az, 5)
})

test('rule 27: right drag rotates and tilts', async ({ page }) => {
  const a = await cam(page)
  await drag(page, 'right', 120, 40)
  const b = await cam(page)
  expect(Math.abs(b.az - a.az)).toBeGreaterThan(0.3)
  expect(Math.abs(b.pol - a.pol)).toBeGreaterThan(0.05)
})

test('rule 27: wheel zooms toward the cursor', async ({ page }) => {
  const target = { x: 760, y: 330 }
  const before = await cam(page)
  await page.mouse.move(target.x, target.y)
  await page.mouse.wheel(0, -500)
  await page.waitForTimeout(250)
  const after = await cam(page)
  expect(after.dist).toBeLessThan(before.dist - 2)
  // zooming toward a point right of the board centre moves the orbit target toward it
  expect(after.x).toBeGreaterThan(before.x + 0.3)
})

test('rule 27: the rotate buttons turn the table', async ({ page }) => {
  const a = await cam(page)
  await page.getByTestId('rot-right').click()
  await page.waitForFunction((az) => Math.abs(window.__px.camera()!.az - az) > 0.3, a.az)
})
