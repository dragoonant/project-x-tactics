# Art Plan: real terrain and animated figures (draft, awaiting the owner's go)

Owner, 2026-11-08: "I'd like to see real terrain and models in the game. I'd like to rig the current models to be able to have animations. Let's plan that." The Arbiter figure is parked ("I like them all").

Two tracks that touch different files and can run side by side: **A. Animated figures** and **T. Terrain**. Each starts with a one-figure or one-prop spike that you look at before the full batch (KB rule 13: gate the first item).

---

## Why the earlier attempt failed, and how this plan avoids it
`tabletop-kb` rule 15: skeletal animation "was piloted and dropped (2026-10-18); do not reopen it for fused Hunyuan meshes". The Three Kingdoms Tactics lesson names the cause: a Hunyuan figure is one fused mesh, so the weapon is welded to both hands, coats are welded to legs, and auto-weights tear the mesh when an arm moves. That rule is being reopened at your request, so the plan changes the input rather than fighting the mesh:

1. **Regenerate each figure in a rig-friendly pose with empty hands**: arms slightly away from the body, legs apart, weapon removed. This is a Flux image edit of the approved concept ("same figure, same paint, change only the pose"), the same tool Fell-in used for stance edits.
2. **Weapons become separate GLBs** on a hand socket (Fell-in's measured hand sockets). This also pays off later: corp gear and loadout swaps (design doc section 6) become a data change instead of a new figure.
3. **Auto-rig the clean mesh**, then drive it with a shared humanoid animation set retargeted to our proportions (about 2.8 head-heights, short legs).

The current static figures stay as the fallback until each rigged one passes its gate (KB rule 26: never show a stand-in while loading).

---

## Track A: animated figures

### A0. Spike (one figure: the Enforcer)
1. Flux klein edit of `docs/concept/enforcer.jpg` → rig pose, empty hands. Separate edit → the shotgun alone on white.
2. Hunyuan: body GLB (no base) + shotgun GLB.
3. **Auto-rig bake-off** on the same body, rated on the same clips:
   - **UniRig** (open-source ML auto-rigger, runs locally on the RTX 5080; to install and evaluate),
   - **Blender auto-weights** with a standard humanoid skeleton (bpy is already in the Hunyuan3D-2.1 venv),
   - **Mixamo** auto-rig (needs you to sign in to Adobe in Chrome; I would upload the mesh there — your call).
4. Apply 4 clips (idle, walk, aim + fire, hit react), weapon on the right-hand socket with a left-hand grip target.
5. Deliverable: a `figure-lab` page plus an MP4 and contact sheet per clip, like the Three Kingdoms Tactics cut-in reviews. **You approve the look before A1.**

### A1. All figures
7 troopers, 6 syndicate, 3 civilians (the K9 later; it needs a quadruped rig): pose edit → Hunyuan body → rig → per-figure gate (no tearing at shoulders, elbows, knees or coat; feet planted in idle; weapon in hand). Weapons: rifle, shotgun, revolver, long rifle, pistol, SMG, LMG, baton, shock maul, riot shield, club, plus the Bagman's case and the Vox handset as props.

### A2. Animation set
| Clip | Used for |
|---|---|
| idle (relaxed), idle in cover (crouched behind half/full cover) | standing, cover |
| walk, run | movement (phase from distance travelled, not time, so feet don't skate) |
| aim + fire (rifle, pistol, shotgun, LMG burst), reload-free recoil | attacks |
| melee swing, shield bash | melee |
| throw | grenades, gas |
| hit react, stagger | taking damage |
| downed (on the ground), stabilized | DWN rules |
| **surrender (kneel, hands up)**, **cuffed (kneel, hands behind)** | the arrest pillar, which needs to read at a glance |
| death | kills |
| order / point | Vox, Recon Mark, later the Arbiter |
| civilian panic run, cower | CIV rules |

Source of the clips (question 2): a free animation library retargeted to our skeleton, local text-to-motion generation for the arrest-specific clips no library has, or both.

### A3. Animation director in the client
Engine events → clips with crossfades, through the existing presentation director (the bot never acts ahead of an animation). One skinned mesh and one shared skeleton per figure for the draw-call budget (Three Kingdoms Tactics D32: about 50-200 draw calls on phones). Phone quality tiers turn off hit reacts and idle variety first.

---

## Track T: terrain

The board's footprint must stay **exactly the rules grid**: walls, doors and cover come from the map data, never from a generic mesh (KB rule 14: generic GLB walls let units walk through walls). So the split is:

| What | How |
|---|---|
| **Ground, walls, building shells, doors** | Procedural geometry on the grid, dressed with real **PBR materials** (wet asphalt with puddles, cracked paving, grimy brick, corrugated metal, tiled bar floor, steel doors) plus trims, kerbs, drain grates, pipes and window frames along the wall runs |
| **Cover and set dressing** (market stalls, crates, dumpsters, barrels, pillars, lamp posts, the escape van, rubble variants, power boxes, vending machines, noodle-bar counter and stools) | **Hunyuan props** from painted concepts in the figures' miniature style, decimated to about 6k triangles, scaled to their tile footprint, instanced |
| **Mood** | Neon tubes and lit (unlettered) sign boxes, steam vents, wet-street reflections, rain on/off, light pools from the real lamps (already in the engine) |

Texture source (question 3): generate tileable textures locally (Flux) to keep everything original, use a free CC0 texture library, or mix.

### T0. Spike
One corner of the Night Market: asphalt + brick + one stall + one dumpster + one lamp post, side by side with today's boxes. You approve before T1.

### T1. Whole map
All props and materials, decals, the van, rubble states for destructible cover (full → rubble → gone, DST rules), and the dark/lit look kept readable (cover shields and tile overlays must stay legible over the new ground).

### Gates (both tracks)
- Readability: at the default zoom, cover is still readable at a glance, and which tiles are dark is still obvious.
- Performance at 390×844 on the Low tier: draw calls and frame time measured (`?perf=hud`), as in the Three Kingdoms Tactics D32 table.
- Artifact size: the playtest link stays under the host's limits (models are packed as `.gltf.json`).
- e2e rules 25 (tile picking with props in the way) and 26 (preload) still pass.

---

## Rough cost
| Step | GPU time | Agent runs |
|---|---|---|
| A0 spike | ~30 min | 1 |
| A1 all figures + weapons | ~2.5 h | 1 asset agent (streamed, per-item gates) |
| A2 animation set | depends on the source | 1 |
| A3 client director | — | 1 |
| T0 spike | ~20 min | 1 (can share A0's run) |
| T1 whole map | ~1.5 h | 1 asset + 1 client |

---

## Owner answers (2026-11-08, do not re-ask)
| Question | Answer |
|---|---|
| Rig approach | **Re-pose + separate weapons**: Flux-edit each concept to a rig pose with empty hands, regenerate in Hunyuan, auto-rig, weapons as separate GLBs on hand sockets. Reopens KB rule 15 on purpose, with the fused-weapon cause removed |
| Animation source | **Library + generate gaps**: a free CC0 humanoid library retargeted to our proportions; local text-to-motion only for clips no library has (surrender kneel, cuffed) |
| Terrain | **Generate locally + Hunyuan props**: procedural walls and floors exact to the rules grid with locally generated tileable PBR textures; Hunyuan props in the figures' painted style |
| Order | **Two spikes first**: one animated Enforcer (idle, walk, fire, hit) and one textured market corner, shown as video and screenshots before the full batches |

Status: plan approved in substance; waiting for the owner's go to start the two spikes (KB rule 5).
