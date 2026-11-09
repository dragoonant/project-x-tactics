// Writes public/assets/models/manifest.json from the GLBs present. Heights are the finalize heights in inches (1 unit = 1 inch).
import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const dir = path.join(root, 'public/assets/models');
const H = { 'k9-unit': 1.1, marksman: 1.4, 'civilian-a': 1.7, 'civilian-b': 1.7, 'civilian-c': 1.7 };
const N = {
  'k9-unit': 'Quadruped; height is shoulder-to-head of the cut figure. Check ?gallery for facing (yaw) before wiring.',
  marksman: 'Kneeling pose, so shorter than the standing figures.',
};
const m = {};
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.glb')).sort()) {
  const slug = f.replace('.glb', '');
  m[slug] = { file: f, heightInches: H[slug] ?? 1.8, notes: 'No base; feet at y=0, origin at bottom centre, front +Z, 1 unit = 1 inch. ' + (N[slug] || '') };
}
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2));
console.log(Object.keys(m).length, 'models');
