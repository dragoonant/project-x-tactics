# A0 report: one rigged, animated Enforcer (spike)

2026-11-08. Goal: let the owner judge rigged animation on ONE figure before A1. Everything below was run on this PC (RTX 5080). The GPU mutex `.gpu-lock.d` was taken for every GPU batch and removed after it. No studio or ComfyUI was stopped.

**Look first:** `docs/status/a0/` has 10 MP4s (`<rig>-<clip>.mp4`, front | 3/4 | side, 30 fps, looped to about 3 s), two contact sheets (`sheet-a.png`, `sheet-b.png`, 8 frames per clip, front and 3/4) and `lab-ui.png`. Live: `npm run dev`, open `/figure-lab.html` (rig selector, clip buttons, speed and scale sliders, weapon, turntable, grid with 1-unit tiles; `?rig=a&clip=walk&t=0.5&view=tq&ui=0&scale=1` gives a deterministic frame).

## Step results
| Step | Result |
|---|---|
| 1 Re-pose | Flux klein edit of `docs/concept/enforcer.jpg`, seed 301, 4 candidates (`art/anim-spike/concepts/pose/`, sheet `pose-sheet.png`). Gate vs the concept: all four kept the paint, hazard stripes, respirator, belt, 2.8 head-heights and helmet about a third of the height; all had empty open hands. cand_1 and cand_3 have a hand next to the baton, cand_4 has the cuffs hanging between the thighs, cand_2 has hands clear of the body, a wide gap between the legs and nothing fused. **Picked cand_2** (`pose-pick.png`). The baton and the backpack were dropped by the edit in all four (belt items were allowed, so this was accepted). |
| 2 Weapon | Flux edit, seed 302, 4 candidates (`concepts/shotgun/`). All four: one clean side-view shotgun, no hands. **Picked cand_3** (pump forend, pistol grip, short stock). It is not a copy of the concept's gun (the model re-imagined it). |
| 3 Hunyuan | Body: 40k faces, texture 1024, cut base, seed 1234, 266 s. Shotgun: no base cut, 232 s. `finalize_model.py` made the body 1.8 in tall, feet at y = 0, front +Z (1.128 wide because the arms are out). Shotgun scaled to 1.144 in long. Previews `art/anim-spike/previews/`. Body gate: arms 30 degrees out, open hands, gap between the legs, nothing fused. |
| 4 Animation library | Quaternius **Universal Animation Library [Standard]** (free tier, 45 clips), downloaded from the official itch.io page `https://quaternius.itch.io/universal-animation-library` (page also on `quaternius.com/packs/universalanimationlibrary.html`). Licence file in the zip: "CC0 1.0 Universal (CC0 1.0) Public Domain Dedication"; the itch page says Creative Commons Zero v1.0. No version number is published; the pack is dated March 2025 and the zip is 15.9 MB. Saved under `tools/anim/vendor/ual/` (git-ignored). Used the `Unreal-Godot/UAL1_Standard.glb` file (root motion off). 65-bone T-pose humanoid ("Mannequin"). **It has no rifle or shotgun clips.** Gun clips are pistol only (`Pistol_Idle_Loop`, `Pistol_Aim_Neutral/Up/Down`, `Pistol_Shoot`, `Pistol_Reload`), hit reacts are `Hit_Chest` and `Hit_Head`. I used the pistol clips and solved the left hand onto the shotgun's forend (see below). |
| 5 Rig bake-off | Both rigs built on the same body. See the table below. |
| 6 Clips and export | `public/assets/anim/enforcer-a.glb` (3.65 MB), `enforcer-b.glb` (2.54 MB), `shotgun.glb` (1.06 MB), `sockets.json`. Optimised with `npx @gltf-transform/cli optimize ... --compress meshopt --texture-compress webp --texture-size 1024` from `art/anim-spike/scratch/`. Clips (30 fps): `idle` = `Pistol_Idle_Loop`; `walk` = legs and pelvis from `Walk_Loop`, arms from `Pistol_Idle_Loop` (the plain walk swings the arms, which would throw the gun about), in place; `aim` = `Pistol_Aim_Neutral` plus a 1 s hold; `fire` = `Pistol_Shoot`; `hit` = spine and head from `Hit_Chest`, arms from the pistol idle so the gun stays up. |
| 7 Lab | `figure-lab.html`, `src/lab/main.tsx` (React Three Fiber, `vite.config.ts` entry `lab`). Rule 24 CSS block and listeners included, no `title` attributes (checked: 0). Walk shows a treadmill grid moving at the stride speed from `sockets.json`. Console clean. |
| 8 Media | `tools/anim/render-media.mjs` (Playwright, headless, `?t=` stepped at 30 fps) then ffmpeg 9.0.2 to MP4; `tools/anim/contact_sheet.py` for the sheets. |
| 9 Gates | `npm run typecheck`, `npm test` (13 files, 174 tests) and `npm run build` pass (the build includes the lab). |

### How rig A works (reusable for A1)
1. Joint table: 17 joint heads measured by hand on a front and a side orthographic render with a measuring grid (`tools/anim/orth.py`, `grid.py`; table `J` in `tools/anim/rig_a.py`). The library armature is copied and its bones moved to those joints (short legs, big helmet; finger bones follow the hand rigidly and do not deform: the glove is a mitt).
2. Weights: Blender `parent_set(ARMATURE_AUTO)` (bone heat). The raw mesh has UV-split vertices (119,524 vertices) and bone heat gave nothing on it, so the weights are solved on a welded copy (20,799 vertices) and copied to the original vertices by position, limited to 4 groups per vertex. Zero unweighted vertices.
3. Clips are **retargeted by rotation maths**, not by constraints (`tools/anim/animlib.py`): each source bone's world rotation delta is applied to the target bone's rest world rotation; the arms use a "T reference" (the target arm swung up to horizontal) because the library is in a T pose and our figure in an A pose, plus a 14 degree outward swing so arms clear the armour; the pelvis translation is scaled by the leg-length ratio (0.53 for A, 0.69 for B); each clip is then dropped so the lowest foot rests on the floor.
4. Weapon: socket matrix (weapon to right-hand bone, in `sockets.json` `rightHand.matrix`, row-major, glTF space; the glTF bone-local convention was checked by reading the exported node transforms, error 3e-7) and the left-hand grip point (`leftHand.weaponLocalGrip`, bone `hand_l`). The left arm is solved with a two-bone IK onto that grip inside every baked frame, so the game needs no runtime IK.
5. Tool versions: Blender `bpy` 4.0.0 from `%USERPROFILE%/Hunyuan3D-2.1/.venv` (Python 3.10) for everything (import, fit, weights, bake, glTF export).

## Bake-off
Metrics from the baked data (`art/anim-spike/raw/*-metrics.json`, git-ignored): foot plant = foot drift in idle, stride = stance-foot speed variation in the walk, grip = left-hand miss distance from the forend after IK (inches; the figure is 1.8 tall). Tearing, weapon and verdicts are from looking at the frames (front, 3/4, side) of both sheets and zoomed frames.

| Rig | Clip | Tearing (shoulders, elbows, knees, belt, pouches) | Foot plant / skating | Weapon grip | Verdict |
|---|---|---|---|---|---|
| **A** library skeleton + auto weights | idle | none seen | feet planted: drift 0.000 | both hands on the gun; left miss 0.195 in (hand sits on the receiver, not the forend) | good |
| A | walk | none seen; knee pads and boots follow the legs | stride speed 0.54 in/s (the grid scrolls at this speed in the lab); stance-foot speed varies by 39% (relative std), so some slide | stays in both hands | acceptable, soft skating |
| A | aim / fire | none; shoulder pads follow the arm | planted | barrel level in aim, kicks up in fire; both hands on | good |
| A | hit | none; torso leans back | planted | gun held up (arms from the pistol idle); left miss 0.248 in | good |
| **B** UniRig skeleton + Blender auto weights | idle | none seen | planted: drift 0.000 | both hands on; left miss 0.045 in | good, but the barrel tilts up about 30-45 degrees in idle, walk and fire (UniRig puts the wrist and forearm axis differently, so the socket made on the aim pose is off in other poses) |
| B | walk | none seen | stride speed 0.70 in/s; stance-foot speed varies by 30% | stays in hands | acceptable |
| B | aim / fire | none | planted | level in aim, tilts up in fire | acceptable |
| B | hit | none | planted | left miss 0.12 in | good |

Both rigs are close; I saw **no tearing** at shoulders, elbows, knees, belt or pouches in any clip (there is no coat or backpack on this figure: the Flux pose edit dropped the backpack). Not measured: a numeric tearing metric (edge stretch per frame); this is a visual check only.

## UniRig (rig B): what ran and what did not
Installed in its own venv `%USERPROFILE%/UniRig/.venv` (Python 3.10, uv, torch 2.11 cu128, official repo `github.com/VAST-AI-Research/UniRig` at commit 6793c66, official Hugging Face weights `VAST-AI/UniRig`). About 25 minutes of effort, inside the 45 minute limit.
- Ran on this PC: **skeleton prediction** (articulation-xl checkpoint, about 20 s on the GPU, 28 bones, seed 12345). It found a sensible humanoid: spine chain, two 4-bone arms with fingers, two 4-bone legs. Output kept as `art/anim-spike/raw/unirig-skeleton.fbx`.
- Windows workarounds (all inside `%USERPROFILE%/UniRig`, none in the repo): `bpy` 4.0.0 copied from the Hunyuan venv because `bpy==4.2` has no wheel for Python 3.10; `spconv-cu120` works on the RTX 5080 with the CUDA 12.8 DLL folder added to the DLL path; no Windows wheels exist for `torch_cluster`, `torch_scatter` and `flash_attn`, so three small pure-torch stand-ins (`fps`, `segment_csr`, a cross-attention `MHA` with the same parameter names) are in the venv; config `_attn_implementation` changed from `flash_attention_2` to `sdpa`; one type hint (`Dict[str, ...]`) fixed for Python 3.10.
- **Did not run: UniRig's skinning stage.** The official skin checkpoint pickles a `box.Box` config object, and PyTorch 2.6+ refuses it with `weights_only=True`. Loading it needs `weights_only=False` (arbitrary unpickling). That was refused by the session's permission check, and allow-listing `Box` is not enough, so I did not work around it. Result: rig B is **UniRig skeleton + Blender automatic weights** (same weighting method as rig A), not full UniRig. If the owner is happy to load the official checkpoint with `weights_only=False`, `launch/inference/generate_skin.sh` in `%USERPROFILE%/UniRig` can be re-run (about 4 minutes) and compared.
- The 28 UniRig bones are generic (`bone_N`); `UNIRIG_MAP` in `tools/anim/rig_a.py` maps 22 of them to the library's humanoid names by index and hierarchy. This holds for this figure; it would need a topology-based mapper for A1.

## Sources and licences
| Item | Source | Licence |
|---|---|---|
| Animation clips | Quaternius, Universal Animation Library [Standard], itch.io page above, March 2025 | CC0 1.0 (licence text in the zip) |
| UniRig code | github.com/VAST-AI-Research/UniRig | MIT (repo `LICENSE`) |
| UniRig weights | huggingface.co/VAST-AI/UniRig | see the model card (not checked for commercial terms; skeleton checkpoint only was used) |
| Figure meshes | Hunyuan3D 2.1 / 2.0 (Tencent non-commercial community licence), Flux.2 klein (Apache-2.0) | as in `ASSETS-REPORT.md` |
Downloads were limited to those official sources.

## GPU time
Flux about 1 min (8 images), Hunyuan 8.3 min (body 266 s, shotgun 232 s), UniRig about 3 min (skeleton extraction and inference, plus two aborted skin attempts). About 12 minutes in total.

## Recommendation for A1
1. **Go with rigged figures.** The pipeline works end to end and the result reads clearly: both hands on the gun, planted feet, no tearing. The Flux re-pose with empty hands is what made it work (it removed the weapon fusion that killed the 2026-10-18 attempt).
2. **Use rig A's method for the skeleton** (library skeleton, standard bone names, so every figure shares the same clips, sockets and mapping), but **replace the hand-measured joint table with automatic joints**: UniRig predicted the joints in 20 s without any measuring. Hybrid: run UniRig skeleton prediction, take its joint positions (head, spine, shoulders, elbows, wrists, hips, knees, ankles, toes), and feed them into `build_target()` as the table. That removes the one manual step (about 10 minutes of grid reading per figure).
3. Keep the welded-copy auto weights (no failures, 0 unweighted vertices) and the rotation-delta retarget with IK for the second hand baked into every clip.
4. Clips: the library has no rifle, shotgun, melee-with-weapon, throw, surrender or cuffed clips (see the A2 list). Pistol clips stand in for every long gun here; for A2 plan the text-to-motion route for arrest clips and a rifle hold (a two-handed hold can be made by the same left-hand IK on a pistol clip, as done here). The paid Pro tier of this pack (USD 9.99) was not used.
5. Per-figure cost estimate: Flux pose edit 1 min, Hunyuan 4.5 min GPU, rig and bake under 1 minute of CPU, media about 5 minutes (software GL).

## What I could not do or did not do
- UniRig skinning (see above); Mixamo was not tried (needs the owner's Adobe sign-in).
- No numeric tearing metric; the check is visual. Left-hand grip misses by 0.195 in on rig A (short arms, the forend is out of reach so the hand holds the receiver) and the idle/walk barrel pitch on rig B is off.
- The walk is not perfectly foot-locked: stance-foot speed varies 30-39%; a per-foot IK plant pass would remove it.
- The shotgun differs from the concept's gun (Flux re-drew it); the baton and backpack of the concept are missing on the re-posed body.
- Game scale: the figure is 1.8 units tall (1 unit = 1 inch) and the board tile is 1 unit; the lab shows it at 0.6 by default to match the stand-in's height of about 1.

## Files
`art/anim-spike/` (concepts, prompts, previews; `raw/` and `scratch/` are git-ignored), `tools/anim/` (`flux.mjs`, `hy.mjs`, `rig_a.py` run with `--rig a|b`, `animlib.py`, `finalize_a0.py`, `render-media.mjs`, `contact_sheet.py`, helpers; `vendor/` git-ignored), `public/assets/anim/`, `figure-lab.html`, `src/lab/main.tsx`, `docs/status/a0/`.
Rebuild: `python tools/anim/finalize_a0.py` after `rig_a.py --rig a` and `--rig b` (run with the Hunyuan3D-2.1 venv python), then optimise from `art/anim-spike/scratch/`.
