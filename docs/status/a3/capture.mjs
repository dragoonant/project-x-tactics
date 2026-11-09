// A3 review media and perf numbers. Serves dist/ (npm run build first) and drives the real game in headless Chromium.
//   node docs/status/a3/capture.mjs media [gpu|sw]   -> board-anim.png, enforcer.mp4 (webm converted by ffmpeg), strip.png
//   node docs/status/a3/capture.mjs perf  [gpu|sw]   -> prints the numbers perf.md quotes (JSON)
// `gpu` asks Chromium for the real GPU through ANGLE/D3D11; `sw` uses SwiftShader (what `npm run e2e` uses). Numbers are relative either way.
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join, extname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { chromium } from '@playwright/test'

const mode = process.argv[2] ?? 'media'
const gpu = (process.argv[3] ?? 'sw') === 'gpu'
const root = process.cwd()
const dist = join(root, 'dist')
const out = join(root, 'docs', 'status', 'a3')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.wav': 'audio/wav' }
const srv = createServer((req, res) => {
  const p = join(dist, decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '') || 'index.html')
  const f = existsSync(p) && statSync(p).isFile() ? p : join(dist, 'index.html')
  res.writeHead(200, { 'content-type': types[extname(f)] ?? 'application/octet-stream' })
  res.end(readFileSync(f))
}).listen(5392)

const args = gpu ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
const browser = await chromium.launch({ args })

/** Every kind of the game rigged with the Enforcer's mesh and clips: a worst case for A1's full roster (draw calls, mixers). */
async function rigEverything(page) {
  await page.route('**/assets/anim/manifest.json', async (route) => {
    const resp = await route.fetch()
    const j = await resp.json()
    const enf = j.figures.enforcer
    const kinds = ['recruit', 'enforcer', 'bulwark', 'marksman', 'vox', 'chem', 'recon', 'thug-club', 'thug-pistol', 'thug', 'gunman', 'heavy', 'fixer', 'bagman', 'civilian-a', 'civilian-b', 'civilian-c']
    j.figures = Object.fromEntries(kinds.map((k) => [k, enf]))
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(j) })
  })
}
async function noRigs(page) {
  await page.route('**/assets/anim/manifest.json', (r) => r.fulfill({ status: 404, body: 'no' }))
}
async function open(page) {
  await page.goto('http://localhost:5392/')
  await page.waitForFunction(() => window.__px && window.__px.models().ready, null, { timeout: 120000 })
}
async function begin(page, speed) {
  await page.evaluate((s) => window.__px.setSpeed(s), speed)
  await page.getByTestId('new-op').click()
  await page.getByTestId('hud').waitFor()
  await page.waitForFunction(() => window.__px.camera() !== null)
}
/** Fly the camera to the Enforcer (s2) at a close but readable distance. */
const focus = async (page, dist = 8, dy = 0.3) => { await page.evaluate(([d, o]) => { const u = window.__px.state().units.find((q) => q.id === 's2'); const b = window.__pxBoard; b.controller.setView({ x: u.x - b.w / 2 + 0.5, z: u.y + o - b.h / 2 + 0.5, dist: d, pol: 1.1, az: 2.5 }) }, [dist, dy]); await page.waitForTimeout(1500) }
const gl = (page) => page.evaluate(() => { const g = window.__pxGl.getContext(); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown' })

if (mode === 'media') {
  const tmp = join(out, '_video')
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: tmp, size: { width: 1280, height: 720 } } })
  const page = await ctx.newPage()
  await open(page)
  console.log('renderer:', await gl(page))
  await begin(page, 'normal')
  // zoom in on the Enforcer (s2) so the animation is legible
  const p0 = await page.evaluate(() => { const u = window.__px.state().units.find((q) => q.id === 's2'); return window.__px.tileToScreen(u.x, u.y) })
  await page.mouse.move(p0.x, p0.y)
  await focus(page)
  await page.waitForTimeout(1200)
  const marks = {}
  const t0 = Date.now()
  // 1: a shot (aim, fire)
  const att = await page.evaluate(() => window.__px.legal().find((a) => a.unit === 's2' && a.type === 'attack'))
  marks.fire = Date.now() - t0
  await page.evaluate((a) => { void window.__px.dispatch(a) }, att)
  await page.waitForFunction(() => window.__px.busy() === false, null, { timeout: 60000 })
  await page.waitForTimeout(800)
  // 2: end the turn quickly, then a walk on the next turn
  await page.evaluate(() => window.__px.setSpeed('instant'))
  await page.evaluate(() => window.__px.endTurn())
  await page.waitForFunction(() => window.__px.state().phase === 'squad' && !window.__px.busy(), null, { timeout: 120000 })
  await page.evaluate(() => window.__px.setSpeed('normal'))
  await focus(page)
  await page.waitForTimeout(500)
  const mv = await page.evaluate(() => {
    const u = window.__px.state().units.find((q) => q.id === 's2')
    const m = window.__px.legal().filter((a) => a.unit === 's2' && a.type === 'move')
    m.sort((a, b) => Math.hypot(b.to.x - u.x, b.to.y - u.y) - Math.hypot(a.to.x - u.x, a.to.y - u.y))
    return m[0]
  })
  marks.walk = Date.now() - t0
  await page.evaluate((a) => { void window.__px.dispatch(a) }, mv)
  await page.waitForFunction(() => window.__px.anim('s2') === 'walk', null, { timeout: 60000 })
  await page.waitForTimeout(350)
  await page.screenshot({ path: join(out, 'board-anim.png') })
  await page.waitForFunction(() => window.__px.busy() === false, null, { timeout: 60000 })
  await page.waitForTimeout(800)
  console.log('seen', JSON.stringify(await page.evaluate(() => window.__px.animSeen('s2'))), 'marks', JSON.stringify(marks))
  await ctx.close()
  const webm = readdirSync(tmp).find((f) => f.endsWith('.webm'))
  renameSync(join(tmp, webm), join(out, 'enforcer.webm'))
  rmSync(tmp, { recursive: true, force: true })
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(out, 'enforcer.webm'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', '-movflags', '+faststart', join(out, 'enforcer.mp4')])
  rmSync(join(out, 'enforcer.webm'))
  console.log('wrote enforcer.mp4')
} else {
  const stats = async (label, setup, opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    const page = await ctx.newPage()
    if (opts.lite) await page.addInitScript(() => localStorage.setItem('px-settings', JSON.stringify({ speed: 'instant', lite: true, mute: true, volume: 0.1 })))
    await setup(page)
    await open(page)
    await begin(page, 'instant')
    // the board in its start state: 4 troopers; make the syndicate visible by advancing a couple of rounds at Instant speed
    await page.evaluate(async () => { for (let i = 0; i < 2; i++) { await window.__px.endTurn(); while (window.__px.busy() || window.__px.state().phase !== 'squad') await new Promise((r) => setTimeout(r, 20)) } })
    await page.waitForTimeout(500)
    const res = await page.evaluate(async () => {
      const g = window.__pxGl
      const info = g.info
      let cpu = 0, n = 0
      const render = g.render.bind(g)
      g.render = (...a) => { const t = performance.now(); render(...a); cpu += performance.now() - t; n++ }
      const intervals = []
      const calls = [], tris = []
      let last = performance.now()
      const s0 = { ...window.__px.animStats() }
      const t0 = performance.now()
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => requestAnimationFrame(() => { window.__pxWake(); r() }))
        const now = performance.now()
        intervals.push(now - last)
        last = now
        calls.push(info.render.calls)
        tris.push(info.render.triangles)
      }
      const s1 = window.__px.animStats()
      g.render = render
      intervals.shift()
      intervals.sort((a, b) => a - b)
      const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)
      const squad = window.__px.state().units.filter((u) => u.side === 'squad').length
      const syn = window.__px.fog().units.filter((u) => u.side === 'syndicate').length
      return {
        frames: n, renderCpuMs: +(cpu / Math.max(1, n)).toFixed(2), frameMsAvg: +avg(intervals).toFixed(1), frameMsP95: +intervals[Math.floor(intervals.length * 0.95)].toFixed(1),
        drawCalls: Math.round(avg(calls)), triangles: Math.round(avg(tris)), geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length,
        rigged: window.__px.rigKinds().length, squad, syndicateVisible: syn,
        mixerUpdatesPerFrame: +((s1.updated - s0.updated) / Math.max(1, s1.frames - s0.frames)).toFixed(2),
        rigCpuMsPerFrame: +((s1.ms - s0.ms) / Math.max(1, s1.frames - s0.frames)).toFixed(3),
        mixerFrozenPerFrame: +((s1.skippedFrozen - s0.skippedFrozen) / Math.max(1, s1.frames - s0.frames)).toFixed(2),
        wallMsPerFrame: +((performance.now() - t0) / 90).toFixed(1),
      }
    })
    await ctx.close()
    console.log(JSON.stringify({ label, renderer: gpu ? 'gpu' : 'swiftshader', ...res }))
  }
  await stats('static figures only (no anim manifest)', noRigs)
  await stats('real manifest: Enforcer rigged, the rest static', async () => {})
  await stats('synthetic: every kind rigged (Enforcer mesh), Normal tier', rigEverything)
  await stats('synthetic: every kind rigged, Low tier (lite)', rigEverything, { lite: true })
}
await browser.close()
srv.close()
