import { expect, test } from '@playwright/test'
import { beginGame, openStart, watchErrors } from './helpers'

// A3: skeletal animation on the board (spec 30). Every figure kind in public/assets/anim plays clips; a kind missing from it stays
// on its static model (the fallback tests below fake that with a routed manifest). `window.__px.anim(unitId)` is the clip a rig plays now (null: no rig), `animSeen` every clip it has played.

test('a rigged Enforcer fires when attacking, then returns to a standing clip', async ({ page }) => {
  const errs = watchErrors(page)
  await openStart(page)
  await beginGame(page, 'normal')
  expect(await page.evaluate(() => window.__px.rigKinds())).toContain('enforcer')
  expect(['idle', 'cover']).toContain(await page.evaluate(() => window.__px.anim('s2')))
  expect(['idle', 'cover']).toContain(await page.evaluate(() => window.__px.anim('s1'))) // the Recruit is rigged too (A1)

  // attack: aim then fire (an aim shorter than one slow frame may be skipped, a fire never is)
  const att = await page.evaluate(() => window.__px.legal().find((a: any) => a.unit === 's2' && a.type === 'attack'))
  expect(att).toBeTruthy()
  await page.evaluate((a) => { void window.__px.dispatch(a) }, att)
  await page.waitForFunction(() => window.__px.animSeen('s2').includes('fire'), null, { timeout: 30_000 })
  await page.waitForFunction(() => !window.__px.busy(), null, { timeout: 30_000 })
  await page.waitForFunction(() => ['idle', 'cover'].includes(window.__px.anim('s2') ?? ''), null, { timeout: 15_000 })
  const seenA = await page.evaluate(() => window.__px.animSeen('s2'))
  expect(seenA).toContain('fire')
  expect(seenA.some((c: string) => c === 'idle' || c === 'cover')).toBe(true)
  expect(errs).toEqual([])
})

test('a rigged Enforcer walks or runs while moving and returns to a standing clip', async ({ page }) => {
  const errs = watchErrors(page)
  await openStart(page)
  await beginGame(page, 'normal')
  // move: the farthest legal tile, so the walk lasts several frames
  const mv = await page.evaluate(() => {
    const m = window.__px.legal().filter((a: any) => a.unit === 's2' && a.type === 'move')
    const u = window.__px.state().units.find((q: any) => q.id === 's2')
    m.sort((a: any, b: any) => Math.hypot(b.to.x - u.x, b.to.y - u.y) - Math.hypot(a.to.x - u.x, a.to.y - u.y))
    return m[0]
  })
  expect(mv).toBeTruthy()
  await page.evaluate((a) => { void window.__px.dispatch(a) }, mv)
  await page.waitForFunction(() => ['walk', 'run'].includes(window.__px.anim('s2') ?? ''), null, { timeout: 30_000 })
  await page.waitForFunction(() => !window.__px.busy(), null, { timeout: 30_000 })
  await page.waitForFunction(() => ['idle', 'cover'].includes(window.__px.anim('s2') ?? ''), null, { timeout: 15_000 })
  const seenM = await page.evaluate(() => window.__px.animSeen('s2'))
  expect(seenM.some((c: string) => c === 'walk' || c === 'run')).toBe(true)
  expect(seenM.some((c: string) => c === 'idle' || c === 'cover')).toBe(true)
  expect(errs).toEqual([])
})

test('Instant speed skips animation: no cues, units end in their final pose, the game continues', async ({ page }) => {
  const errs = watchErrors(page)
  await openStart(page)
  await beginGame(page, 'instant')
  const att = await page.evaluate(() => window.__px.legal().find((a: any) => a.unit === 's2' && a.type === 'attack'))
  expect(att).toBeTruthy()
  const t0 = Date.now()
  await page.evaluate((a) => window.__px.dispatch(a), att)
  expect(Date.now() - t0).toBeLessThan(2000) // no aim / fire waits
  expect(await page.evaluate(() => window.__px.busy())).toBe(false)
  expect(await page.evaluate(() => window.__px.animSeen('s2'))).not.toContain('fire')
  expect(errs).toEqual([])
})

test('a missing anim manifest falls back to the static figures and the game still plays', async ({ page }) => {
  const errs = watchErrors(page)
  await page.route('**/assets/anim/manifest.json', (r) => r.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' }))
  await openStart(page)
  await beginGame(page, 'instant')
  const m = await page.evaluate(() => ({ kinds: window.__px.rigKinds(), models: window.__px.models(), a: window.__px.anim('s2') }))
  expect(m.kinds).toEqual([])
  expect(m.a).toBeNull()
  expect(m.models.total).toBeGreaterThan(0) // the static figures still count and load
  const mv = await page.evaluate(() => window.__px.legal().find((a: any) => a.unit === 's2' && a.type === 'move'))
  await page.evaluate((a) => window.__px.dispatch(a), mv)
  await page.waitForTimeout(500)
  expect(errs.filter((e) => !/anim\/manifest\.json|404|Failed to load resource/.test(e))).toEqual([])
})

test('a manifest naming a missing figure file falls back to the static figure and still counts in Loading models n/m', async ({ page }) => {
  const errs = watchErrors(page)
  await page.route('**/assets/anim/manifest.json', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 1, figures: { enforcer: { file: 'nope.glb', height: 1.8, clips: { idle: { duration: 1, loop: true } }, attachments: [] } }, items: {} }) }),
  )
  await openStart(page)
  await beginGame(page, 'instant')
  const m = await page.evaluate(() => ({ kinds: window.__px.rigKinds(), models: window.__px.models(), a: window.__px.anim('s2') }))
  expect(m.kinds).toEqual([])
  expect(m.a).toBeNull()
  expect(m.models.ready).toBe(true)
  expect(errs.filter((e) => !/nope\.glb|404|Failed to load resource|could not load/.test(e))).toEqual([])
})

test('Low quality tier freezes idle animation; the normal tier keeps updating standing figures', async ({ page, browser }) => {
  const sample = async (p: typeof page): Promise<{ updated: number; frozen: number }> => {
    const a = await p.evaluate(() => window.__px.animStats())
    await p.waitForTimeout(2500)
    const b = await p.evaluate(() => window.__px.animStats())
    return { updated: b.updated - a.updated, frozen: b.skippedFrozen - a.skippedFrozen }
  }
  await openStart(page)
  await beginGame(page, 'instant')
  const normal = await sample(page)
  expect(normal.updated).toBeGreaterThan(0)

  const ctx = await browser.newContext()
  const low = await ctx.newPage()
  await low.addInitScript(() => localStorage.setItem('px-settings', JSON.stringify({ speed: 'instant', lite: true, mute: true, volume: 0.1 })))
  await openStart(low)
  await beginGame(low, 'instant')
  await low.evaluate(() => window.__px.select('s2')) // any redraw while idle must not advance the frozen idle
  const frozen = await sample(low)
  expect(frozen.updated).toBe(0)
  await ctx.close()
})
