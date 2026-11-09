// A1: Hunyuan Studio (7860) queue for the re-posed bodies and the items. One job at a time, GPU lock per job.
// usage: node tools/anim/rig_hy.mjs body:<kind>=<image> item:<id>=<image> ... [--seed 1234] [--tex 1024]
// Output: art/rig/raw/<kind>.textured.glb (+ .cutout.png, .job.json). Bodies are then scaled with tools/assets/finalize_model.py
// (feet at y = 0, front +Z) into art/rig/raw/<kind>.body.glb. Items are finalised by tools/anim/item_prep.py.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { withGpu } from './gpulock.mjs';

const API = 'http://localhost:7860';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args.splice(i, 2)[1] : d; };
const adopt = {};   // --adopt slug=jobid : take over a job already submitted to the studio
while (args.includes('--adopt')) { const [s, id] = args.splice(args.indexOf('--adopt'), 2)[1].split('='); adopt[s] = id; }
const seed = +opt('seed', 1234), tex = +opt('tex', 1024);
const root = path.resolve(import.meta.dirname, '../..');
const out = path.join(root, 'art/rig/raw');
fs.mkdirSync(out, { recursive: true });
const heights = { 'civilian-a': 1.7, 'civilian-b': 1.7, 'civilian-c': 1.7 };
const py = path.join(process.env.USERPROFILE, 'Hunyuan3D-2.1/.venv/Scripts/python.exe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const a of args) {
  if (a.startsWith('skel:')) {   // UniRig skeleton stage only, for bodies that already exist, under the lock
    const ks = a.slice(5).split(',');
    await withGpu('A1-unirig', async () => {
      const u = spawnSync('powershell', ['-NoProfile', '-File', path.join(root, 'tools/anim/unirig_skel.ps1'), '-NoLock', ...ks], { encoding: 'utf8' });
      console.log(ks.join(','), 'unirig', u.status, (u.stdout || '').trim().split('\n').slice(-2).join(' | '));
    });
    continue;
  }
  const m = a.match(/^(body|item):([^=]+)=(.+)$/);
  if (!m) { console.log('bad arg', a); continue; }
  const [, type, slug, img] = m;
  const isBody = type === 'body';
  if (fs.existsSync(path.join(out, `${slug}.textured.glb`)) && !process.env.REDO) { console.log(slug, 'exists, skipped'); continue; }
  const image = fs.readFileSync(path.join(root, img)).toString('base64');
  const params = isBody
    ? { seed, steps: 50, octree: 512, faceCount: 19000, texRes: tex, cutBase: true, removeBg: true }   // coordinator budget: <= 20k triangles per body
    : { seed, steps: 30, octree: 320, faceCount: 2900, texRes: 1024, cutBase: false, removeBg: true };  // items <= 3k
  await withGpu('A1-hunyuan', async () => {
    const adopted = adopt[slug];
    const r = adopted ? { id: adopted } : await (await fetch(API + '/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'image', name: 'a1-' + slug, image, params }) })).json();
    if (!r.id) { console.log(slug, 'submit failed', JSON.stringify(r)); return; }
    console.log(slug, 'job', r.id);
    let j;
    for (;;) { await sleep(5000); j = await (await fetch(`${API}/api/jobs/${r.id}`)).json(); if (['completed', 'failed', 'cancelled'].includes(j.status)) break; }
    if (j.status !== 'completed') { console.log(slug, j.status, j.error); return; }
    for (const f of ['textured.glb', 'cutout.png']) fs.writeFileSync(path.join(out, `${slug}.${f}`), Buffer.from(await (await fetch(`${API}/api/jobs/${r.id}/files/${f}`)).arrayBuffer()));
    const secs = (j.finishedAt - j.startedAt) / 1000;
    fs.writeFileSync(path.join(out, `${slug}.job.json`), JSON.stringify({ id: r.id, seed, tex, img, secs }));
    console.log(slug, 'done', secs.toFixed(0) + 's');
    if (isBody) {   // finalise and predict the skeleton while this process still holds the GPU lock (UniRig skeleton stage only)
      const f = spawnSync(py, [path.join(root, 'tools/assets/finalize_model.py'), path.join(out, `${slug}.textured.glb`), path.join(out, `${slug}.body.glb`), '--height', String(heights[slug] || 1.8)], { encoding: 'utf8' });
      console.log(slug, 'finalize', f.status);
      const u = spawnSync('powershell', ['-NoProfile', '-File', path.join(root, 'tools/anim/unirig_skel.ps1'), '-NoLock', slug], { encoding: 'utf8' });
      console.log(slug, 'unirig', u.status, (u.stdout || '').trim().split('\n').pop());
    }
  });
}
