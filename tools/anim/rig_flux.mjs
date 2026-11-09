// A1: Flux klein image edits for the re-pose (bodies) and the held items.
// usage: node tools/anim/rig_flux.mjs pose|items <id>[,<id>...] [--n 4] [--seed 500]
// Writes art/rig/<kind>/cand_N.png (pose) or art/rig/items/<id>/cand_N.png (items). Takes the GPU lock for the whole batch.
import fs from 'node:fs';
import path from 'node:path';
import { withGpu } from './gpulock.mjs';

const API = 'http://localhost:7880';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args.splice(i, 2)[1] : d; };
const n = +opt('n', 4), seed0 = +opt('seed', 500);
const [mode, idsArg] = args;
const root = path.resolve(import.meta.dirname, '../..');
const P = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'rig_prompts.json'), 'utf8'))[mode];
const ids = idsArg === 'all' ? Object.keys(mode === 'pose' ? P.kinds : P.items) : idsArg.split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (u, b) => fetch(API + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

await withGpu('A1-flux', async () => {
  await post('/api/settings', { freeAfter: false });
  try {
    for (const id of ids) {
      const spec = (mode === 'pose' ? P.kinds : P.items)[id];
      let prompt = P.template;
      for (const [k, v] of Object.entries(spec)) prompt = prompt.replaceAll('{' + k + '}', v);
      const dir = path.join(root, 'art/rig', mode === 'pose' ? id : path.join('items', id));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'prompt.txt'), prompt + '\n');
      const base = path.join(root, spec.base);
      const ext = path.extname(base).slice(1).replace('jpg', 'jpeg');
      const data = `data:image/${ext};base64,` + fs.readFileSync(base).toString('base64');
      const seed = seed0 + [...id].reduce((a, c) => a + c.charCodeAt(0), 0);
      const r = await (await post('/api/jobs', { model: 'klein', mode: 'edit', prompt, images: [data], aspect: '4:3', megapixels: 1, batch: n, seed })).json();
      if (!r.id) { console.log(id, 'submit failed', JSON.stringify(r)); continue; }
      let j;
      for (;;) { await sleep(3000); j = await (await fetch(`${API}/api/jobs/${r.id}`)).json(); if (['done', 'completed', 'failed', 'cancelled', 'error'].includes(j.status)) break; }
      if (!['done', 'completed'].includes(j.status)) { console.log(id, j.status, j.error); continue; }
      let k = fs.readdirSync(dir).filter((f) => /^cand_\d+\.png$/.test(f)).length;
      for (const im of j.images) fs.writeFileSync(path.join(dir, `cand_${++k}.png`), Buffer.from(await (await fetch(`${API}/files/${r.id}/${im}`)).arrayBuffer()));
      fs.appendFileSync(path.join(dir, 'cand_log.jsonl'), JSON.stringify({ job: r.id, seed, base: spec.base, n: j.images.length, upto: k }) + '\n');
      console.log(id, 'saved', j.images.length, 'upto cand_' + k, 'seed', seed);
    }
  } finally { await post('/api/settings', { freeAfter: true }); }
});
