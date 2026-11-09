// Deterministic review media for the figure lab: steps ?t= at 30 fps with Playwright (headless Chromium, software GL),
// then ffmpeg -> MP4 per rig x clip (front | 3/4 | side side by side). Frames go to art/anim-spike/scratch/frames (git-ignored).
// usage: node tools/anim/render-media.mjs [--rigs a,b] [--clips idle,walk,aim,fire,hit]
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

const args = process.argv.slice(2)
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d }
const rigs = opt('rigs', 'a,b').split(','), clips = opt('clips', 'idle,walk,aim,fire,hit').split(',')
const root = path.resolve(import.meta.dirname, '../..')
const framesDir = path.join(root, 'art/anim-spike/scratch/frames'), outDir = path.join(root, 'docs/status/a0')
fs.mkdirSync(framesDir, { recursive: true }); fs.mkdirSync(outDir, { recursive: true })
const sockets = JSON.parse(fs.readFileSync(path.join(root, 'public/assets/anim/sockets.json'), 'utf8'))
const port = 5391
const vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' })
const base = `http://localhost:${port}`
for (let i = 0; i < 60; i++) { try { await fetch(base + '/figure-lab.html'); break } catch { await new Promise((r) => setTimeout(r, 500)) } }
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const W = 420, H = 520
const views = ['front', 'tq', 'side']
try {
  for (const rig of rigs) for (const clip of clips) {
    const cm = sockets.rigs[rig].clips[clip], dur = cm.duration, n = Math.round(dur * 30) + (cm.loop ? 0 : 1)
    const dir = path.join(framesDir, rig, clip); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })
    const pages = []
    for (const v of views) {
      const ctx = await browser.newContext({ viewport: { width: W, height: H } }), page = await ctx.newPage()
      await page.goto(`${base}/figure-lab.html?rig=${rig}&clip=${clip}&t=0&view=${v}&ui=0&scale=1`)
      await page.waitForFunction(() => window.__lab && window.__lab.ready, null, { timeout: 120000 })
      pages.push(page)
    }
    for (let k = 0; k < n; k++) {
      for (let vi = 0; vi < views.length; vi++) {
        const page = pages[vi]
        await page.evaluate((t) => window.__lab.setTime(t), k / 30)
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
        await page.screenshot({ path: path.join(dir, `${views[vi]}_${String(k).padStart(3, '0')}.png`) })
      }
    }
    for (const p of pages) await p.context().close()
    const loops = Math.max(1, Math.ceil(3 / dur)) - 1
    const mp4 = path.join(outDir, `${rig}-${clip}.mp4`)
    const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-stream_loop', String(loops), '-framerate', '30', '-i', path.join(dir, 'front_%03d.png'),
      '-stream_loop', String(loops), '-framerate', '30', '-i', path.join(dir, 'tq_%03d.png'), '-stream_loop', String(loops), '-framerate', '30', '-i', path.join(dir, 'side_%03d.png'),
      '-filter_complex', 'hstack=inputs=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', mp4], { encoding: 'utf8' })
    console.log(rig, clip, n, 'frames', r.status, r.stderr.slice(0, 200), path.basename(mp4))
  }
} finally { await browser.close(); vite.kill() }
