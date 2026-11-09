// Screenshot driver for the T0/T1 review. usage:
//   node tools/terrain/shot.mjs <url> <out.png> [--w 1440] [--h 900] [--cam x,z,az,pol,dist] [--select s2] [--hover x,y] [--stats out.json] [--bare (start screen, no fog)] [--nohud]
// Same seed (1) and camera for before / after. Writes renderer.info draw calls and an average frame time (headless: relative only).
import { chromium } from '@playwright/test'
import fs from 'node:fs'
const args = process.argv.slice(2)
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args.splice(i, 2)[1] : d }
const w = +opt('w', 1440), h = +opt('h', 900), cam = opt('cam', ''), sel = opt('select', ''), hover = opt('hover', ''), stats = opt('stats', ''), seed = +opt('seed', 1)
const bare = args.includes('--bare'), nohud = args.includes('--nohud')
for (const f of ['--bare', '--nohud']) { const i = args.indexOf(f); if (i >= 0) args.splice(i, 1) }
const phone = w < 600
const [url, out] = args
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone })
const p = await ctx.newPage()
p.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/GPU stall|swiftshader|WebGL/i.test(m.text())) console.log(m.type(), m.text().slice(0, 240)) })
p.on('pageerror', (e) => console.log('pageerror', e.message))
await p.goto(url)
await p.waitForSelector('[data-testid=new-op]:not([disabled])', { timeout: 120000 })
await p.evaluate(() => window.__px.setSpeed('instant'))
if (bare) {
  // start screen with the whole map visible (no fog): review shots of the dressing
  await p.addStyleTag({ content: '[data-testid=start-screen]{display:none!important} .board-wrap.dim canvas{opacity:1!important}' })
} else {
  await p.evaluate((sd) => window.__px.start(['recruit', 'enforcer', 'bulwark', 'recon'], sd), seed).catch(() => {})
  if (!(await p.evaluate(() => window.__px.screen())).startsWith('play')) { await p.click('[data-testid=new-op]') }
}
await p.waitForFunction(() => window.__px.camera() !== null && window.__pxBoard, null, { timeout: 30000 }).catch(async () => console.log('wait failed', await p.evaluate(() => ({ keys: Object.keys(window).filter((k) => k.startsWith('__')), screen: window.__px.screen(), cam: window.__px.camera(), models: window.__px.models() }))))
if (nohud) await p.addStyleTag({ content: '[data-testid=hud]{display:none!important}' })
await p.waitForTimeout(1200)
if (cam) {
  const [x, z, az, pol, dist] = cam.split(',').map(Number)
  await p.evaluate(([x, z, az, pol, dist]) => { window.__pxBoard.controller.setView({ x, z, az, pol, dist }); window.__pxWake() }, [x, z, az, pol, dist])
}
if (sel) await p.evaluate((id) => window.__px.select(id === 'none' ? '' : id), sel)
if (hover) { const [hx, hy] = hover.split(',').map(Number); const pt = await p.evaluate(([x, y]) => window.__px.tileToScreen(x, y), [hx, hy]); await p.mouse.move(pt.x, pt.y) }
await p.waitForTimeout(1500)
await p.screenshot({ path: out })
if (stats) {
  const r = await p.evaluate(async () => {
    const gl = window.__pxGl
    if (!gl) return null
    const t0 = performance.now()
    let frames = 0, calls = 0, tris = 0
    const cvs = document.querySelector('canvas')
    gl.info.autoReset = true // renderer.info then holds the last frame only; sample it after each forced frame
    for (let i = 0; i < 30; i++) {
      window.__px.camera()
      window.__pxWake()
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(0))))
      if (gl.info.render.calls > 0) { calls += gl.info.render.calls; tris += gl.info.render.triangles; frames++ }
    }
    const ms = (performance.now() - t0) / 30
    return { calls: Math.round(calls / Math.max(1, frames)), triangles: Math.round(tris / Math.max(1, frames)), frames, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, msPerFrame: +ms.toFixed(2), canvas: cvs ? `${cvs.width}x${cvs.height}` : null }
  })
  fs.writeFileSync(stats, JSON.stringify(r, null, 2))
  console.log('stats', JSON.stringify(r))
}
await b.close()
