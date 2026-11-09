import { chromium, expect, test, type BrowserContext } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beginGame, openStart } from './helpers'

const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
const BASE = `http://localhost:${process.env.PW_PORT ?? 5281}`

async function profile(dir: string): Promise<BrowserContext> {
  return chromium.launchPersistentContext(dir, { args: ARGS, viewport: { width: 800, height: 560 }, baseURL: BASE })
}

const snap = (): unknown => {
  const s = window.__px.state()
  return { round: s.round, phase: s.phase, actions: s.log.length, alarm: s.alarm, seed: s.setup.seed, units: s.units.map((u: any) => [u.id, u.x, u.y, u.hp, u.status]) }
}

test('rule 22: play, close, reopen, Continue restores the same state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'px-profile-'))
  try {
    let ctx = await profile(dir)
    let page = await ctx.newPage()
    await openStart(page)
    await expect(page.getByTestId('continue-card')).toHaveCount(0)
    await beginGame(page)
    await page.evaluate(async () => {
      for (let i = 0; i < 6; i++) await window.__px.randomStep(i, 0)
      await window.__px.endTurn() // runs the syndicate phase too
      for (let i = 0; i < 3; i++) await window.__px.randomStep(100 + i, 0)
    })
    const before = await page.evaluate(snap)
    expect((before as any).actions).toBeGreaterThan(5)
    await ctx.close()

    ctx = await profile(dir)
    page = await ctx.newPage()
    await openStart(page)
    const card = page.getByTestId('continue-card')
    await expect(card).toBeVisible()
    await expect(card).toContainText('Recruit')
    await expect(card).toContainText(`Round ${(before as any).round}`)
    await expect(card).toContainText(`Alarm ${(before as any).alarm}`)
    await page.getByTestId('continue').click()
    await expect(page.getByTestId('hud')).toBeVisible()
    expect(await page.evaluate(snap)).toEqual(before)
    // and the restored game is playable
    await page.evaluate(() => window.__px.setSpeed('instant'))
    const n0 = (before as any).actions
    await page.evaluate(async () => { await window.__px.randomStep(7, 0) })
    expect(await page.evaluate(() => window.__px.state().log.length)).toBeGreaterThan(n0)
    await ctx.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rule 22: New Operation over a save asks once to confirm; Discard clears a corrupt save', async ({ page }) => {
  await openStart(page)
  await beginGame(page)
  await page.evaluate(async () => { await window.__px.randomStep(1, 0) })
  await page.reload()
  await expect(page.getByTestId('continue-card')).toBeVisible()
  await expect(page.getByTestId('new-op')).toBeEnabled({ timeout: 60_000 })
  await page.getByTestId('new-op').click()
  await expect(page.getByTestId('start-screen')).toBeVisible() // first click only asks
  await expect(page.getByTestId('new-op')).toContainText('CONFIRM')
  await page.getByTestId('new-op').click()
  await expect(page.getByTestId('hud')).toBeVisible()

  // corrupt save: says why and offers Discard
  await page.evaluate(() => localStorage.setItem('px-save', '{"v":1,"setup":{},"seed":1,"actions":[],"state":{"units":3}}'))
  await page.reload()
  await expect(page.getByTestId('bad-save')).toContainText('cannot be opened')
  await expect(page.getByTestId('continue-card')).toHaveCount(0)
  await page.getByTestId('discard').click()
  await expect(page.getByTestId('bad-save')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('px-save'))).toBeNull()

  await page.evaluate(() => localStorage.setItem('px-save', 'not json at all'))
  await page.reload()
  await expect(page.getByTestId('bad-save')).toContainText('unreadable save')
})

test('rule 22: refused storage shows a line in the UI', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = Storage.prototype.setItem
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === 'px-save') throw new DOMException('quota exceeded', 'QuotaExceededError')
      return orig.call(this, k, v)
    }
  })
  await openStart(page)
  await beginGame(page)
  await expect(page.getByTestId('hint')).toContainText('Autosave unavailable')
})
