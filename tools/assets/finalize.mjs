// Finalize raw Hunyuan GLBs: scale to inches, matte, plain black plate, front +Z (runs finalize_model.py in the 2.1 venv, which has bpy),
// then renders a preview sheet. usage: node tools/assets/finalize.mjs <slug> [--height 1.8] [--base 32] [--yaw 0]
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args.splice(i, 2)[1] : d; };
const height = opt('height', '1.8'), base = opt('base', '32'), yaw = opt('yaw', '0');
const root = path.resolve(import.meta.dirname, '../..');
const hy = path.join(os.homedir(), 'Hunyuan3D-2');
const py = path.join(os.homedir(), 'Hunyuan3D-2.1', '.venv', 'Scripts', 'python.exe');
for (const slug of args) {
  const src = path.join(root, 'art/raw', `${slug}.textured.glb`), dst = path.join(root, 'public/assets/models', `${slug}.glb`);
  let r = spawnSync(py, [path.join(import.meta.dirname, 'finalize_model.py'), src, dst, '--height', height, '--yaw', yaw], { cwd: hy, encoding: 'utf8' });
  console.log(slug, r.status, (r.stdout || '').trim().split('\n').pop(), (r.stderr || '').slice(-200));
  if (r.status) continue;
  const tmp = path.join(hy, `_prev_${slug}.glb`); fs.copyFileSync(dst, tmp);
  r = spawnSync(py, [path.join(hy, 'render_views.py'), tmp], { cwd: hy, encoding: 'utf8' });
  const sheet = tmp.replace('.glb', '_sheet.png');
  const guess = [sheet, path.join(hy, `_prev_${slug}_sheet.png`)].find((p) => fs.existsSync(p));
  console.log(slug, 'render', r.status, guess || (r.stdout + r.stderr).slice(-300));
  if (guess) fs.copyFileSync(guess, path.join(root, 'art/previews', `${slug}.png`));
}
