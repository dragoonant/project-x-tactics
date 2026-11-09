// S-art Audio Studio (7890) batch. usage: node tools/strategy-art/audio.mjs <outdir> [--only id,id] [--seed N]
// Saves <outdir>/<id>_<k>.flac. Takes the shared GPU lock around the batch.
import fs from 'node:fs';
import path from 'node:path';
import { withGpu } from '../anim/gpulock.mjs';
const API = 'http://localhost:7890';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args.splice(i, 2)[1] : d; };
const onlyArg = opt('only', '');
const only = onlyArg ? onlyArg.split(',') : null;
const seed = +opt('seed', 31337);
const outDir = args[0];
fs.mkdirSync(outDir, { recursive: true });
const NEG = 'music, voices, speech, singing, noise, low quality, clipping';
const sfx = (s, p, batch = 3) => ({ mode: 'sfx', prompt: p + ', no music, no voices, no speech', negative: NEG, seconds: s, steps: 60, guidance: 6, batch, seed });
const jobs = {
  strategy: { mode: 'music', prompt: 'tense dark instrumental for a city command table, low pulsing analogue synth bass, slow deep percussion with muted toms and a soft ticking hi-hat, sparse cold synth pad, faint metallic drone, steady and ominous, no melody lead, loopable, cinematic stealth tension', lyrics: '[Instrumental]', duration: 112, steps: 8, bpm: 96, key: 'D minor', timesig: '4', batch: 2, seed },
  incident: sfx(3, 'a sharp urgent two-tone electronic alarm alert, short digital klaxon pulse followed by a low warning thud, police dispatch console'),
  week: sfx(3, 'a soft low clock-tick sweep and a deep resonant bell-like synth swell marking the passing of a week, calm and ominous'),
  takeover: sfx(4, 'a heavy menacing low drone rising with a metallic slam and a deep sub-bass hit, a gang seizing control, dark cinematic impact'),
  'district-fall': sfx(4, 'a power failing, descending electrical whine and a long deep boom with distant rumble and falling debris, dark cinematic collapse'),
  deploy: sfx(3, 'a heavy armoured vehicle ramp lowering with hydraulic hiss and metallic clank followed by a short rising turbine spool, tactical deployment'),
  'case-reveal': sfx(3, 'a paper photograph slapped onto a corkboard with a pin push, followed by a short low tense synth sting, detective evidence reveal'),
};
const t0 = Date.now();
await withGpu('S-art', async () => {
  for (const id of Object.keys(jobs)) {
    if (only && !only.includes(id)) continue;
    const r = await (await fetch(API + '/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(jobs[id]) })).json();
    if (!r.id) { console.log(id, 'submit failed', JSON.stringify(r)); continue; }
    let j;
    for (;;) { await new Promise((s) => setTimeout(s, 3000)); j = await (await fetch(`${API}/api/jobs/${r.id}`)).json(); if (['done', 'completed', 'failed', 'cancelled', 'error'].includes(j.status)) break; }
    if (!['done', 'completed'].includes(j.status)) { console.log(id, j.status, j.error); continue; }
    let k = 0;
    for (const f of j.audios || j.files || []) {
      const name = typeof f === 'string' ? f : f.name || f.file;
      if (!/\.(flac|wav|mp3)$/.test(name)) continue;
      fs.writeFileSync(path.join(outDir, `${id}_${++k}${path.extname(name)}`), Buffer.from(await (await fetch(`${API}/files/${r.id}/${name}`)).arrayBuffer()));
    }
    console.log(id, 'saved', k, 'job', r.id);
  }
});
console.log('batch seconds', Math.round((Date.now() - t0) / 1000));
