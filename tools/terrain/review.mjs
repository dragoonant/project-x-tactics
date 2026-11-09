// T1 review screenshots into docs/status/t1/ (headless SwiftShader; run against a dev server or `vite preview`).
// usage: node tools/terrain/review.mjs <base url, e.g. http://localhost:5295> [which ...]
//   which: overview market bar-front dark-alley overlays phone before-after perf (default: all)
// Same seed (1) everywhere. before-after = ?terrain=v1 beside the default, same camera, composed with PIL by compose_before_after.py.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '../..')
const [base, ...rest] = process.argv.slice(2)
const out = path.join(root, 'docs/status/t1')
fs.mkdirSync(out, { recursive: true })
const want = (n) => !rest.length || rest.includes(n)
const shot = (name, query, ...extra) => {
  const r = spawnSync(process.execPath, [path.join(import.meta.dirname, 'shot.mjs'), `${base}/${query}`, path.join(out, name), ...extra], { encoding: 'utf8' })
  console.log(name, r.status, (r.stdout + r.stderr).split('\n').filter((l) => l && !/Clock/.test(l)).join(' | ').slice(0, 300))
}
if (want('overview')) shot('overview.png', '', '--select', 'none')
if (want('market')) shot('market.png', '', '--cam', '-1,3,0.25,0.95,10', '--select', 'none')
if (want('bar-front')) shot('bar-front.png', '', '--bare', '--cam', '1.5,-1.5,0.2,0.85,9')
if (want('dark-alley')) shot('dark-alley.png', '', '--cam', '-7,2,0.6,0.95,13', '--select', 'none')
if (want('overlays')) shot('overlays.png', '', '--cam', '-0.5,4,0.2,0.95,12', '--select', 's2', '--hover', '9,15')
if (want('phone')) { shot('phone.png', '', '--w', '390', '--h', '844', '--select', 'none'); shot('phone-close.png', '', '--w', '390', '--h', '844', '--cam', '-1,3,0.25,0.5,9', '--select', 'none') }
if (want('destroyed')) { const r = spawnSync(process.execPath, [path.join(import.meta.dirname, 'destroyed.mjs'), base, path.join(out, 'destroyed.png')], { encoding: 'utf8' }); console.log('destroyed', r.status, r.stdout.trim()) }
if (want('before-after')) {
  const cam = ['--cam', '-1.5,-0.5,0.35,0.95,12', '--select', 'none']
  shot('_before.png', '?terrain=v1', ...cam)
  shot('_after.png', '', ...cam)
  const py = path.join(os.homedir(), 'Hunyuan3D-2.1', '.venv', 'Scripts', 'python.exe')
  const r = spawnSync(py, [path.join(import.meta.dirname, 'compose_before_after.py'), path.join(out, '_before.png'), path.join(out, '_after.png'), path.join(out, 'before-after.png')], { encoding: 'utf8' })
  console.log('before-after', r.status, r.stderr.slice(-200))
  fs.rmSync(path.join(out, '_before.png'), { force: true }); fs.rmSync(path.join(out, '_after.png'), { force: true })
}
if (want('perf')) {
  const rows = []
  for (const [label, q] of [['v1', '?terrain=v1'], ['v2', '']]) for (const [dev, wh] of [['desktop', ['--w', '1440', '--h', '900']], ['phone', ['--w', '390', '--h', '844']]]) {
    const f = path.join(os.tmpdir(), `px-perf-${label}-${dev}.json`)
    const r = spawnSync(process.execPath, [path.join(import.meta.dirname, 'shot.mjs'), `${base}/${q}`, path.join(os.tmpdir(), 'px-perf.png'), ...wh, '--select', 'none', '--stats', f], { encoding: 'utf8' })
    try { rows.push({ label, dev, ...JSON.parse(fs.readFileSync(f, 'utf8')) }) } catch { console.log('perf failed', label, dev, r.stderr.slice(-200)) }
  }
  fs.writeFileSync(path.join(out, 'perf.json'), JSON.stringify(rows, null, 2))
  console.log(rows.map((r) => `${r.label} ${r.dev}: ${r.calls} calls ${r.triangles} tris ${r.textures} tex ${r.msPerFrame} ms`).join('\n'))
}
