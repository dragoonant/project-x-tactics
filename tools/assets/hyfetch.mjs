// Re-fetch textured.glb / cutout.png for slugs from the job ids recorded in art/raw/<slug>.job.json. usage: node hyfetch.mjs slug...
import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
for (const slug of process.argv.slice(2)) {
  const jj = path.join(root, 'art/raw', `${slug}.job.json`); if (!fs.existsSync(jj)) { console.log(slug, 'no job'); continue; }
  const { id } = JSON.parse(fs.readFileSync(jj, 'utf8'));
  for (const f of ['textured.glb', 'cutout.png']) {
    const r = await fetch(`http://localhost:7860/api/jobs/${id}/files/${f}`); if (!r.ok) { console.log(slug, f, r.status); continue; }
    fs.writeFileSync(path.join(root, 'art/raw', `${slug}.${f}`), Buffer.from(await r.arrayBuffer()));
  }
  console.log(slug, 'fetched');
}
