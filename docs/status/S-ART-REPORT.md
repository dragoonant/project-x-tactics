# S-art report: strategy layer art and audio

2026-11-09. Contract: `docs/spec/40-strategy-assets.md`. Output: `public/assets/strategy/` (3.8 MB, manifest.json per spec 40, every referenced file present). Review sheet: `docs/status/s-art/strategy-assets-sheet.png`; candidate sheets: `docs/status/s-art/candidates-*.jpg`.

Studios: Flux Studio (7880, FLUX.2 klein, 4 candidates per prompt, seed 4242) and Audio Studio (7890, Stable Audio Open for SFX, ACE-Step for music, seed 31337). GPU time about 7 minutes (images 235 s + 133 s, audio 51 s). Tools: `tools/strategy-art/` (`gen.mjs`, `audio.mjs`, `post.py`, `audio_post.py`, `final_sheet.py`, `jobs-*.json`, `picks*.json`).

## Images
All prompts end "wordless and untitled" and use no banned words.

- **Emblems (6, 512 px, transparent WebP).** Prompt shape: "Flat graphic stencil emblem, bold hazard-yellow shapes on a pure solid black background, centred ... A circular badge ring with a stencil-cut gap pattern, inside it <symbol>. Hard-edged, single colour, thick stencil bridges, symmetrical, municipal insignia." Symbols: docks gantry crane lifting a container over a stack; foundry cogwheel with flame and crossed tongs; spire tall antenna tower between two shorter towers; market striped stall awning, lantern, steaming bowl; stacks three apartment blocks with window grids; undercity arched tunnel mouth with converging rails and a warning lamp. Alpha is keyed from brightness and the colour is flattened to one hazard yellow so the set is consistent. Picks: docks 2, foundry 2, spire 4, market 2, stacks 2, undercity 2 (the thick-ring variants, so all six share ring weight; spire 4 over 2 because 2 drew onion-domed towers).
- **Skylines (6, 1024x512).** Night, rain, painted look, each with its own palette from the spec theme (docks teal and sodium orange, foundry furnace orange, spire cold blue, market pink and cyan neon with lanterns, stacks green and amber with laundry lines, undercity red emergency lamps). Cropped from 16:9 to 2:1. Picks: docks 3, foundry 1, spire 2, market 1, stacks 1, undercity 3 (clearest silhouettes, no corner scribbles).
- **Portraits (10, 768x1024, 3:4).** Prompt shape: "Grainy telephoto surveillance photograph, chest-up, of <adult, age, hair, clothing> ... Black and white with faint warm tint, film grain, soft focus, harsh flash". Characters use the syndicate look from `art/concepts` (oxblood coats, orange piping, masks and goggles). Post: greyscale, warm tint, vignette, added grain, off-white printed-paper border. Picks: kingpin 4, lt-arms 2, lt-narcotics 3, lt-protection 2, crew-1 1, crew-2 2, crew-3 3, crew-4 4, crew-5 4, crew-6 2 (serious expressions, clean faces and hands, distinct silhouettes).
- **Textures (1024).** `table` (candidate 2): near-black glass, thin cyan grid with faint circuit traces. `board` (`corkboard.webp`, candidate 2): top-down cork.

## Audio
- `strategy.ogg`: 99 s loop (ACE-Step, 96 bpm, D minor, "low pulsing analogue synth bass, slow deep percussion, sparse cold pad"). The generator returned 112 s with 8 s of silence at the end; the music was cut where it ends, the last 5 s crossfaded into the first 5 s and moved to the front, so the file's end continues into its start. Level at the seam checks out (about -20 dB both sides). Normalised to -20 LUFS.
- SFX (Stable Audio, 3 candidates each, silence trimmed, 0.2 s fade, -16 LUFS): `incident` 1.6 s (candidate 2), `week` 3.0 s (2), `takeover` 3.0 s (2), `district-fall` 4.0 s (1), `deploy` 1.9 s (1), `case-reveal` 2.0 s (1).

## Fell short
- **Audio was not listened to**; picks were made from duration, level and crest-factor numbers only. Candidates are not committed (alternates `_2`, `_3` live only in the studio output); re-run `node tools/strategy-art/audio.mjs <dir>` for new ones. Worth a quick listen in the morning, especially the SFX.
- Portraits lost the coat colour (black and white print look), so the oxblood link to the syndicate concepts is only in the tailoring and trim. Poses are all frontal and centred.
- Some skylines (market) contain pseudo-lettering on neon signs; it is unreadable at card size. The table texture keeps a mild vignette and the corkboard is a saturated orange; neither tiles seamlessly.
- Emblems are single-colour yellow: no district colour accent.
- The ComfyUI instance was stopped as a child of the Flux Studio process.
