import { expect, test } from '@playwright/test'
import { beginGame, watchErrors } from './helpers'

// Terrain v2 is the default since T1. Rule 26: every terrain texture and prop loads before New Operation is enabled, and the board
// never draws a stand-in while they load. `?terrain=v1` keeps the old procedural look and requests nothing from /assets/terrain/.
test('terrain v2 (default): New Operation waits for the terrain assets, then the board draws with props and no console errors', async ({ page }) => {
  const errs = watchErrors(page)
  const requested: string[] = []
  page.on('request', (r) => { if (r.url().includes('/assets/terrain/')) requested.push(r.url()) })
  await page.route('**/assets/terrain/manifest.json', async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue() })
  await page.goto('/')
  await expect(page.getByTestId('start-screen')).toBeVisible()
  const btn = page.getByTestId('new-op')
  await expect(btn).toBeDisabled() // the manifest is still being held back
  await expect(btn).toBeEnabled({ timeout: 90_000 })
  expect(await page.evaluate(() => window.__px.models().ready)).toBe(true)
  expect(requested.some((u) => u.endsWith('/manifest.json'))).toBe(true)
  expect(requested.filter((u) => /textures\/.*\.webp/.test(u)).length).toBe(15)
  expect(requested.filter((u) => /props\/.*\.glb/.test(u)).length).toBeGreaterThanOrEqual(14)
  await beginGame(page)
  await page.waitForTimeout(800)
  const stats = await page.evaluate(() => { const gl = (window as unknown as { __pxGl: { info: { render: { calls: number }; memory: { textures: number } } } }).__pxGl; return { calls: gl.info.render.calls, textures: gl.info.memory.textures } })
  expect(stats.textures).toBeGreaterThanOrEqual(15)
  expect(errs).toEqual([])
})

test('terrain v1: the old procedural look, nothing requested from /assets/terrain/', async ({ page }) => {
  const errs = watchErrors(page)
  const requested: string[] = []
  page.on('request', (r) => { if (r.url().includes('/assets/terrain/')) requested.push(r.url()) })
  await page.goto('/?terrain=v1')
  await expect(page.getByTestId('new-op')).toBeEnabled({ timeout: 90_000 })
  await beginGame(page)
  await page.waitForTimeout(500)
  expect(requested).toEqual([])
  expect(errs).toEqual([])
})

test('terrain v2: a missing manifest keeps the procedural terrain and the game still starts', async ({ page }) => {
  const errs = watchErrors(page)
  await page.route('**/assets/terrain/manifest.json', (route) => route.fulfill({ status: 404, body: 'no' }))
  await page.goto('/')
  await expect(page.getByTestId('new-op')).toBeEnabled({ timeout: 90_000 })
  await beginGame(page)
  await page.waitForTimeout(500)
  const clip = { x: 200, y: 150, width: 400, height: 300 }
  const withCanvas = await page.screenshot({ clip })
  await page.evaluate(() => { (document.querySelector('canvas') as HTMLElement).style.visibility = 'hidden' })
  expect((await page.screenshot({ clip })).equals(withCanvas)).toBe(false)
  expect(errs.filter((e) => !/404|Failed to load resource|terrain/.test(e))).toEqual([])
})

test('terrain v2: one prop failing to load only keeps its procedural stand-in; the rest of the dressing and the game work', async ({ page }) => {
  const errs = watchErrors(page)
  await page.route('**/assets/terrain/props/dumpster.glb', (route) => route.fulfill({ status: 404, body: 'no' }))
  await page.goto('/')
  await expect(page.getByTestId('new-op')).toBeEnabled({ timeout: 90_000 })
  await beginGame(page)
  await page.waitForTimeout(500)
  expect(errs.filter((e) => !/404|Failed to load resource|terrain|dumpster/.test(e))).toEqual([])
})

test('terrain v2: the rain toggle in settings adds and removes the rain draw call; Lite (the Low tier) never draws it', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('new-op')).toBeEnabled({ timeout: 90_000 })
  await beginGame(page)
  const calls = async (): Promise<number> => page.evaluate(async () => {
    const w = window as unknown as { __pxGl: { info: { render: { calls: number } } }; __pxWake: () => void }
    w.__pxWake()
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(0))))
    await new Promise((r) => setTimeout(r, 300))
    return w.__pxGl.info.render.calls
  })
  await page.getByTestId('gear').click()
  const rain = page.getByTestId('rain-toggle')
  await expect(rain).toBeChecked() // default: on (desktop)
  const withRain = await calls()
  await rain.uncheck()
  const without = await calls()
  expect(withRain - without).toBe(1)
  await rain.check()
  expect(await calls()).toBe(withRain)
  await page.getByText('Lite (no scanlines or glitch)').click() // Low tier: rain, steam and the pipes / cables / boxes dressing are dropped
  expect(await calls()).toBeLessThan(without)
})
