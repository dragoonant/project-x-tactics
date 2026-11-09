// Audio Studio (7890) batch helper. usage: node tools/assets/audio.mjs sfx|music [id ...] [--seed N]
// Writes art/raw/audio/<id>_<k>.flac (2 variants each).
import fs from 'node:fs';
import path from 'node:path';
const API = 'http://localhost:7890';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args.splice(i, 2)[1] : d; };
const seed = +opt('seed', 777);
const kind = args.shift();
const root = path.resolve(import.meta.dirname, '../..');
const jobs = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'audio-jobs.json'), 'utf8'))[kind];
const out = path.join(root, 'art/raw/audio'); fs.mkdirSync(out, { recursive: true });
for (const id of args.length ? args : Object.keys(jobs)) {
  const e = jobs[id];
  const body = kind === 'sfx'
    ? { mode: 'sfx', prompt: e.p, negative: 'music, voices, speech, singing, noise, low quality', seconds: e.s, steps: 60, guidance: 6, batch: 2, seed }
    : { mode: 'music', prompt: e.p, lyrics: '[Instrumental]', duration: e.d, steps: 8, bpm: e.bpm, key: 'D minor', timesig: '4', batch: 2, seed };
  const r = await (await fetch(API + '/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  if (!r.id) { console.log(id, 'submit failed', JSON.stringify(r)); continue; }
  let j; for (;;) { await new Promise((s) => setTimeout(s, 3000)); j = await (await fetch(`${API}/api/jobs/${r.id}`)).json(); if (['done', 'completed', 'failed', 'cancelled', 'error'].includes(j.status)) break; }
  if (!['done', 'completed'].includes(j.status)) { console.log(id, j.status, j.error); continue; }
  const files = j.audios || j.files || [];
  let k = 0;
  for (const f of files) { const name = typeof f === 'string' ? f : f.name || f.file; if (!/\.(flac|wav|mp3)$/.test(name)) continue;
    fs.writeFileSync(path.join(out, `${id}_${++k}${path.extname(name)}`), Buffer.from(await (await fetch(`${API}/files/${r.id}/${name}`)).arrayBuffer())); }
  console.log(id, 'saved', k, 'seed', seed, 'job', r.id);
}
