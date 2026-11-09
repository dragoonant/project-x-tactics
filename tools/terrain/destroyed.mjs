// Destroyed-cover review shot: frags a full-cover tile (-> rubble) and a half-cover tile (-> debris decal) through the real engine
// (window.__px.dispatch), then screenshots both. usage: node tools/terrain/destroyed.mjs <base url> <out.png> [--w 1440] [--h 900]
import { chromium } from '@playwright/test'
const args = process.argv.slice(2)
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args.splice(i, 2)[1] : d }
const w = +opt('w', 1440), h = +opt('h', 900)
const [base, out] = args
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage()
p.on('pageerror', (e) => console.log('pageerror', e.message))
await p.goto(base + '/')
await p.waitForSelector('[data-testid=new-op]:not([disabled])', { timeout: 120000 })
await p.evaluate(() => window.__px.setSpeed('instant'))
await p.click('[data-testid=new-op]')
await p.waitForFunction(() => window.__px.camera() !== null && window.__pxBoard)
await p.waitForTimeout(800)
const res = await p.evaluate(async () => {
  const px = window.__px
  const s0 = px.state()
  const W = s0.map.w
  const objAt = (s, x, y) => s.map.tiles[y * W + x].o
  const frags = px.legal().filter((a) => a.type === 'ability' && a.ability === 'frag')
  const byTile = new Map()
  for (const a of frags) { const k = `${a.at.x},${a.at.y}`; (byTile.get(k) ?? byTile.set(k, []).get(k)).push(a) }
  const log = []
  // one full-cover tile (two frags), one half-cover tile (one frag), different throwers
  const used = new Set()
  const hit = async (kind, need) => {
    for (const [k, list] of byTile) {
      const [x, y] = k.split(',').map(Number)
      if (objAt(px.state(), x, y) !== kind) continue
      const us = [...new Set(list.map((a) => a.unit))].filter((u) => !used.has(u)).slice(0, need)
      if (us.length < need) continue
      for (const u of us) { const a = px.legal().find((q) => q.type === 'ability' && q.ability === 'frag' && q.unit === u && q.at.x === x && q.at.y === y); if (a) { used.add(u); await px.dispatch(a) } }
      log.push({ kind, x, y, now: objAt(px.state(), x, y) ?? 'none' })
      return
    }
  }
  await hit('fullCover', 2)
  await hit('halfCover', 1)
  return log
})
console.log(JSON.stringify(res))
const t = res[0] ?? res[1]
if (t) {
  const cx = t.x - 10.5, cz = t.y - 10.5 - 1
  await p.evaluate(([x, z]) => { window.__pxBoard.controller.setView({ x, z, az: 0.25, pol: 0.95, dist: 9 }); window.__pxWake() }, [cx, cz])
  await p.waitForTimeout(1500)
}
await p.screenshot({ path: out })
await b.close()
