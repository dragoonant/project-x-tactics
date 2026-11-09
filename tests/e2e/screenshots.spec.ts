import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { beginGame, openStart } from './helpers'

// Writes docs/status/m2-*.png. Run with PX_SHOTS=1 (skipped otherwise so a normal e2e run does not rewrite the images).
const OUT = 'docs/status'
test.skip(!process.env.PX_SHOTS, 'set PX_SHOTS=1 to regenerate the M2 screenshots')
test.setTimeout(300_000)

test('m2-start and m2-board (desktop 1440x900, mid-game, hovered enemy with the hit readout)', async ({ page }) => {
  mkdirSync(OUT, { recursive: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await openStart(page)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/m2-start.png` })
  await beginGame(page, 'instant')
  // advance the squad north until a hostile is in sight, then hover it
  const found = await page.evaluate(async () => {
    const px = window.__px
    for (let turn = 0; turn < 8; turn++) {
      const ids = px.state().units.filter((u: any) => u.side === 'squad' && u.status === 'active').map((u: any) => u.id)
      for (const id of ids.slice(0, 3)) {
        for (let k = 0; k < 2; k++) {
          const mv = px.legal().filter((a: any) => a.type === 'move' && a.unit === id).sort((a: any, b: any) => Math.abs(a.to.x - 11) + a.to.y - (Math.abs(b.to.x - 11) + b.to.y))[0]
          if (mv && turn < 1) await px.dispatch(mv)
        }
      }
      const en = px.fog().units.filter((u: any) => u.side === 'syndicate' && u.status === 'active')
      if (en.length) return en.map((e: any) => ({ id: e.id, x: e.x, y: e.y }))
      await px.endTurn()
    }
    return []
  })
  expect(found.length).toBeGreaterThan(0)
  await page.evaluate(() => { const px = window.__px; const t = px.state().units.find((u: any) => u.side === 'squad' && u.actions > 1); if (t) px.select(t.id) })
  await page.evaluate(() => window.__px.setSpeed('normal'))
  const e = found[0]!
  const p = await page.evaluate(([x, y]) => window.__px.tileToScreen(x!, y!), [e.x, e.y])
  await page.mouse.move(p!.x, p!.y)
  await page.waitForTimeout(1800)
  await page.screenshot({ path: `${OUT}/m2-board.png` })
})

test('m2-phone (390x844)', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await openStart(page)
  await beginGame(page, 'instant')
  await page.evaluate(() => window.__px.select('s1'))
  const e = await page.evaluate(() => window.__px.fog().units.find((u: any) => u.side === 'syndicate'))
  const pt = await page.evaluate(([x, y]) => window.__px.tileToScreen(x!, y!), [e.x, e.y])
  await page.touchscreen.tap(pt!.x, pt!.y) // first tap on a touch screen previews the shot
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/m2-phone.png` })
  await ctx.close()
})

test('m2-end (incident report)', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 760 })
  await openStart(page)
  await beginGame(page, 'instant')
  const r = await page.evaluate(() => window.__px.autoplay(5000))
  expect(r.screen).toBe('end')
  await expect(page.getByTestId('end-screen')).toBeVisible()
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}/m2-end.png` })
})
