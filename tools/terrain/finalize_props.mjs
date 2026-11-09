// Raw Hunyuan GLB -> public/assets/terrain/props/<slug>.glb (decimate <= 6k tris, tile units, matte, meshopt + WebP) and a preview sheet.
// usage: node tools/terrain/finalize_props.mjs <slug>:<foot|height>:<target tiles> [...]
//   e.g. node tools/terrain/finalize_props.mjs market-stall:foot:0.92 dumpster:foot:0.92 street-lamp:height:2.4
// gltf-transform runs from a scratch folder outside the repo (npx there, not here).
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '../..')
const py = path.join(os.homedir(), 'Hunyuan3D-2.1', '.venv', 'Scripts', 'python.exe')
const hy = path.join(os.homedir(), 'Hunyuan3D-2')
// the gltf-transform CLI comes from the local npx cache (no download); `npx` is only the fallback
function gltfCli() {
  const base = path.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx')
  try { for (const d of fs.readdirSync(base)) { const c = path.join(base, d, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js'); if (fs.existsSync(c)) return [process.execPath, c] } } catch { /* no cache */ }
  return ['npx', '--yes', '@gltf-transform/cli']
}
const GT = gltfCli()
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'px-terrain-'))
for (const spec of process.argv.slice(2)) {
  const [slug, fit, target, tris = '6000'] = spec.split(':')
  const raw = path.join(root, 'art/terrain/raw', `${slug}.textured.glb`)
  const fin = path.join(scratch, `${slug}.in.glb`)
  const opt = path.join(scratch, `${slug}.out.glb`)
  const dst = path.join(root, 'public/assets/terrain/props', `${slug}.glb`)
  let r = spawnSync(py, [path.join(import.meta.dirname, 'finalize_prop.py'), raw, fin, '--fit', fit, '--target', target, '--tris', tris], { encoding: 'utf8' })
  console.log(slug, 'finalize', r.status, (r.stdout || '').trim().split('\n').filter((l) => l.includes('tris')).pop())
  if (r.status) { console.log(r.stderr.slice(-400)); continue }
  r = spawnSync(GT[0], [...GT.slice(1), 'optimize', fin, opt, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '1024'], { cwd: scratch, encoding: 'utf8', shell: GT[0] === 'npx' })
  console.log(slug, 'optimize', r.status, (r.stdout + r.stderr).trim().split('\n').pop())
  if (r.status) continue
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(opt, dst)
  // preview sheet (front 3/4, side, back) from the finalized, un-compressed GLB, using the figures' renderer
  const tmp = path.join(hy, `_prevT0_${slug}.glb`)
  fs.copyFileSync(fin, tmp)
  r = spawnSync(py, [path.join(hy, 'render_views.py'), tmp], { cwd: hy, encoding: 'utf8' })
  const sheet = tmp.replace('.glb', '_sheet.png')
  if (fs.existsSync(sheet)) { fs.mkdirSync(path.join(root, 'art/terrain/previews'), { recursive: true }); fs.copyFileSync(sheet, path.join(root, 'art/terrain/previews', `${slug}.png`)) }
  for (const f of fs.readdirSync(hy).filter((n) => n.startsWith(`_prevT0_${slug}`))) fs.rmSync(path.join(hy, f))
  console.log(slug, '->', dst, (fs.statSync(dst).size / 1024).toFixed(0) + ' KB')
}
fs.rmSync(scratch, { recursive: true, force: true })
