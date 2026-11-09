# M2 report: the playable 3D board

Status: **done, all gates green.** The game is `index.html` (`src/client/main.tsx`); the M1 debug page is `debug.html` (`src/debug/` untouched and still works). Built `dist/` runs from any path (checked under `/deep/sub/path/`, no console errors).

## What was built (all under `src/client/`)
| Area | Files | Notes |
|---|---|---|
| Entry and base | `main.tsx`, `App.tsx`, `style.css`, `hook.ts`, `env.d.ts` | Rule 24 CSS block verbatim, `selectstart` and `contextmenu` guards, scanline and vignette as two static gradient layers (no filters, no `backdrop-filter`), `lite` switch. `window.__px` test hook (camera, `tileToScreen`, state, dispatch, autoplay). |
| Store and flow | `game/store.ts` (zustand), `game/controller.ts`, `game/director.ts`, `game/presentation.ts` | New game, Continue, dispatch, End Turn, taps. The syndicate phase loops `syndicatePolicy(state)` then `step`, and awaits the director for every action, so the bot never acts ahead of the animation. Speed Normal / Fast / Instant. Camera follows visible enemy actions. |
| Pure helpers | `game/tap.ts`, `game/describe.ts`, `game/names.ts`, `game/vision.ts`, `game/persist.ts` | `resolveTap` (rule 25), ability bar model with reasons from `actionProblem`, 2-action dash reach from `query.reachable`, telemetry text for every event kind, fog tile mask from the engine's own `sees()`, save envelope IO. |
| 3D board | `board/Board.tsx` (one persistent `<Canvas>`, demand frame loop), `Terrain.tsx`, `Figures.tsx`, `Overlays.tsx`, `Effects.tsx`, `CameraRig.tsx`, `camera.ts`, `layout.ts`, `textures.ts` | Instanced ground, walls, stalls, dumpsters, rubble, doors (open/closed), lamps with real point-light pools plus glow decals, extraction frame, exit arrows, escape van, gas / smoke / scan / spotlight volumes. Wall cutaway is height-aware (walls between camera and a trooper, an enemy or the cursor drop low; the outer wall is a low curb). Dark / lit shading comes from `query.isLit`, fog shading from the squad's sight. |
| Figures | `game/models.ts`, `Figures.tsx` | Reads `public/assets/models/manifest.json` if present (tolerant: flat map, `models`/`units` maps, arrays; optional `yaw` and `height` per entry; `thug-club` / `thug-pistol` loadout variants win over `thug`). Preloads every listed GLB with the meshopt decoder, the start button shows "Loading models n/m" until done. No bases. Stand-ins: capsule body, helmet, weapon block, Bulwark shield slab, Bagman gold marker, precinct black/amber, recruit olive/red, syndicate rust, civilians grey. Facing follows the engine's `facing`; moves slide and hop along the event path. |
| HUD | `ui/Hud.tsx`, `StartScreen.tsx`, `EndScreen.tsx` | Bodycam feed: REC dot, clock, round / phase, Alarm meter with ticks at the tuning thresholds, channel tabs per trooper (call-sign, class, Health, actions, status), ability bar (every ability from `legalActions`; disabled ones explain themselves inline), hover unit card, target lock panel with the full hit breakdown, floating HIT / GRAZE / RES readout with brackets and a line of fire, noise ring for loud actions, telemetry ticker, phase glitch banner, settings (speed, lite, mute, volume, "audio not found"). |
| Audio | `game/audio.ts` | Optional. Reads `public/assets/audio/manifest.json` when the build ships one; SFX per event (weapon id, cuff, explosion, gas, door / breach, ricochet on miss, UI select / confirm); music by state (calm, tense once a group is aware, combat for 14 s after shots, victory, defeat); iOS unlock on `touchend` / `pointerup` / `click`. |

Controls: wheel zooms toward the cursor, right drag rotates and tilts, middle drag pans, left picks, left drag pans until a middle press is seen (`px-mouse-3btn`). Touch: one finger pans, two twist and pinch; the first tap on a tile previews (hover card, readout, cover shields), the second confirms. Q / E and the on-screen buttons rotate. Move range is blue (1 action) and yellow (2 actions, from chained `query.reachable`); a yellow tap sends two `move` actions.

## Tests
| Suite | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` (vitest) | **173 passed** in 13 files (137 engine + the M3 additions already on `main`, plus 16 new client tests: telemetry text never contains `undefined` / `NaN` over 6 random games, `resolveTap` cases incl. hidden enemies and dash, ability reasons, source rules: only the pick surface has pointer handlers, no `title=`, no filters, CSS block verbatim, manifest parser) |
| `npm run build` | OK (main bundle 1.1 MB, 300 kB gzip; engine chunk 238 kB) |
| `npm run e2e` | **22 passed, 3 skipped** (the skipped ones are the screenshot generators, `PX_SHOTS=1`), about 30 s, 1 worker |

E2E specs (`tests/e2e/`): `smoke` (start screen, New Operation, one canvas, canvas really painted, no console errors or 4xx); `rule25-pick` (tap the tile drawn behind a standing figure moves there; tap selects / clears); `rule27-camera` (left drag pans on a fresh profile, middle drag pans and is remembered, left drag after a middle press leaves the camera alone, right drag rotates and tilts, wheel zooms toward the cursor, rotate buttons); `rule24-select` (390x844: `userSelect` none, triple click leaves the selection empty, `contextmenu` suppressed, inputs stay selectable); `rule22-save` (`launchPersistentContext`: play, close, reopen, Continue restores round / phase / action count / every unit's position; confirm-before-overwrite; corrupt save says why and Discard clears it; refused storage shows a line); `rule8-text` (no `title` attributes, no SVG `<title>`, ticker and page text never contain `undefined` / `NaN`); `fullgame` (a whole game at Instant speed reaches the end screen; save cleared; Copy report puts seed, tuning and outcome on the clipboard; Replay same seed; New operation); `models` (faked manifest: start waits for the GLBs, a missing model falls back to the stand-in); `audio` (faked manifest and WAVs: settings say "audio ready", music is requested after the unlock gesture, no console errors); `touch` (CDP touch: pinch and twist, one-finger pan does not act on the board; two-tap confirm); `turnflow` (ability bar: Overwatch fires at once, Frag arms a tile pick, disabled Cuff explains itself; End Turn at Fast speed returns control with the syndicate phase in the ticker; squad picker and seed field).

## Screenshots (`docs/status/`)
`m2-start.png`, `m2-board.png` (1440x900, mid-game, hovered Thug with the hit readout, brackets, line of fire, noise ring and target lock panel), `m2-phone.png` (390x844 portrait, touch preview of a shot), `m2-end.png` (incident report). Regenerate with `PX_SHOTS=1 npx playwright test screenshots`.

## Engine issues found (not fixed, per the boundary)
1. `query.preview(...).resolve.hit` / `.graze` are `[resFor(low damage), resFor(high damage)]`, which is not sorted when the wounded multiplier applies only to the lower damage (e.g. flanked Thug, Resolve `[6, 3]`). The client sorts for display. Case: seed 1, Recruit `s1` previewing the Thug `e1` at the start.
2. Dash is still two Move actions with no combined reach query (known gap from M1). The client builds the yellow tiles by calling `query.reachable` on a shallow copy of the state with the unit moved to each 1-action tile; the second step can be interrupted by overwatch like any move.
3. `view()` hides unaware groups' composition but `groupAware` events still say "A group is alerted" for groups the squad has never seen; the ticker shows that line as is (it is information the engine chose to emit).
4. Random squads make the Bagman escape by round 4 to 6 (Alarm climbs fast), so full-game e2e games are short. Not a bug, but it means the end-to-end game never reaches the late waves.

## Decisions and deviations
- **Model preload does not use drei's `useGLTF.preload`.** drei's preload gives no completion signal, and the start button must wait ("Loading models 5/13"). `game/models.ts` loads with `GLTFLoader` plus `MeshoptDecoder` set on the loader, counts progress, caches a normalised scene (height 1.0, feet on the tile), and figures clone from that cache. The scene is wrapped in `<Suspense fallback={null}>` anyway; nothing suspends.
- **Wall cutaway drops walls to a low height** (no transparency pass). The outer boundary is always a 0.5 curb so the squad start row is never hidden by the south wall.
- **Demand frame loop.** The canvas renders on change (state, camera, animations, volumes) and idles otherwise; `wake()` in `game/presentation.ts` keeps it alive while something moves. DPR is capped at 1.75 (1 on phones or Lite).
- **Fog shading imports `sees` and `scanned` from `src/engine/fog`** (not part of the public `index.ts`), asking the engine's own FOG-1 rule about a stand-in unit on every tile. No LOS maths in the client.
- **The build knows its optional manifests** (`__PX_MANIFESTS__`, set in `vite.config.ts` from `public/assets/*/manifest.json`), so a published page never requests a manifest it does not ship. The dev server always asks (a missing file falls back to `index.html`, which is detected by content type).
- `aria-disabled` instead of `disabled` on ability buttons, so a tap on a disabled ability shows the reason (touch has no hover). Playwright treats `aria-disabled` as not clickable, so that test uses `force`.
- Touch uses a two-tap flow for actions; the mouse acts on click because hover has already shown the preview.
- The vitest `include` is still `tests/**/*.test.ts`, so Playwright `*.spec.ts` files are not picked up by `npm test`.

## Known gaps
- **Not published as an Artifact** (the brief said it will be; only the `dist/` build was verified from a deep path).
- No real audio files exist yet, so the SFX id lookup (`weapon-<id>`, `<id>`, `cuff`, `explosion`, `gas`, `breach` / `door`, `ricochet`, `ui-select`, `ui-confirm`; music `calm` / `tense` / `combat` / `victory` / `defeat`) is matched against whatever ids the manifest uses with a fuzzy contains-match; wire the real ids when M4 lands.
- GLB facing is assumed to be +Z forward; a per-entry `yaw` in the manifest corrects a model that faces the other way. Not checked against every model; the GLBs present when this was built rendered at the right size and upright.
- Units on a lit tile are only drawn when `view()` says the squad sees them; there is no "unaware" marker on enemy groups (the engine hides composition).
- Phone layout is checked only in emulation (390x844 portrait, 844x390 landscape); no real-device frame rate was measured. Headless SwiftShader: an action to HUD update takes about 20 ms.
- No keyboard-only play, no tuning panel or combat-log roll dump (M5). The ticker lists readable lines, not every roll breakdown; the target lock panel shows the full breakdown before a shot.
- The start screen shows the board behind the card with the default squad; changing the squad picker does not change it.

## Commands
```
npm run dev                  # the game at http://localhost:5173, debug page at /debug.html
npm run e2e                  # Playwright, port from PW_PORT (default 5281), 1 worker
PX_SHOTS=1 npx playwright test screenshots
npm test && npm run typecheck && npm run build
```
