// Post-process raw audio: measure crest factor, shape gunshots, convert to .ogg, write manifest + sounds.html.
// usage: node tools/assets/post-audio.mjs measure            -> prints crest/peak/rms per raw file
//        node tools/assets/post-audio.mjs build [id=variant ...]   -> converts picks (default: best crest for guns, variant 1 otherwise)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '../..');
const raw = path.join(root, 'art/raw/audio');
const jobs = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'audio-jobs.json'), 'utf8'));
const GUNS = ['rifle', 'shotgun', 'revolver', 'pistol', 'long-rifle-suppressed', 'smg', 'lmg-burst', 'frag-explosion'];
const ff = (args) => spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args], { encoding: 'utf8' });
function stats(file, filter = '') {
  const r = ff(['-i', file, '-af', (filter ? filter + ',' : '') + 'astats=metadata=0', '-f', 'null', '-']);
  const t = r.stderr.split('Overall')[1] || '';
  const g = (k) => { const m = new RegExp(k + " level dB: *(-?[0-9.inf]+)").exec(t); return m ? +m[1] : NaN; };
  const peak = g('Peak'), rms = g('RMS');
  return { peak, rms, crest: Math.pow(10, (peak - rms) / 20) };
}
const files = (id) => fs.readdirSync(raw).filter((f) => f.startsWith(id + '_')).sort().map((f) => path.join(raw, f));
const cmd = process.argv[2];
if (cmd === 'measure') {
  for (const id of [...Object.keys(jobs.sfx), ...Object.keys(jobs.music)])
    for (const f of files(id)) { const s = stats(f); console.log(path.basename(f).padEnd(34), 'peak', s.peak, 'rms', s.rms, 'crest', s.crest.toFixed(1)); }
}
if (cmd === 'build') {
  const over = Object.fromEntries(process.argv.slice(3).map((a) => a.split('=')));
  const manifest = { sfx: {}, music: {} }, notes = {};
  for (const kind of ['sfx', 'music']) {
    const dir = path.join(root, 'public/assets/audio', kind); fs.mkdirSync(dir, { recursive: true });
    for (const [id, e] of Object.entries(jobs[kind])) {
      const fs_ = files(id); if (!fs_.length) { console.log('missing', id); continue; }
      let pick = over[id] ? fs_[+over[id] - 1] : fs_[0];
      let filter = '';
      if (kind === 'sfx') {
        const isGun = GUNS.includes(id);
        if (!over[id] && isGun) pick = fs_.map((f) => [f, stats(f).crest]).sort((a, b) => b[1] - a[1])[0][0];
        // trim leading silence, normalise peak, fade tail
        filter = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.01';
        if (isGun) filter += `,volume='if(lt(t,0.03),1,exp(-(t-0.03)*${id === 'frag-explosion' ? 2.2 : id === 'lmg-burst' ? 2.4 : id === 'smg' ? 1.6 : id === 'shotgun' || id === 'revolver' ? 14 : 6}))':eval=frame`;
        filter += ',alimiter=limit=0.5:level=0,afade=t=out:st=' + Math.max(0.1, e.s - 0.4) + ':d=0.4';
        notes[id] = { pick: path.basename(pick), crestRaw: +stats(pick).crest.toFixed(1) };
      } else {
        filter = 'loudnorm=I=-18:TP=-1.5,afade=t=in:d=0.05' + (id === 'victory' || id === 'defeat' ? ',afade=t=out:st=' + (e.d - 3) + ':d=3' : '');
      }
      const out = path.join(dir, id + '.ogg');
      const r = ff(['-i', pick, '-af', filter, '-t', String(kind === 'sfx' ? e.s : e.d), '-ac', kind === 'sfx' ? '1' : '2', '-c:a', 'libvorbis', '-q:a', kind === 'sfx' ? '5' : '4', out]);
      if (r.status) { console.log(id, 'ffmpeg failed', r.stderr.slice(-200)); continue; }
      manifest[kind][id] = `${kind}/${id}.ogg`;
      if (kind === 'sfx') { const s = stats(out); notes[id].crestOut = +s.crest.toFixed(1); notes[id].peakOut = s.peak; }
      console.log(kind, id, path.basename(pick), notes[id] ? JSON.stringify(notes[id]) : '', (fs.statSync(out).size / 1024).toFixed(0) + 'KB');
    }
  }
  fs.writeFileSync(path.join(root, 'public/assets/audio/manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(root, 'art/raw/audio/build-notes.json'), JSON.stringify(notes, null, 2));
  const rows = (kind) => Object.entries(manifest[kind]).map(([id, f]) => `    <li><span class="id">${id}</span> <audio controls preload="none" src="assets/audio/${f}"></audio></li>`).join('\n');
  fs.writeFileSync(path.join(root, 'public/sounds.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Project X sounds</title>
<style>
  body { font-family: system-ui, sans-serif; background: #111; color: #ddd; margin: 0; padding: 16px; }
  h1 { font-size: 20px; } h2 { font-size: 16px; margin-top: 24px; color: #e0b030; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { display: flex; align-items: center; gap: 12px; padding: 6px 0; border-bottom: 1px solid #2a2a2a; flex-wrap: wrap; }
  .id { width: 220px; font-family: ui-monospace, monospace; }
  audio { flex: 1; min-width: 240px; }
</style>
</head>
<body>
<h1>Project X sound check</h1>
<p>Generated with local studios. Not yet judged by ear.</p>
<h2>Sound effects</h2>
<ul>
${rows('sfx')}
</ul>
<h2>Music</h2>
<ul>
${rows('music')}
</ul>
</body>
</html>
`);
}
