// A1 review media: 8 frames per clip, front and 3/4 views, from the figure lab (headless Chromium, software GL), then a labelled
// contact sheet per figure (docs/status/a1/<kind>.png) and the all-idle overview (docs/status/a1/all-idle.png).
// usage: node tools/anim/a1_media.mjs [--figs recruit,bulwark] [--overview]
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

const args = process.argv.slice(2)
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d }
const root = path.resolve(import.meta.dirname, '../..')
const man = JSON.parse(fs.readFileSync(path.join(root, 'public/assets/anim/manifest.json'), 'utf8'))
const figs = opt('figs', Object.keys(man.figures).join(',')).split(',')
const frames = path.join(root, 'art/rig/scratch/frames'), out = path.join(root, 'docs/status/a1')
fs.mkdirSync(frames, { recursive: true }); fs.mkdirSync(out, { recursive: true })
const port = 5392
const vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' })
const base = `http://localhost:${port}`
for (let i = 0; i < 80; i++) { try { await fetch(base + '/figure-lab.html'); break } catch { await new Promise((r) => setTimeout(r, 500)) } }
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const W = 300, H = 380
try {
  for (const fig of figs) {
    const meta = man.figures[fig]
    for (const clip of Object.keys(meta.clips)) {
      const c = meta.clips[clip]
      const dir = path.join(frames, fig, clip); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })
      for (const v of ['front', 'tq']) {
        const ctx = await browser.newContext({ viewport: { width: W, height: H } }), page = await ctx.newPage()
        await page.goto(`${base}/figure-lab.html?fig=${fig}&clip=${clip}&t=0&view=${v}&ui=0&scale=0.9&dist=2.7&bg=%23596168`)
        await page.waitForFunction(() => window.__lab && window.__lab.ready, null, { timeout: 180000 })
        for (let k = 0; k < 8; k++) {
          const t = c.loop ? (c.duration * k) / 8 : (c.duration * k) / 7
          await page.evaluate((tt) => window.__lab.setTime(tt), t)
          await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
          await page.screenshot({ path: path.join(dir, `${v}_${k}.png`) })
        }
        await ctx.close()
      }
      console.log(fig, clip, 'frames')
    }
    const r = spawnSync('python', [path.join(root, 'tools/anim/a1_sheet.py'), fig], { encoding: 'utf8' })
    console.log(fig, 'sheet', r.status, (r.stderr || '').slice(0, 200))
  }
  if (args.includes('--overview')) {
    const ctx = await browser.newContext({ viewport: { width: 1800, height: 520 } }), page = await ctx.newPage()
    await page.goto(`${base}/figure-lab.html?all=1&clip=idle&t=0.5&view=front&ui=0&scale=0.9&bg=%23596168`)
    await page.waitForFunction(() => window.__lab && window.__lab.ready, null, { timeout: 240000 })
    await page.waitForTimeout(3000)
    await page.screenshot({ path: path.join(out, 'all-idle.png') })
    await ctx.close()
    console.log('overview done')
  }
} finally { await browser.close(); vite.kill() }
