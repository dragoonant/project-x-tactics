# A3 report: skeletal animation on the board

Branch `worktree-agent-a4e6e791f3b6beee5`. Built against `docs/spec/30-figures-anim.md`; tested with the A0 Enforcer (the only rigged figure until A1 lands). Review media: `docs/status/a3/` (`board-anim.png` mid-move, `enforcer.mp4` the Enforcer firing then walking on the board, `strip.png` frames of it, `perf.md`, `capture.mjs` to regenerate both).

## What is built
| Area | Files | Notes |
|---|---|---|
| Contract as code | `src/client/anim/contract.ts` | The 17 canonical clips, which loop, the fallback chain (`run`->`walk`, `cover`->`idle`, `panic`->`run`->`walk`, `cower`->`idle`, plus `bash`->`melee`->`fire`, `cuffed`->`surrender`, `death`->`downed`, everything else -> `idle`, never a T-pose), lying and kneeling pose fallbacks when `death`/`downed`/`surrender`/`cuffed` are missing, item-swap rules, and a tolerant manifest reader. |
| Loader | `src/client/anim/assets.ts`, `game/models.ts` | One `GLTFLoader` with the meshopt decoder shared by static and rigged figures. Reads `assets/anim/manifest.json` (a missing one, or an HTML answer from the dev server, means no rigs), loads every figure and item; the "Loading models n/m" count covers both lists. A failed file leaves that kind on its static figure (or the stand-in). Variant lookup like the static ones (`thug-club`). |
| Mapping | `src/client/anim/mapping.ts` | Pure functions: `baseClip` (state), `moveMode`, `attackClip`, `abilityClip`, `damageClip`, `hasCoverNear`. |
| Cues | `src/client/anim/cues.ts` | Mutable module state between director and rigs (like `motion`): per-unit cue (clip, duration, speed scale, facing target), status holds, and test counters. A cue the rig has not yet picked up survives a slow frame and then plays in full. |
| Rig player | `src/client/anim/Rig.tsx` | `SkeletonUtils.clone` per unit (geometry and materials shared), one `AnimationMixer` per figure, attachments parented to their bone with the manifest row-major matrix, muzzle flash at the attachment's `muzzle`, crossfades 0.15-0.25 s, stride rate from ground speed (capped), item swaps per clip, off-screen skip, Low tier. Every mesh is raycast-proof; no pointer handlers. |
| Board | `src/client/board/Figures.tsx` | Rigged figure when `rigFor(kind, weapon)` exists, else static model, else stand-in. Turn is now time-based (frame-rate independent) and also follows the cue's target. Hop and the lying/kneel transforms apply to static figures only. |
| Director | `src/client/game/director.ts`, `presentation.ts` | Cues per event (table below); rigged figures wait for their real clip lengths, others keep the old fixed beats. `Motion.mode` picks walk/run/panic. Instant still returns at once with no effects. Units whose status changes in a batch keep their old pose until the event that changes it. |
| Artifact | `tools/pack-artifact.mjs` | Anim section: `dist/assets/anim/*.glb` and `items/*.glb` become `.gltf.json`, the anim manifest is repointed. Verified from a static server over the packed `dist/`: rigs load, no console errors. The figure lab in the packed build loses its GLBs (same as before for static models). |
| Test hook | `src/client/hook.ts` (one block) | `window.__px.anim(id)` current clip (null = no rig), `animSeen(id)`, `rigKinds()`, `animStats()`. |

## Event to clip, as implemented
| Source | Clip | Notes |
|---|---|---|
| state: standing | `idle` | phase offset per unit id so figures never breathe in sync |
| state: standing with cover on any of 4 sides (wall, closed door, cover object, rubble) or Hunkered | `cover` | |
| `move`, first action | `walk` | along the event path; rate = ground speed / (`walk.speed` x scale), 0.5x to 3.5x |
| `move` using the second action (before-state actions < 2), `flee` | `run` | falls back to `walk` until A1 ships `run` |
| `civilianMove` | `walk`; `panic` when the civilian is panicked | `civilianFlee` -> `panic` |
| `attack` (ranged: attack, overwatch, suppressionFire, breach, pinningShot) | `aim` (0.32 s, holds) then `fire` | tracer and text at 12% of `fire`; muzzle flash from the item's `muzzle` |
| `attack` with a melee weapon (maul, baton) | `melee` | blow lands 45% in |
| `attack` via `shieldBash` | `bash` | |
| `ability` frag, gas | `throw` | explosion / gas cloud follow after the clip |
| `ability` relay, mark, callSupport, rally | `point` | |
| `ability` suppress | `aim` then `fire` | |
| `damage` with Health loss (graze too) | `hit` | Resolve-only damage plays nothing; a following death/downed cancels it |
| status `downed` / `stabilized` | `downed` | released at the `downed` / `stabilized` event |
| status `surrendered` | `surrender` | at the `surrender` event |
| status `cuffed` | `cuffed` | at the `cuffed` event |
| status `dead` | `death`, holds its last frame | Instant, Continue and mount show it already finished |
| civilian panicked or fleeing, standing | `cower` | |
Item swaps: `maul` replaces the other item on its bone during `melee` and `bash`; `handset` shows only during `point`; every other attachment is always shown (Bulwark revolver and riot shield, Vox shotgun, Recon pistol and baton).
Facing turns smoothly (exponential, about 0.1 s) toward the move direction or the attack target.

## Tests
- `npm run typecheck`, `npm test` (14 files, 234 tests, including the new `tests/client/anim.test.ts`: table-driven for every clip of the contract, every spec fallback, item swaps, state/event mapping, cover, cues, manifest reader including the shipped manifest, and the rule 25 / rule 8 source checks for `src/client/anim`), `npm run build`, `npm run build:artifact`, `npm run e2e` (30 passed, 3 screenshot generators skipped): all green.
- New e2e `tests/e2e/anim.spec.ts`: the rigged Enforcer plays `fire` when attacking and `walk` while moving, then returns to `idle`/`cover`; Instant speed skips cues; missing anim manifest falls back to static figures; a manifest naming a missing file falls back and still reaches ready; Low tier freezes idle updates while the normal tier keeps updating. Edited: `models.spec` (fakes an empty anim manifest so its count stays 3), `rule25-pick` (the figure in front of the tapped tile is the animating Enforcer), `fullgame` (asserts rigs are in play), `helpers.ts` (hook types). The save/Continue e2e is untouched and passes.

## Perf
See `docs/status/a3/perf.md`. Short: 7 rigged figures add 7 draw calls (one skinned mesh per figure plus the shotgun) and 0.07 ms of rig CPU per frame; the cost that shows on software GL is the triangle count of the 40k-face A0 mesh, not the animation. Low tier freezes standing figures and everything off-screen skips its mixer.

## Known gaps and findings
1. **Foot skating.** The contract's `walk.speed` is 0.3 tiles/s at board scale; units move 5-9 tiles/s. The rate is capped at 3.5x, so a planted foot covers about 18% of the ground travelled. A `run` clip baked for dash speed would be used automatically. Details in `perf.md`.
2. `vite.config.ts` is outside my write list, so the build does not set an `anim` flag in `__PX_MANIFESTS__`; the loader treats an absent flag as "ask" (the real build ships the manifest, so there is no 404). If a build ever drops the manifest, add `anim: existsSync('public/assets/anim/manifest.json')` to `define` and `env.d.ts`; `fetchAnimManifest` already honours `anim === false`.
3. Only the Enforcer is rigged, so item swaps (Bulwark maul, Vox handset), `melee`, `bash`, `throw`, `point`, `surrender`, `cuffed`, `death`, `panic`, `cower` are exercised by unit tests and the synthetic perf run, not by a real clip on the board. Missing `death`/`downed` use the lying pose, missing `surrender`/`cuffed` the kneel pose, as static figures do.
4. The muzzle flash is a small additive sphere at the item's `muzzle` for about 90 ms; the tracer still starts at the attacker's tile centre (Effects.tsx is outside my boundary).
5. Rigged moves are slower than static ones (170 ms/tile, 135 for a dash, against 115), so a syndicate turn with rigged figures lasts longer at Normal speed; Fast and Instant are unchanged in kind.
6. The Recruit's `hit` after a Resolve-only damage event shows nothing by design; graze Health damage plays `hit` (contract).
7. Headless frame rates on SwiftShader are about 3-9 fps, so a very short cue can be shorter than a frame; the cue then starts on the first frame that sees it and plays in full (covered by a unit test). A shot's `aim` can still be replaced by `fire` before it is drawn on such a machine; `fire` is never skipped.
8. Idle breathing redraws the on-demand canvas about 10 times a second while any rigged figure is on screen at Normal quality (the board was previously fully idle between actions); Low quality does not.

## Reproduce
```
npm ci
npm run typecheck && npm test && npm run build && npm run build:artifact && npm run e2e
node docs/status/a3/capture.mjs media gpu    # after npm run build; board-anim.png, enforcer.mp4
node docs/status/a3/capture.mjs perf gpu     # or sw
```
