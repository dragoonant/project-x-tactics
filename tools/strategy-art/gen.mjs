// S-art Flux batch. usage: node tools/strategy-art/gen.mjs <jobs.json> <outdir> [--only id,id] [--n 4]
// jobs.json: { id: {prompt, aspect, seed?} }. Saves <outdir>/<id>_<k>.png. Takes the shared GPU lock around the batch.
import fs from 'node:fs';
import path from 'node:path';
import { withGpu } from '../anim/gpulock.mjs';
const API = 'http://localhost:7880';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args.splice(i, 2)[1] : d; };
const onlyArg = opt('only', '');
const only = onlyArg ? onlyArg.split(',') : null;
const n = +opt('n', 4);
const [jobsFile, outDir] = args;
const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
const t0 = Date.now();
const post = (p, b) => fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
await withGpu('S-art', async () => {
  await post('/api/settings', { freeAfter: false });
  for (const id of Object.keys(jobs)) {
    if (only && !only.includes(id)) continue;
    const e = jobs[id];
    const r = await (await post('/api/jobs', { model: 'klein', prompt: e.prompt, aspect: e.aspect, megapixels: 1, batch: n, seed: e.seed ?? 4242 })).json();
    if (!r.id) { console.log(id, 'submit failed', JSON.stringify(r)); continue; }
    let j;
    for (;;) { await new Promise((s) => setTimeout(s, 3000)); j = await (await fetch(`${API}/api/jobs/${r.id}`)).json(); if (['done', 'completed', 'failed', 'cancelled', 'error'].includes(j.status)) break; }
    if (!['done', 'completed'].includes(j.status)) { console.log(id, j.status, j.error); continue; }
    let k = 0;
    for (const im of j.images) fs.writeFileSync(path.join(outDir, `${id}_${++k}.png`), Buffer.from(await (await fetch(`${API}/files/${r.id}/${im}`)).arrayBuffer()));
    console.log(id, 'saved', k);
  }
  await post('/api/settings', { freeAfter: true });
});
console.log('batch seconds', Math.round((Date.now() - t0) / 1000));
