# Assets report

2026-11-08. Studios used: Hunyuan Studio (7860), Flux Studio (7880, FLUX.2 klein image edit), Audio Studio (7890, Stable Audio Open for SFX, ACE-Step for music). One GPU job at a time. All studios and ComfyUI stopped at the end; `nvidia-smi` shows about 450 MiB used (desktop only).

Scripts in `tools/assets/`: `hy.mjs` (Hunyuan queue), `hyfetch.mjs`, `finalize.mjs` + `finalize_model.py`, `watch-finalize.sh`, `flux.mjs`, `audio.mjs` + `audio-jobs.json`, `post-audio.mjs`, `models-manifest.mjs`, `contact.py`, `prompts/` (the Flux edit prompts).

## NO BASES (owner decision 2026-11-08)
Every GLB stands directly on the ground. The concept image keeps its round base, the shape stage cuts it (`cutBase: true`, the studio's display-base cut) and `tools/assets/finalize_model.py` (a copy of the pipeline finalize with the black plate removed) scales the cut mesh, makes materials matte, and puts feet at y = 0 (verified for all 17 GLBs: ymin 0.000). Origin is the bottom centre, front +Z, 1 unit = 1 inch. The first batch (with bases) was discarded and redone.

## A. Figures from the eight concepts (all done)
Settings: High quality (octree 512, 50 steps, 40k faces), texture 1024, seed 1234, about 4 min per figure (about 32 min GPU). Previews (front 3/4, side, back) are `art/previews/<slug>.png`; raw painted meshes `art/raw/<slug>.textured.glb`.
| Slug | Status | Gate verdict |
|---|---|---|
| recruit | done | olive and red, single rifle, base cut clean; red is washed toward orange |
| enforcer | done | good silhouette, shotgun, baton, cuffs, backpack present |
| bulwark | done | shield, revolver, maul all present; maul paint pale blue |
| marksman | done | kneeling pose, suppressed rifle; height set 1.4 in because kneeling |
| vox-operator | done | radio handset and antenna fine; one boot a little thin |
| chem-trooper | done, retried | seed 1234 left dark floating blobs under the feet (kept in `art/raw/retry/`); seed 4321 clean, used |
| recon | done | pistol plus baton, night-vision visor |
| k9-unit | done | quadruped; set to 1.1 in. Facing not verified in a game gallery (see gotchas: per-unit yaw) |
Known: Hunyuan paint is a little washed/pale (no re-grade applied); GLBs are about 4.4 MB each (not optimised; run `tools/models/optimize.mjs`-style meshopt/WebP from a scratch folder if size matters).

## B. New concepts (Flux klein image edit from `docs/concept/enforcer.jpg`, 1152x896, 4 candidates each)
Prompt template (in `tools/assets/prompts/<slug>.txt`): start from this image, keep painted-miniature style, about 2.8 head-heights, head about a third of height, very broad shoulders, short thick legs in a wide planted stance, plain round black base, white background, studio lighting; change only the figure: ... ; no lettering, no logos, no eagles, exactly one weapon. Seed 101 for every first batch (bagman second batch seed 202). Candidates `art/concepts/<slug>/cand_N.png`, picks `art/concepts/<slug>.png`, contact sheets `art/contact/<slug>-cands.png`, pick sheets `art/contact/syndicate-picks.png` and `art/contact/civilians-picks.png` (each next to the enforcer concept). About 15 s per batch of 4.
| Slug | Pick | Notes |
|---|---|---|
| thug-club | cand_1 | rust hood, face wrap, pipe club in both hands |
| thug-pistol | cand_2 | large pistol raised in one hand. Edits often swapped in a shotgun from the base image; rejected those |
| gunman | cand_4 | armoured vest, rust armband, compact SMG, flat cap; cand_1/3 had shotgun-like weapons |
| heavy | cand_4 | full rebreather, single large machine gun with bipod; belt-fed box not clear (cand_2 had two weapons) |
| fixer | cand_2 | long rust-red coat, earpiece, goggles, pistol; no data slate came through |
| bagman | cand_5 (retry) | first batch had no case; second batch has the chained steel case, pistol, hat over face |
| civilian-a/b/c | cand_4 each | grey hooded worrier with bag, teal-apron stall keeper with crate, brown rain cloak with umbrella. Faces are uncovered but calm; heads read a bit larger than the precinct figures |
| arbiter | none picked (owner chooses) | all 4 kept: crested helmet, respirator, long armoured black coat, skull buckle, hazard trim; sheet `art/contact/arbiter.png`. Crest is a modest spike; sidearm reads as a long-barrelled pistol, shock baton not clearly shown |
Gate note: the syndicate and civilian figures read at about 3.2-3.6 head-heights (taller than the enforcer's 2.8) because they have no oversized helmet; the rest of the gate (broad shoulders, covered or stern face, single weapon, full base, white background, no text) passed. No black/hazard armour on any syndicate figure.
GLBs for the 9 picks (thug-club, thug-pistol, gunman, heavy, fixer, bagman, civilian-a/b/c) were generated with the A settings (seed 1234, about 4 min each) and finalized at 1.8 in (civilians 1.7 in). Previews in `art/previews/`. None needed a retry. Colours are pale/blue-tinted in places (fixer face and gun render blue-grey).

## C. Audio (not verified by ear)
`public/assets/audio/sfx/*.ogg` (20), `public/assets/audio/music/*.ogg` (5), `public/assets/audio/manifest.json`, `public/sounds.html` (an `<audio controls>` per file, no title attributes). Raw FLAC variants: `art/raw/audio/<id>_1|2.flac`. Seed 777, 2 variants each. SFX: Stable Audio Open, 60 steps, guidance 6, negatives "music, voices, speech, singing, noise, low quality". Music: ACE-Step turbo, 8 steps, instrumental, D minor, 4/4, bpm 70/90/128/100/60. Prompts are in `tools/assets/audio-jobs.json`.
- Gunshot crest factor: raw model output was clipped and compressed (crest about 5). Not layered; I trimmed leading silence, applied a fast exponential decay envelope after the first 30 ms, limited to 0.5 and cut to the length. Measured crest after ogg encode: rifle 9.6, shotgun 9.4, revolver 8.2, pistol 26.6, suppressed long rifle 11.9, smg 8.5, lmg burst 8.9, frag explosion 9.7. All at or above 8. The decay envelope makes tails short and artificial; layering a real tail would be better if the owner dislikes it.
- Variant picks: best crest for gun ids, variant 1 otherwise, variant 2 for `alarm-siren-distant` and `ui-confirm` (less saturated). Choices were by measurement only.
- Music files are 75 s (calm, tense), 105 s (combat), 20 s (victory, defeat); loop seams not checked, loudness normalised to -18 LUFS.
- Not verified by ear: everything. Weak spots to check first: `maul-shock` (crest 5.8), `bullet-ricochet-miss` (crest 2, maybe a steady tone), `radio-chatter-short` (confirm no intelligible words), `ui-select`, loop points.
- `ffmpeg` 9.0.2 was available, so everything is `.ogg` (Vorbis).

## Other deliverables
`public/assets/models/manifest.json` lists the 17 models with `heightInches` and notes.

## GPU time
About 32 min (A) plus 8 min (A redo before the no-base order discarded a first 8-figure batch, about 22 min lost) plus 37 min (9 syndicate/civilian figures) plus 4 min (chem-trooper retry) plus about 3 min Flux plus about 4 min audio.

## Left over / not done
- Arbiter GLB (concept only, by brief).
- Texture re-grade for the pale Hunyuan paint, GLB optimisation (meshopt/WebP), per-unit yaw check (especially `k9-unit`).
- Audio by ear.
- `art/raw/` (about 100 MB of raw meshes and cutouts) can be deleted or gitignored; the Hunyuan studio's own job folders under the `3D Model Generation` repo's `outputs/` and the Flux/Audio studios' outputs were left untouched there.
