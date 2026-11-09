// Post-build step for the claude.ai Artifact: the Artifact host serves .json but not .glb, so every GLB in
// dist/assets/models is rewritten as a self-contained JSON glTF (`<slug>.gltf.json`, binary chunk embedded as a
// data URI) and dist/assets/models/manifest.json is pointed at those files. GLTFLoader reads JSON glTF from any URL.
// The repo and local dev keep the .glb files; only dist/ changes. Usage: npm run build:artifact
import { readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
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

const map = {}
for (const f of files) {
  const out = f.replace(/\.glb$/, '.gltf.json')
  writeFileSync(join(dir, out), glbToJson(readFileSync(join(dir, f))))
  rmSync(join(dir, f))
  map[f] = out
}

const manPath = join(dir, 'manifest.json')
const man = JSON.parse(readFileSync(manPath, 'utf8'))
for (const v of Object.values(man)) if (v && typeof v === 'object' && map[v.file]) v.file = map[v.file]
writeFileSync(manPath, JSON.stringify(man, null, 2))
console.log(`pack-artifact: ${files.length} GLB -> .gltf.json`)
