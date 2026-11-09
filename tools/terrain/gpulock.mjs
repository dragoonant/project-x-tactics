// GPU mutex shared with other agents: an atomic mkdir of C:/Claude Code Projects/.gpu-lock.d, owner name in a file inside.
// usage in code: await withGpu('T0', async () => {...});  CLI: node gpulock.mjs acquire|release <name>
import fs from 'node:fs'
import path from 'node:path'
const DIR = process.env.GPU_LOCK_DIR || 'C:/Claude Code Projects/.gpu-lock.d'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export async function acquire(name, maxMs = 30 * 60 * 1000) {
  const t0 = Date.now()
  for (;;) {
    try { fs.mkdirSync(DIR); fs.writeFileSync(path.join(DIR, 'owner.txt'), `${name} ${new Date().toISOString()}\n`); return }
    catch (e) {
      if (e.code !== 'EEXIST') throw e
      if (Date.now() - t0 > maxMs) throw new Error('gpu lock busy for 30 min')
      await sleep(20000)
    }
  }
}
export function release() { fs.rmSync(DIR, { recursive: true, force: true }) }
export async function withGpu(name, fn) { await acquire(name); try { return await fn() } finally { release() } }
if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  const [cmd, name] = process.argv.slice(2)
  if (cmd === 'acquire') { await acquire(name || 'T0'); console.log('acquired') } else { release(); console.log('released') }
}
