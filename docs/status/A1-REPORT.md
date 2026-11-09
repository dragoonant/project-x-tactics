# A1 + A2 report: rigged, animated figures (in progress)

Branch `worktree-agent-a5d9afdb12f8822aa`. Contract: `docs/spec/30-figures-anim.md` (not changed).

## Status at last update
- Done: Flux re-pose for all 16 humanoids (4 candidates each, picks in `art/rig/picks.json`, gate sheets `art/rig/<kind>/cands.jpg`, picked image `art/rig/<kind>/pick.png`), Flux item sketches for all 13 items (`art/rig/items/`), the rig + clip pipeline (`tools/anim/a1_*.py`), the lab, the media tools, and the Enforcer built end to end from the A0 body (9 clips, manifest, optimised GLB).
- Blocked: the Hunyuan stage (bodies and items). Spike T1 keeps the shared GPU lock for its whole batch and renews it without a gap (checked with 15 ms polling), so this queue (`tools/anim/rig_hy.mjs`, running) has not been granted the GPU since 07:15 UTC. Everything downstream is scripted and waits only for `art/rig/raw/<kind>.body.glb` and `items/<id>.glb`.

## Pipeline (how a figure is built)
1. `tools/anim/rig_flux.mjs pose|items` (Flux klein edit, prompts in `rig_prompts.json`, no prohibited words) then gate by sheet.
2. `tools/anim/rig_hy.mjs body:<kind>=<img> item:<id>=<img>`: Hunyuan with faceCount 19000 for bodies (coordinator budget 20k triangles) and 2900 for items (3k). Blender decimation was tried first and rejected: it leaves holes on the UV-split mesh.
3. `tools/anim/unirig_skel.ps1 <kinds>`: UniRig skeleton stage only (never the skinning stage, no `weights_only=False`).
4. `tools/anim/a1_skel.py`: topology mapper (root = pelvis, up chain to the three-way fork = spine, centre chain = neck/head, lateral chains = arms, two down chains = legs, left/right by x), skeleton de-normalised with the bbox centre and half the largest extent, both sides averaged. UniRig puts the hips about 0.15 too high on these short-legged figures, so the lower body is re-derived from the mesh (crotch height from the sagittal slice, fall back to 30% of the height under a coat). On the Enforcer the result equals the A0 hand-measured table within 0.02.
5. `tools/anim/a1_rig.py <kind>`: UAL skeleton fitted to the joints, welded-copy auto weights, optional coat leg-influence reduction, item sockets, all clips of `figures.json`, left-hand IK baked for two-handed guns, export.
6. `tools/anim/a1_finalize.py` (manifest, attachment matrices), `tools/anim/optimise.ps1` (meshopt + WebP 1024), `tools/anim/a1_media.mjs` (contact sheets and overview from `figure-lab.html`).

## Clips (A2)
Library (Quaternius UAL, CC0): idle, walk, run (Jog), aim, fire, hit, cover (crouch), death, melee (Sword_Attack, mirrored for the Recon's left-hand baton), bash (Punch_Jab, the shield arm). Authored with a keyed pose solver (two-bone IK for arms and legs, ground contacts, breathing loop): surrender, cuffed, downed, cower, point, throw, panic. Checked on the Enforcer: kneel with hands up, kneel with hands behind the back and head bowed, lying hurt with a hand on the chest, squat with hands over the head and tremor, overhand throw with the left arm while the right keeps the gun, run and walk with planted feet, no tearing on the undecimated mesh.

## Notes for A3 (client)
- Items are attached for every clip; hide held weapons during `surrender`, `cuffed`, `downed`, `cower` (the lab does).
- Bulwark: `maul` is a swap attachment for `melee`/`bash` (hide the revolver).
- `speed` on walk and run is the measured stance-foot ground speed after the leg-length scaling.

## Per figure
(filled in as figures land)

## GPU minutes
Flux about 3 min (64 pose images, 39 item images). Hunyuan: none completed for A1 yet (one body and one rifle were started and cancelled or orphaned while the lock was contested).
