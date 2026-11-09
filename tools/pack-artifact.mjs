// Post-build step for the claude.ai Artifact: the Artifact host serves .json but not .glb, so every GLB in
// dist/assets/models is rewritten as a self-contained JSON glTF (`<slug>.gltf.json`, binary chunk embedded as a
// data URI) and dist/assets/models/manifest.json is pointed at those files. GLTFLoader reads JSON glTF from any URL.
// The repo and local dev keep the .glb files; only dist/ changes. Usage: npm run build:artifact
import { readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(process.cwd(), 'dist', 'assets', 'models')
const files = readdirSync(dir).filter((f) => f.endsWith('.glb'))

function glbToJson(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB')
  let off = 12
  let json = null
  let bin = null
  while (off < buf.length) {
    const len = buf.readUInt32LE(off)
    const type = buf.readUInt32LE(off + 4)
    const chunk = buf.subarray(off + 8, off + 8 + len)
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8').replace(/[\u0000 ]+$/, ''))
    else if (type === 0x004e4942) bin = chunk
    off += 8 + len
  }
  if (!json) throw new Error('GLB has no JSON chunk')
  if (bin) {
    // The GLB-stored buffer is the first one without a uri (meshopt fallback buffers also lack a uri but are marked).
    const b = json.buffers.find((x) => x.uri === undefined && !x.extensions?.EXT_meshopt_compression?.fallback)
    if (!b) throw new Error('no buffer for the BIN chunk')
    b.uri = 'data:application/octet-stream;base64,' + Buffer.from(bin).toString('base64')
  }
  return JSON.stringify(json)
}

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
