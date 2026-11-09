# A1 + A2 report: 16 rigged, animated figures with separate items

Branch `worktree-agent-a5d9afdb12f8822aa`. Contract `docs/spec/30-figures-anim.md` met without changes. Everything except the K9 (quadruped, later) is rebuilt: 7 troopers, 6 syndicate, 3 civilians. 14 items. Gates: `npm run typecheck`, `npm test` (13 files, 174 tests) and `npm run build` pass.

## Look first
- `docs/status/a1/all-idle.png`: all 16 figures in idle with their items.
- `docs/status/a1/<kind>.png`: per figure, 8 frames per clip, front and 3/4 rows (rendered from `figure-lab.html`, software GL).
- Live: `npm run dev`, open `/figure-lab.html` (`?fig=recruit&clip=walk&t=0.4&view=tq&ui=0`, `?all=1&clip=idle` for the overview; walk and run move a treadmill grid at the manifest speed).
- Re-pose gates: `art/rig/<kind>/cands.jpg` (original concept next to the 4 candidates), picked image `art/rig/<kind>/pick.png`; items `art/rig/items/sheet_1.jpg`, `sheet_2.jpg`.

## Deliverables
- `public/assets/anim/manifest.json` per spec 30 (every figure, clips with duration/loop and `speed` on walk and run, attachments with bone, row-major matrix and muzzle; `items`). `<kind>.glb` x16 (about 3 MB each, meshopt + WebP 1024) and `items/<id>.glb` x14 (about 0.1 to 0.2 MB). The A0 files (`enforcer-a/b.glb`, `sockets.json`, `shotgun.glb`) were removed.
- Triangle budget (coordinator): every body is 18,999 to 19,000 triangles (Hunyuan `faceCount` 19000; Blender decimation was tried and rejected, it leaves holes on the UV-split mesh); every item is at most 2,900 (`faceCount` 2900).
- Clips per kind follow the contract table (see manifest); every figure has `run` with a measured `speed`.

## Speeds (figure units per second, figure about 1.8 tall, no scaling applied; multiply by the client's figure scale)
Walk 0.40 to 0.55 (stance-foot speed varies 20 to 40% inside the stride, so a little skating remains, as in A0). Run (Jog) 2.4 to 4.0 (bulwark 2.43, thug-pistol 2.78, gunman 2.81, civilian-b 2.93; the rest 3.1 to 4.0). Measured from the baked stance feet after the leg-length scaling (`a1_rig.py stride_speed`; run uses a looser contact threshold because the jog has a flight phase).

## Method (A0 rig A, generalised)
1. `rig_flux.mjs` Flux klein edit to a neutral rig pose (4 candidates per figure, gate against the concept, rule 23 words checked absent).
2. `rig_hy.mjs` Hunyuan (bodies 40k-class settings but 19k faces, items 2.9k faces), then in the same GPU-lock window `finalize_model.py` and the **UniRig skeleton stage only** (no skinning stage, no `weights_only=False`).
3. `a1_skel.py` maps UniRig's bones by topology (root = pelvis; up chain to the fork = spine; centre chain = neck/head; lateral chains = arms; down chains = legs; x sign = side), with a path-based fallback for packs and antennas (vox-operator, chem-trooper, enforcer used it). The normalised skeleton is mapped back with bbox centre and half the largest extent. UniRig puts the hips about 0.15 too high on these short-legged figures, so the lower body is re-derived from the mesh (crotch height; under a coat the 30% height prior). On the A0 Enforcer the table equals the hand-measured one within 0.02.
4. `a1_rig.py`: UAL skeleton fitted to the joints, auto weights on a welded copy, coat leg-influence reduction (bagman, fixer, civilian-b, civilian-c, vox-operator, chem-trooper: leg weights kept at 35% in the skirt band, the rest goes to the pelvis), item sockets, clips, left-hand IK baked for two-handed guns, export.
5. `a1_finalize.py` (manifest, attachment matrices, convention check passed for every bone), `optimise.ps1`, `a1_media.mjs`.

## Clips (A2)
Library (CC0 UAL): idle, walk, run (Jog), aim, fire, hit, cover (crouch), death (Death01), melee (Sword_Attack; mirrored for the Recon's left-hand baton; the Bulwark keeps its shield arm up; the club Thug uses both hands), bash (Punch_Jab, the shield arm). Authored as keyed poses with two-bone IK, ground contacts and a breathing loop: `surrender` (kneel, hands up), `cuffed` (kneel, hands behind the back, head bowed), `downed` (lying on the back, one knee up, hand on the chest, breathing), `cower` (deep squat, hands over the head, tremor), `panic` (jog with arms flailing overhead), `point` (arm forward; the Vox raises the handset hand to the head), `throw` (left-arm overhand with torso twist while the right hand keeps the gun). Two-handed items stay in both hands in idle, walk, run, aim, fire, hit and cover.

## Per figure
| Kind | Pose pick | Rig | Tris | Gate and issues |
|---|---|---|---|---|
| recruit | cand_4 | UniRig map direct | 19.0k | rifle in both hands in all gun clips; no tearing seen |
| enforcer | A0 pick (`art/anim-spike/concepts/pose/cand_2.png`) | direct | 19.0k | the new re-pose with baton and backpack (cand_1) was built and rigged (`enforcer.baton.*` in raw, not shipped): its heat solve failed, distance weights were used and the gun drooped in aim, so the proven A0 pose is used again. **Baton and backpack are still missing**, as in A0 |
| bulwark | cand_2 | direct | 19.0k | revolver right hand, riot shield on the left forearm standing outboard (moved from the centre after the first sheet hid the figure), maul shown for melee and bash |
| marksman | cand_3 (standing) | direct | 19.0k | long-rifle in both hands; hood and cloak follow, no tearing |
| vox-operator | cand_1 | path fallback, coat weights | 19.0k | handset in the left hand; antenna pack follows the spine |
| chem-trooper | cand_3 | path fallback, coat weights | 19.0k | injector in the left hand; slight hem spikes in 1 of 8 run frames |
| recon | cand_1 | direct | 19.0k | pistol right, baton left, melee mirrored |
| thug-club | cand_2 | direct | 19.0k | club with both hands in melee; surrender and cuffed read clearly |
| thug-pistol | cand_1 (second Hunyuan run) | direct | 19.0k | the cand_3 body made bone heat fail and sheared the jacket in `surrender` (distance-weight fallback); regenerated from cand_1, solved normally |
| gunman | cand_1 | direct | 19.0k | smg two-handed |
| heavy | cand_1 | direct | 19.0k | lmg two-handed |
| fixer | cand_2 | direct, coat weights | 19.0k | long coat follows both legs in walk and run, no tearing |
| bagman | cand_2 | direct, coat weights | 19.0k | pistol right, case left |
| civilian-a | cand_3 | direct | 19.0k | satchel follows the hip |
| civilian-b | cand_2 | direct, coat weights | 19.0k | apron follows |
| civilian-c | cand_1 | direct, coat weights | 19.0k | cloak follows in walk, panic and cower |

## Items (all Flux sketch -> Hunyuan 2.9k faces -> `item_prep.py`)
rifle, shotgun (regenerated from the A0 pick at 2.9k faces), revolver, long-rifle, pistol, smg, lmg, baton, maul, riot-shield, club, case, handset, injector. Picks in `art/rig/items/picks.json`. Gate: one clean object on white for all; they read photo-real and plainer than the painted figures (the item prompt did not ask for the miniature paint style), and the maul's lightning came out as a pale blue disc. Item frame: x along the length, front at -X, grips from `figures.json`; orientation was checked on `item_check.py` renders (the sign heuristic came out inverted, fixed with per-item flips).

## Things A3 should know
- Hide held items during `surrender`, `cuffed`, `downed`, `cower` (the lab does); Bulwark `maul` is the `melee`/`bash` item (hide the revolver then). Vox handset and Recon baton are always attached (left hand).
- `speed` is in unscaled figure units (figure 1.8, civilians 1.7); the board tile is 1 unit, so multiply by the figure scale you use.
- Every clip starts from the standing neutral and loops without root motion; `aim` holds its last frame, `death` ends lying.

## Known issues and what I did not do
- Enforcer baton and backpack not restored (see table). The Hunyuan paint is a little pale and blue-tinted on some figures (as in A0).
- Tearing was judged by eye on the sheets (no hole or sheared panel in the shipped figures). The numeric edge-stretch metric in `meta.json` is dominated by UV-split duplicate vertices and is not meaningful (p99.9 about 2 to 5, max in the hundreds).
- Walk still skates a little (stance-foot speed varies); a per-foot plant pass would remove it.
- `point` for the Recon and Fixer is close to their ready pose (the pistol arm already points forward); only the Vox's reads clearly different.
- Bone heat weighting failed on two bodies (thug-pistol cand_3, enforcer cand_1) even on a voxel-remeshed proxy; I did not find the cause. A distance-weight fallback exists in `a1lib.py` but no shipped figure uses it.

## GPU and process notes
- GPU about 2 hours: Hunyuan 19 bodies (about 4.2 min each, two of them redone) and 14 items (about 2.3 min), UniRig about 10 min in total, Flux about 4 min. A bodies batch started at 40k faces was cancelled and restarted at 19k for the budget.
- Spike T1 held the shared lock for its whole batch (its lock file is rewritten per job without a gap), so this queue had no GPU between 07:15 and 08:03 UTC. The Hunyuan studio had to be restarted once after the session restart; ComfyUI's VRAM was freed through the Flux studio's `/api/backend/free` because it slowed the shape stage 3x. No studio was stopped.
- Running a script through `powershell -File` from node is blocked by the execution policy and I did not bypass it: the UniRig skeleton step is now called from node directly.
- Rebuild a figure: `./tools/anim/a1_build.ps1 -Force <kind>` (from an interactive PowerShell), `a1_finalize.py <kind>`, `optimise.ps1 <kind>`, `node tools/anim/a1_media.mjs --figs <kind>`.
