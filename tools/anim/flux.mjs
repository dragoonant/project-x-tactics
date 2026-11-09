// Flux Studio (7880) image-edit helper.
// usage: node tools/assets/flux.mjs <slug> <base image> <prompt-file> [--n 4] [--seed 100]
// Saves art/anim-spike/concepts/<slug>/cand_<k>.png (k continues from existing files) and appends to cand_log.jsonl.
import fs from 'node:fs';
import path from 'node:path';
const API = 'http://localhost:7880';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args.splice(i, 2)[1] : d; };
const n = +opt('n', 4), seed = +opt('seed', Math.floor(Math.random() * 1e9));
const [slug, base, promptFile] = args;
const root = path.resolve(import.meta.dirname, '../..');
const dir = path.join(root, 'art/anim-spike/concepts', slug);
fs.mkdirSync(dir, { recursive: true });
const prompt = fs.readFileSync(promptFile, 'utf8').trim();
const ext = path.extname(base).slice(1).replace('jpg', 'jpeg');
const data = `data:image/${ext};base64,` + fs.readFileSync(base).toString('base64');
const r = await (await fetch(API + '/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'klein', mode: 'edit', prompt, images: [data], aspect: '4:3', megapixels: 1, batch: n, seed }) })).json();
if (!r.id) { console.log('submit failed', JSON.stringify(r)); process.exit(1); }
let j;
for (;;) { await new Promise((s) => setTimeout(s, 3000)); j = await (await fetch(`${API}/api/jobs/${r.id}`)).json(); if (['done', 'completed', 'failed', 'cancelled', 'error'].includes(j.status)) break; }
if (!['done', 'completed'].includes(j.status)) { console.log(slug, j.status, j.error); process.exit(1); }
let k = fs.readdirSync(dir).filter((f) => /^cand_\d+\.png$/.test(f)).length;
for (const im of j.images) {
  const b = Buffer.from(await (await fetch(`${API}/files/${r.id}/${im}`)).arrayBuffer());
  fs.writeFileSync(path.join(dir, `cand_${++k}.png`), b);
}
fs.appendFileSync(path.join(dir, 'cand_log.jsonl'), JSON.stringify({ job: r.id, seed, base, prompt, n: j.images.length, upto: k }) + '\n');
console.log(slug, 'saved', j.images.length, 'upto cand_' + k, 'seed', seed);
