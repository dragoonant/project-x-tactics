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

// UniRig SKELETON stage only (never the skinning stage, never torch.load with weights_only=False). Caller holds the GPU lock.
function unirig(kinds) {
  const ur = path.join(process.env.USERPROFILE, 'UniRig'), upy = path.join(ur, '.venv/Scripts/python.exe');
  const inD = path.join(ur, 'a1/in'), outD = path.join(ur, 'a1/out');
  fs.rmSync(inD, { recursive: true, force: true }); fs.rmSync(outD, { recursive: true, force: true });
  fs.mkdirSync(inD, { recursive: true }); fs.mkdirSync(outD, { recursive: true });
  for (const k of kinds) fs.copyFileSync(path.join(out, `${k}.body.glb`), path.join(inD, `${k}.glb`));
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };
  const a = spawnSync(upy, ['-m', 'src.data.extract', '--config=configs/data/quick_inference.yaml', '--require_suffix=glb', '--force_override=true', '--num_runs=1', '--id=0', '--time=a1', '--faces_target_count=50000', '--input_dir=a1/in', '--output_dir=tmp'], { cwd: ur, env, encoding: 'utf8' });
  const b = spawnSync(upy, ['run.py', '--task=configs/task/quick_inference_skeleton_articulationxl_ar_256.yaml', '--seed=12345', '--input_dir=a1/in', '--output_dir=a1/out', '--npz_dir=tmp'], { cwd: ur, env, encoding: 'utf8' });
  fs.writeFileSync(path.join(out, 'unirig.log'), `extract ${a.status}\n${(a.stdout || '').slice(-1500)}\n${(a.stderr || '').slice(-1500)}\nrun ${b.status}\n${(b.stdout || '').slice(-1500)}\n${(b.stderr || '').slice(-2500)}\n`);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const fbx = walk(outD).filter((f) => f.endsWith('.fbx'));
  let n = 0;
  for (const k of kinds) { const f = fbx.find((x) => x.includes(`${path.sep}${k}${path.sep}`) || path.basename(x).startsWith(k)); if (f) { fs.copyFileSync(f, path.join(out, `${k}.skel.fbx`)); n++; } }
  return { status: b.status, stdout: `skeletons ${n}/${kinds.length}` };
}

for (const a of args) {
  if (a.startsWith('skel:')) {   // UniRig skeleton stage only, for bodies that already exist, under the lock
    const ks = a.slice(5).split(',');
    await withGpu('A1-unirig', async () => {
      const u = unirig(ks);
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
      const u = unirig([slug]);
      console.log(slug, 'unirig', u.status, (u.stdout || '').trim().split('\n').pop());
    }
  });
}
