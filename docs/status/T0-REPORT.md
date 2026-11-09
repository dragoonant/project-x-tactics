# T0 report: real terrain for the Night Market (spike, behind `?terrain=v2`)

2026-11-08. Branch `worktree-agent-a5d4e6611fb9e3459`. Default look is unchanged; add `?terrain=v2` to the URL to see the spike. Nothing pushed or merged.

## What you see
| File | What |
|---|---|
| `docs/status/t0/before.png`, `after.png` | 1440x900, same seed (1), same camera, no trooper selected, the market corner (lamps, stalls, dumpsters) |
| `docs/status/t0/before-overlay.png`, `after-overlay.png` | same camera with Alpha selected: blue and yellow move range, hover frame and cover shield on a tile next to a stall |
| `docs/status/t0/after-phone.png` (+ `before-phone.png`, `compare-phone.png`) | 390x844 |
| `docs/status/t0/after-dark.png` (+ `before-dark.png`) | the dark west edge: unlit and unseen tiles, an outer-wall hoarding, dumpsters in the dark |
| `docs/status/t0/compare.png` | three rows, before left and after right: corner, overlay, dark edge |
| `art/terrain-spike/tilecheck-*.jpg` | 3x3 tiling check sheets (the door sheet is not seamless on purpose, see below) |
| `art/terrain-spike/concepts/*.jpg`, `previews/*.png` | 4 concepts per prop; 3-view preview of each finished GLB |

## Textures (Flux klein text-to-image, local, 1024 px, wordless)
Prompts: `art/terrain-spike/prompts/<name>.txt`. Seed 4100, 2 candidates each, pick = candidate 1 for all five (flat evenly lit, no lettering, no logos, nothing in frame but the surface).
| Surface | Used for | Notes |
|---|---|---|
| `asphalt` | street floor | wet cracked asphalt, tinted puddle patches. Roughness map is low where the tint is (puddles), and the puddles are flattened in the normal map. Spec highlights from the lamps show on them |
| `tilefloor` | floor inside the three rooms (flood fill from the map edge, doors block) | dark red and charcoal checker, grimy grout |
| `brick` | wall runs | dark red brick with soot streaks |
| `corrugated` | outer boundary wall (its own instanced mesh) | rust over green-grey paint; first at 2 tiles per repeat it shimmered, now 4 |
| `steeldoor` | doors | one panel per box face with the geometry's own UVs, so it is not made seamless |
Pipeline: `tools/terrain/flux_t2i.mjs` (GPU lock, saves PNG) then `tools/terrain/make_maps.py` (offset-and-blend in two 1-D passes to make each seamless, Sobel normal map from luminance, roughness from colour, 3x3 check sheet). WebP in `public/assets/terrain/textures/` (15 files, about 1.5 MB). Honest note: the blend leaves faint ghosting in the middle of each tile; at board zoom it reads as grime, and the asphalt grid of repeats is not noticeable (4 tiles per repeat).

## Props (Flux concept then Hunyuan GLB)
Concept prompt = one shared style line (hand-painted scenery piece, matte paint, edge highlights, grime and rust, sodium-orange and rust palette, white background, three-quarter view, no base, no figures, wordless) plus the object line; seed 5100, 4 candidates each, `art/terrain-spike/prompts/`. Hunyuan: High quality (octree 512, 50 steps, 40k faces), texture 1024, seed 1234, no base cut. Then `tools/terrain/finalize_prop.py` (bpy: join, collapse-decimate to 6000 tris, matte, tile units, feet at y = 0) and `gltf-transform optimize --compress meshopt --texture-compress webp --texture-size 1024` run from a scratch folder.
| Slug | Replaces | Pick and gate verdict | Result |
|---|---|---|---|
| `market-stall` | half cover (`halfCover`) | stall_2 of 4. Gate: reads at board zoom (awning plus counter silhouette), nearly square in plan, crates and sacks present and not fused to the awning, no lettering. Rejected 1 (too wide), 3 (open front), 4 (scalloped awning edge, wide) | 6000 tris, 0.92 x 0.73 tiles, 0.93 high, 253 KB |
| `dumpster` | full cover (`fullCover`) | dumpster_2 of 4. Closed lid, one box, wheels; the open-top ones (3, 4) would give Hunyuan a cavity. Rejected 1 for the side handle | 6000 tris, 0.92 x 0.61 x 0.73 before the fit; the client fits it to 0.98 wide and stretches it 30% in height (about 1.0 high) so full cover reads taller than the stall counter. 263 KB |
| `street-lamp` | lamp (`lamp`) | lamp_2 of 4: straight pole, short arm, round base; 1 had an S-bend, 3 an asymmetric arm | 6000 tris, 2.4 high, base 0.56 wide, arm overhangs the tile by about half a tile. 225 KB |
All three passed first time, no retries. The painted look is close to the concepts but a little pale; the client multiplies the prop materials by 0.62 so the lamp pools do not blow out the awning.
`public/assets/terrain/manifest.json`: textures per surface (colour, normal, roughness, tile size) and props (file, the map object kind each replaces, footprint, height, fit mode, optional `stretchY`).

## Client (`?terrain=v2`)
- `src/client/game/terrainAssets.ts`: flag, manifest, texture and GLB preload. `controller.boot` waits for it, so New Operation stays disabled until everything is loaded (rule 26); the board draws terrain under a `<Suspense fallback={null}>` (`TerrainGate` in `Board.tsx`). A missing manifest or texture keeps today's procedural look and logs a warning; a missing prop keeps just that procedural box. Nothing is requested with the flag off.
- `src/client/board/terrainV2.tsx`: world-space UV patch (`onBeforeCompile`, instanced boxes: top faces use x/z, side faces use the along-wall axis and world y, so bricks stay level when walls drop), materials, indoor mask, and `PropField` (instanced Hunyuan meshes, one `InstancedMesh` per sub-mesh, no handlers, `raycast` off).
- `Terrain.tsx`: street asphalt and bar tile floor as two instanced meshes, brick walls plus a kerb strip at the base (extra instanced mesh), corrugated hoarding for the boundary, steel doors, stalls, dumpsters and lamps as props (lamp point lights and the glow decal are unchanged; the procedural lamp head is hidden). Tile gap widened from 0.5% to 2.8% so the grid stays readable on textured ground. Props dim on dark and unseen tiles. Dark ground tiles get an extra brightness boost so they still read against the darker textures.
- `Overlays.tsx`: move-range fill opacity 0.4 to 0.26 with the flag on, so the ground shows through; cover shields and hover frame untouched.
- `CameraRig.tsx` / `Board.tsx`: expose `window.__pxBoard`, `__pxWake`, `__pxGl` for the review scripts and measurements.
- Artifact: `tools/pack-artifact.mjs` now also packs `dist/assets/terrain/props/*.glb` to `.gltf.json`, repoints the terrain manifest, and inlines the 15 textures into the manifest as data URIs (the host's handling of `.webp` files is unverified, so nothing relies on it); `dist/assets/terrain` is 3.0 MB. Checked: the packed build served locally renders the same board with the flag on.

## Numbers (headless SwiftShader, so relative only; `tools/terrain/shot.mjs --stats`, full board, default camera, 30 forced frames)
| | Draw calls | Triangles | Textures | ms per frame (CPU rasteriser) |
|---|---|---|---|---|
| Desktop 1440x900 before | 103 | 263k | 11 | 101 |
| Desktop 1440x900 `v2` | 100 | 421k | 27 | 154 |
| Phone 390x844 before | 100 | 256k | 11 | 23 |
| Phone 390x844 `v2` | 103 | 434k | 27 | 33 |
Draw calls are unchanged (the figures dominate). The cost is triangles (+160 to +180k, about 30 stalls, dumpsters and lamps at 6k each) and fragment work (three maps per surface, normal mapping); that is the +45 to +50% in the software rasteriser. Real Low-tier phone frame time has not been measured. If T1 needs room: 3 to 4k tris for stalls (there are about two dozen) and an optional lower normalScale on Low.

## Gates
`npm run typecheck` clean. `npm test` 174 passed (static rules included: only the pick surface has pointer handlers, still true). `npm run build` and `npm run build:artifact` OK. `npm run e2e`: 24 passed, 3 skipped (the screenshot generators), including two new flag-on specs (`tests/e2e/terrain-v2.spec.ts`: the start button waits for the delayed manifest, all 15 textures and 3 props load, no console errors; a 404 manifest keeps the procedural board and the game starts). Flag-on run of the existing smoke, rule 24, rule 25 (tile behind a figure, select and clear), rule 27 camera, touch and fullgame specs: `PX_TERRAIN=v2 npx playwright test smoke rule25 rule27 rule24 fullgame touch` 13 passed (`tests/e2e/helpers.ts` reads `PX_TERRAIN`).

## GPU
Flux: about 2 min of jobs (84 s textures, 39 s concepts, plus model load). Hunyuan: 764 s (lamp 232, stall 284, dumpster 249). About 15 min total, all under the shared lock `C:/Claude Code Projects/.gpu-lock.d` (waited about 17 min for spike A0 before the first job). I started Flux (7880) and Hunyuan (7860) studios myself; they are still running, as asked (the coordinator stops them).

## Judgement
Good enough to commit to the whole map. The asphalt with puddles and the brick are a clear step up and stay readable: lit versus dark is as obvious as before, the grid and cover shields are intact. The three props read at board zoom and fit their tiles. Weak spots: the awning is hot orange and a little flat in lit areas; doors read as a grey panel (the old orange door was easier to spot); the bar floor is only verified by the flood-fill (the interior is under fog in every shot, so I did not get a clean image of the tiled floor); the unlit-tile look is darker and less blue than before.

## T1 (whole map): what to do
1. Props still to generate with the same recipe (concept batch, per-item gate, Hunyuan, `finalize_props.mjs`): crates and barrels (dressing), pillars, rubble states for DST (full, rubble, gone; `PropField` already follows `state.map.tiles`), the escape van (now a box group in `Van`), power boxes, vending machines, noodle-bar counter and stools, and a second stall and dumpster variant each (use the hash flip or add variants to the manifest).
2. Wall dressing: trims and window frames along the wall runs, drain grates and pipes (the kerb strip is the template), a lit unlettered sign box per shopfront. Add a texture-atlas or decal pass for oil stains and cracks.
3. A decision on door look (steel is on the manifest; an orange hazard stripe would make doors read faster) and on whether `bust-01`'s three rooms keep one tile floor or get variants.
4. Measure on a real phone with `?perf=hud` (it does not exist yet; `__pxGl.info` is what the script reads) on the Low tier; fall back to the 3 to 4k tri stalls and no normal map on Low if needed. Consider packing roughness into the colour alpha or dropping it on Low to cut texture memory (27 textures now, about 60 MB GPU).
5. Replace `?terrain=v2` with the default once approved; delete the procedural path only after the owner signs off.
6. Lamp glow: the bulb is painted, not emissive. A small emissive sphere or a bloom-free glow card at the bulb would sell it; the real light stays at the old position.

## Known gaps
- No real-device frame times, no ambient-reflection environment for the puddles (only lamp specular).
- Prop yaw is a 180 degree flip chosen per tile; stall fronts do not face the street deliberately.
- The rule 25 test with props in the way uses the existing figure-occlusion cases (props have no pointer handlers and the static test enforces that); there is no dedicated "tile behind a dumpster" e2e.
- Door texture check sheet is a plain tile of the single panel, not a seamless texture.
- Raw outputs (`art/terrain-spike/raw/`, about 30 MB) are gitignored and left on disk.
- One dev-server collision found: port 5291 is held by another agent's preview server (not mine, not touched).

## Reproduce
```
node tools/terrain/flux_t2i.mjs art/terrain-spike/raw/tex asphalt art/terrain-spike/prompts/asphalt.txt --n 2 --seed 4100
python tools/terrain/make_maps.py
node tools/terrain/hy_prop.mjs street-lamp=<concept png>
node tools/terrain/finalize_props.mjs market-stall:foot:0.92 dumpster:foot:0.92 street-lamp:height:2.4
node tools/terrain/shot.mjs "http://localhost:5290/?terrain=v2" out.png --cam -1.5,-0.5,0.35,0.95,17 --select none --stats stats.json
```
