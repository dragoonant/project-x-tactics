// Concept image -> textured GLB through Hunyuan Studio (7860), one job at a time under the GPU lock. No base cut (props have no base).
// usage: node tools/terrain/hy_prop.mjs <slug>=<image path> [...] [--seed 1234] [--tex 1024]
// Writes art/terrain-spike/raw/<slug>.textured.glb and <slug>.job.json (raw outputs are gitignored).
import fs from 'node:fs'
import path from 'node:path'
import { withGpu } from './gpulock.mjs'
const API = 'http://localhost:7860'
const args = process.argv.slice(2)
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args.splice(i, 2)[1] : d }
const seed = +opt('seed', 1234), tex = +opt('tex', 1024)
const root = path.resolve(import.meta.dirname, '../..')
const out = path.join(root, 'art/terrain-spike/raw')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
for (const a of args) {
  const [slug, img] = a.split('=')
  const image = fs.readFileSync(img).toString('base64')
  await withGpu('T0-hunyuan', async () => {
    const r = await (await fetch(API + '/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'image', name: 'terrain-' + slug, image, params: { seed, steps: 50, octree: 512, faceCount: 40000, texRes: tex, cutBase: false, removeBg: true } }) })).json()
    if (!r.id) { console.log(slug, 'submit failed', JSON.stringify(r)); return }
    console.log(slug, 'job', r.id, 'seed', seed)
    let j
    for (;;) { await sleep(5000); j = await (await fetch(`${API}/api/jobs/${r.id}`)).json(); if (['completed', 'failed', 'cancelled'].includes(j.status)) break }
    if (j.status !== 'completed') { console.log(slug, j.status, j.error); return }
    for (const f of ['textured.glb', 'cutout.png']) fs.writeFileSync(path.join(out, `${slug}.${f}`), Buffer.from(await (await fetch(`${API}/api/jobs/${r.id}/files/${f}`)).arrayBuffer()))
    fs.writeFileSync(path.join(out, `${slug}.job.json`), JSON.stringify({ id: r.id, seed, tex, img, secs: (j.finishedAt - j.startedAt) / 1000 }))
    console.log(slug, 'done', ((j.finishedAt - j.startedAt) / 1000).toFixed(0) + 's')
  })
}
