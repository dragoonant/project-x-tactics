// Re-simplify already finished prop GLBs (T0 props whose raw Hunyuan output is not in the repo): gltf-transform simplify, then meshopt.
// usage: node tools/terrain/simplify_props.mjs <slug>:<ratio> [...]   (e.g. market-stall:0.66). Uses the local npx cache, no download.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '../..')
const base = path.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx')
let cli = null
try { for (const d of fs.readdirSync(base)) { const c = path.join(base, d, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js'); if (fs.existsSync(c)) { cli = c; break } } } catch { /* none */ }
if (!cli) { console.log('gltf-transform CLI not in the local npx cache'); process.exit(1) }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'px-simp-'))
const run = (...a) => { const r = spawnSync(process.execPath, [cli, ...a], { encoding: 'utf8' }); if (r.status) console.log((r.stdout + r.stderr).slice(-500)); return r.status === 0 }
for (const spec of process.argv.slice(2)) {
  const [slug, ratio] = spec.split(':')
  const f = path.join(root, 'public/assets/terrain/props', `${slug}.glb`)
  const a = path.join(tmp, `${slug}.a.glb`), b = path.join(tmp, `${slug}.b.glb`)
  if (run('simplify', f, a, '--ratio', ratio, '--error', '0.02') && run('meshopt', a, b, '--level', 'medium')) {
    const before = fs.statSync(f).size
    fs.copyFileSync(b, f)
    console.log(slug, 'ratio', ratio, `${(before / 1024).toFixed(0)} KB -> ${(fs.statSync(f).size / 1024).toFixed(0)} KB`)
  }
}
fs.rmSync(tmp, { recursive: true, force: true })
