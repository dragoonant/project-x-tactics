// Flux concept batch for the T1 props: one GPU lock for the whole batch. usage: node tools/terrain/concept_batch.mjs [slug ...]
// Reads tools/terrain/props_t1.json (slug -> object line), writes art/terrain/concepts/<slug>_<k>.png (4 candidates, seed 5200).
import fs from 'node:fs'
import path from 'node:path'
import { withGpu } from './gpulock.mjs'
const API = 'http://localhost:7880'
const root = path.resolve(import.meta.dirname, '../..')
const cfg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'props_t1.json'), 'utf8'))
const only = process.argv.slice(2)
const slugs = Object.keys(cfg.props).filter((s) => !only.length || only.includes(s))
const out = path.join(root, 'art/terrain/concepts')
fs.mkdirSync(out, { recursive: true })
fs.mkdirSync(path.join(root, 'art/terrain/prompts'), { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await withGpu('T1-flux', async () => {
  for (const slug of slugs) {
    const prompt = `${cfg.props[slug].concept}. ${cfg.style}`
    fs.writeFileSync(path.join(root, 'art/terrain/prompts', `${slug}.txt`), prompt + '\n')
    const t0 = Date.now()
    const r = await (await fetch(API + '/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'klein', prompt, aspect: '1:1', megapixels: 1, batch: 4, seed: 5200 }) })).json()
    if (!r.id) { console.log(slug, 'submit failed', JSON.stringify(r)); continue }
    let j
    for (;;) { await sleep(3000); j = await (await fetch(`${API}/api/jobs/${r.id}`)).json(); if (['done', 'completed', 'failed', 'cancelled', 'error'].includes(j.status)) break }
    if (!['done', 'completed'].includes(j.status)) { console.log(slug, j.status, j.error); continue }
    let k = 0
    for (const im of j.images) fs.writeFileSync(path.join(out, `${slug}_${++k}.png`), Buffer.from(await (await fetch(`${API}/files/${r.id}/${im}`)).arrayBuffer()))
    console.log(slug, 'saved', k, ((Date.now() - t0) / 1000).toFixed(0) + 's')
  }
})
