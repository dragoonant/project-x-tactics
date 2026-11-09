// GPU mutex shared with the other agent: atomic mkdir of C:/Claude Code Projects/.gpu-lock.d, owner name in a file inside.
// usage: import { withGpu } from './gpulock.mjs'; await withGpu('A1-agent', async () => { ... });
import fs from 'node:fs';
import path from 'node:path';

function findLock() {
  let d = import.meta.dirname;
  while (path.basename(d) !== 'project-x' && path.dirname(d) !== d) d = path.dirname(d);
  return path.join(path.dirname(d), '.gpu-lock.d');
}
const LOCK = process.env.GPU_LOCK_DIR || findLock();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const lockPath = () => LOCK;

export async function acquire(name, maxWaitMs = 30 * 60 * 1000) {
  const t0 = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(LOCK);
      fs.writeFileSync(path.join(LOCK, name + '.txt'), `${name} ${new Date().toISOString()}\n`);
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (Date.now() - t0 > maxWaitMs) throw new Error('gpu lock wait > 30 min, giving up');
      await sleep(20000);
    }
  }
}

export function release(name) {
  try { fs.rmSync(path.join(LOCK, name + '.txt'), { force: true }); fs.rmdirSync(LOCK); } catch { /* already gone */ }
}

export async function withGpu(name, fn) {
  await acquire(name);
  try { return await fn(); } finally { release(name); }
}
