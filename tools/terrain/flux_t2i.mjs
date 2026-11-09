// Flux Studio (7880) text-to-image batch, under the GPU lock.
// usage: node tools/terrain/flux_t2i.mjs <outdir> <prefix> <prompt-file> [--n 4] [--seed 100] [--aspect 1:1] [--mp 1] [--model klein]
// Saves <outdir>/<prefix>_<k>.png (k continues from existing files) and appends to <outdir>/log.jsonl.
import fs from 'node:fs'
import path from 'node:path'
import { withGpu } from './gpulock.mjs'
const API = 'http://localhost:7880'
const args = process.argv.slice(2)
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args.splice(i, 2)[1] : d }
const n = +opt('n', 4), seed = +opt('seed', Math.floor(Math.random() * 1e9)), aspect = opt('aspect', '1:1'), mp = +opt('mp', 1), model = opt('model', 'klein')
const [outdir, prefix, promptFile] = args
fs.mkdirSync(outdir, { recursive: true })
const prompt = fs.readFileSync(promptFile, 'utf8').trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await withGpu('T0-flux', async () => {
  const t0 = Date.now()
  const r = await (await fetch(API + '/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt, aspect, megapixels: mp, batch: n, seed }) })).json()
  if (!r.id) { console.log('submit failed', JSON.stringify(r)); process.exit(1) }
  let j
  for (;;) { await sleep(3000); j = await (await fetch(`${API}/api/jobs/${r.id}`)).json(); if (['done', 'completed', 'failed', 'cancelled', 'error'].includes(j.status)) break }
  if (!['done', 'completed'].includes(j.status)) { console.log(prefix, j.status, j.error); process.exit(1) }
  let k = fs.readdirSync(outdir).filter((f) => f.startsWith(prefix + '_') && f.endsWith('.png')).length
  for (const im of j.images) fs.writeFileSync(path.join(outdir, `${prefix}_${++k}.png`), Buffer.from(await (await fetch(`${API}/files/${r.id}/${im}`)).arrayBuffer()))
  const secs = (Date.now() - t0) / 1000
  fs.appendFileSync(path.join(outdir, 'log.jsonl'), JSON.stringify({ job: r.id, prefix, seed, aspect, mp, model, prompt, n: j.images.length, upto: k, secs }) + '\n')
  console.log(prefix, 'saved', j.images.length, 'upto', k, 'seed', seed, secs.toFixed(0) + 's')
})
