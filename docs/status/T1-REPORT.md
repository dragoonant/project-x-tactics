# T1 report: the whole Night Market dressed, terrain v2 is the default

2026-11-09. Branch `worktree-agent-aa895d529619aca71`. Nothing pushed or merged. `?terrain=v1` restores the old look; a missing manifest or texture also falls back to it.

## What changed
- **Code moved** to `src/client/board/terrain/` (`Terrain.tsx`, `terrainV2.tsx`, `assets.ts`, new `variants.ts`, `dressing.tsx`, `mood.tsx`). `src/client/game/terrainAssets.ts` is a one-line re-export so the controller is untouched. Shared-file edits: `Board.tsx` import path, `persist.ts` + `Hud.tsx` (rain setting), nothing in figures or animation.
- **Weak spots fixed**: awnings are desaturated in the shader (per-prop `sat`/`mul` in the manifest) and get per-tile tints; doors have hazard-amber jambs and lintel, a brick lintel block and a light strip on both faces (amber shut, monitor green open; the open leaf stands swung out); unlit tiles keep the cool blue-black (see `dark-alley.png`).
- **Variants** chosen by a hash of x, y and indoor/outdoor (`variants.ts`, unit-tested), footprints stay one tile. Half cover: 2 stall variants (3 tints each), crates, oil barrels, concrete barrier, noodle cart (rooms only). Full cover: dumpster, pillar, vending machine (blank unlit panel), shipping containers. Escape van on its tile, rubble for destroyed full cover, a flattened rubble "debris decal" on a half-cover tile whose cover is gone (original cover read from the map data, current state from the engine; the client decides nothing).
- **Building shells**: roof-edge trim caps, window frames and dark glass, drain pipes, cable runs, wall-mounted power boxes (Hunyuan), storefront door awning plus neon tube outline and roof-edge tube (amber, sodium orange, monitor green; unlit colour only, so light pools remain the engine's lamps). Dressing follows each wall's cutaway height, so camera-side walls still drop.
- **Mood**: env reflection for the wet street (gradient with neon streaks, only glossy puddles show it), steam puffs from boundary vent stacks and the noodle-cart pot, rain (one draw call, vertex-shader animation, setting "Rain", default on), lamp bulb core. Self-driven ~15 fps redraw for rain/steam; it never starts under browser automation (`?mood=on` forces it).
- **Low tier** (phone-sized screen or Lite): no rain, no steam, no env map, no pipes/cables/power boxes; windows, trim, neon and awnings stay.

## Props (Flux concept batch seed 5200, 4 candidates; Hunyuan High 512/50 steps, texture 1024, seed 1234, no base cut)
Prompts: `art/terrain/prompts/<slug>.txt` (shared style line, wordless, no figures); contact sheets `art/terrain/concepts/sheet_<slug>.jpg`; 3-view previews `art/terrain/previews/<slug>.png`. All passed their gate the first time (reads at board zoom, near-square footprint, no legible lettering).
| Prop | Pick | Tris | Notes |
|---|---|---|---|
| market-stall-b | 3 | 4000 | teal awning |
| crates-stack | 4 | 3500 | |
| oil-barrels | 3 | 3500 | |
| concrete-barrier | 4 | 3000 | decimation leaves dark slivers, invisible at board zoom |
| noodle-cart | 4 | 4500 | |
| concrete-pillar | 3 | 4000 | |
| vending-machine | 1 | 4000 | back panel has a faint poster texture |
| shipping-crates | 3 | 4500 | one tiny label patch on a container |
| escape-van | 2 | 6000 | |
| rubble-pile (also the debris decal) | 2 | 2500 | |
| power-box (wall dressing) | 1 | 2000 | |
T0's stall and dumpster were re-simplified to about 4k tris (`tools/terrain/simplify_props.mjs`). Every GLB is meshopt + WebP, 160 to 270 KB.

## Numbers (headless SwiftShader: relative only; `tools/terrain/review.mjs ... perf`, last frame sampled over 30 forced frames, full board, default camera, seed 1)
| | Draw calls | Triangles | Textures | ms/frame (CPU raster) |
|---|---|---|---|---|
| Desktop 1440x900 `?terrain=v1` | 113 | 290k | 11 | 116 |
| Desktop 1440x900 default (v2) | 130 | 442k | 43 | 183 |
| Phone 390x844 `?terrain=v1` | 113 | 290k | 11 | 33 |
| Phone 390x844 default, Low tier | 125 | 436k | 38 | 37 |
T0 reported 100 calls for its spike (older sampling method); 130 is 1.3x of that and 1.15x of today's v1. Triangles are the cost (+150k); no real-device frame times were measured. The Low tier sheds only a few calls; if a real phone struggles, next steps are 2 to 3k tri props and no normal maps on Low.

## Review images (`docs/status/t1/`)
`overview.png`, `market.png`, `bar-front.png` (start-screen view, no fog, so the facade is lit), `dark-alley.png`, `overlays.png` (move range, cover shield, target lock), `phone.png` and `phone-close.png` (390x844), `before-after.png` (v1 left, v2 right, same camera), `destroyed.png` (engine frags: two half-cover tiles became debris), `perf.json`. Reproduce: `node tools/terrain/review.mjs http://localhost:5295`.

## Gates
`npm run typecheck` clean; `npm test` 183 passed (new `tests/client/terrain.test.ts`: variants, indoor mask, cover kinds, dressing on the grid, Low-tier filtering); `npm run build` and `npm run build:artifact` OK (14 prop GLBs packed, 15 textures inlined, `dist/assets/terrain` 6.0 MB); `npm run e2e` 29 passed, 3 skipped (screenshot generators). New e2e: rule 25 with a full-cover prop (`rule25-props.spec.ts`: lower camera, the prop's top is drawn above the tile behind it, tapping that tile moves there; tapping the prop's own tile does nothing odd), `?terrain=v1` requests nothing from `/assets/terrain/`, one failing prop GLB keeps the rest, rain toggle and Lite change the draw calls. No van tap test: the tile behind the van is the boundary wall.

## GPU
Flux about 4 min (one batch of 44 images); Hunyuan 11 jobs at 250 to 295 s, about 48 min. All under the shared lock. The studios were restarted after a session restart and are left running.

## Known gaps
- Prop yaw is a hashed quarter turn, so stall fronts do not face the street deliberately.
- Opening a door in-game was not screenshotted (the open look is built and shares code with the shut door); the lintel and frame do not drop with cutaway walls.
- Cables are three straight segments, not curves; windows are dark (no interior glow, by design).
- Steam and rain are not shown in the stills (they animate; the stills show their time-zero positions).
- No real-device timing; Hunyuan paint leaves a few pseudo-glyph smudges (vending back, one container label) that are invisible at board zoom.
- Raw generations (`art/terrain/raw/`, concept PNGs, `art/terrain/work/`) are gitignored and left on disk.
