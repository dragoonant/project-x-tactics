// Post-build step for the claude.ai Artifact: the Artifact host serves .json but not .glb, so every GLB in
// dist/assets/models is rewritten as a self-contained JSON glTF (`<slug>.gltf.json`, binary chunk embedded as a
// data URI) and dist/assets/models/manifest.json is pointed at those files. GLTFLoader reads JSON glTF from any URL.
// The repo and local dev keep the .glb files; only dist/ changes. Usage: npm run build:artifact
import { readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { glbToJson } from './gltf-json.mjs'

const dir = join(process.cwd(), 'dist', 'assets', 'models')
const files = readdirSync(dir).filter((f) => f.endsWith('.glb'))

function packDir(d) {
  const names = readdirSync(d).filter((f) => f.endsWith('.glb'))
  const map = {}
  for (const f of names) {
    const out = f.replace(/\.glb$/, '.gltf.json')
    writeFileSync(join(d, out), glbToJson(readFileSync(join(d, f))))
    rmSync(join(d, f))
    map[f] = out
  }
  return map
}

const map = packDir(dir)
const manPath = join(dir, 'manifest.json')
const man = JSON.parse(readFileSync(manPath, 'utf8'))
for (const v of Object.values(man)) if (v && typeof v === 'object' && map[v.file]) v.file = map[v.file]
writeFileSync(manPath, JSON.stringify(man, null, 2))
console.log(`pack-artifact: ${files.length} GLB -> .gltf.json`)

// Terrain v2 (spike T0, `?terrain=v2`): prop GLBs become .gltf.json like the figures, and the manifest is repointed. The textures are
// inlined into the manifest as data URIs (one request, nothing for the host to refuse) and dist/assets/terrain/textures is removed.
const tdir = join(process.cwd(), 'dist', 'assets', 'terrain')
if (existsSync(join(tdir, 'manifest.json'))) {
  const pmap = existsSync(join(tdir, 'props')) ? packDir(join(tdir, 'props')) : {}
  const tpath = join(tdir, 'manifest.json')
  const tm = JSON.parse(readFileSync(tpath, 'utf8'))
  for (const p of Object.values(tm.props ?? {})) {
    const base = String(p.file).replace(/^props\//, '')
    if (pmap[base]) p.file = 'props/' + pmap[base]
  }
  let inlined = 0
  for (const t of Object.values(tm.textures ?? {})) {
    for (const k of ['color', 'normal', 'rough']) {
      if (typeof t[k] === 'string' && !t[k].startsWith('data:')) {
        t[k] = 'data:image/webp;base64,' + readFileSync(join(tdir, t[k])).toString('base64')
        inlined++
      }
    }
  }
  rmSync(join(tdir, 'textures'), { recursive: true, force: true })
  writeFileSync(tpath, JSON.stringify(tm))
  console.log(`pack-artifact: terrain ${Object.keys(pmap).length} prop GLB -> .gltf.json, ${inlined} textures inlined`)
}

// Rigged figures (A3, spec 30): figure GLBs (dist/assets/anim/*.glb) and item GLBs (dist/assets/anim/items/*.glb) become .gltf.json the same
// way, and dist/assets/anim/manifest.json is repointed (figures[].file, items[].file). The figure lab page in dist keeps working only in
// the repo build: its GLBs are packed away here, like the static models.
const adir = join(process.cwd(), 'dist', 'assets', 'anim')
if (existsSync(join(adir, 'manifest.json'))) {
  const maps = { '': packDir(adir), items: existsSync(join(adir, 'items')) ? packDir(join(adir, 'items')) : {} }
  const repoint = (f) => {
    const i = String(f).lastIndexOf('/')
    const d = i < 0 ? '' : String(f).slice(0, i)
    const base = i < 0 ? String(f) : String(f).slice(i + 1)
    const m = maps[d]
    return m && m[base] ? (d ? d + '/' : '') + m[base] : f
  }
  const apath = join(adir, 'manifest.json')
  const am = JSON.parse(readFileSync(apath, 'utf8'))
  for (const f of Object.values(am.figures ?? {})) if (f && typeof f.file === 'string') f.file = repoint(f.file)
  for (const it of Object.values(am.items ?? {})) if (it && typeof it.file === 'string') it.file = repoint(it.file)
  writeFileSync(apath, JSON.stringify(am, null, 2))
  console.log(`pack-artifact: anim ${Object.keys(maps['']).length + Object.keys(maps.items).length} GLB -> .gltf.json`)
}
