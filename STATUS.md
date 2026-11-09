# Status

**Milestone:** M1 to M4 done, plus the art rollout (rigged and animated figures, real terrain), plus **S1: the strategy layer's first pass** (campaign spec, engine, clock sim, holo-table greybox; `docs/status/S1-REPORT.md`). The playtest is published as a private claude.ai Artifact (`npm run build:artifact`). Next: owner playtest round 1, then M5 tools and polish.

## What exists
- `docs/spec/10-rules.md`: the rules spec with ids and rulings. `docs/spec/30-figures-anim.md`: the frozen asset contract for figures, clips, items and terrain.
- `src/engine/`: the pure rules engine (movement, line of sight with peeking, light and fog, directional cover, hit and graze, damage and Resolve, surrender, arrest and flight, overwatch, suppression, noise, Alarm and reinforcements, gas, civilians, destructible cover, downed troopers, all 7 classes' abilities, save envelope).
- `docs/spec/20-campaign.md`: the campaign rules spec (weeks, districts and Order, incidents, the Takeover, Funding, roster, promotion, the mission bridge, auto-resolve). Spec 10 section 18.1: Night Market variants (the raid objective).
- `src/campaign/`: the pure campaign engine (`createCampaign`, `stepCampaign`, `legalCampaignActions`, `campaignQuery`, save `px-campaign`), the mission bridge to the tactical engine, and the sim's bot policies.
- `src/ai/`: the syndicate utility AI (M3), reading only `view()`.
- `src/data/`: `tuning.json`, units, weapons, enemies, `maps/bust-01.json`, `campaign.json` (campaign tuning, districts, variants), schemas.
- `src/client/`: the game. R3F Night Market, bodycam HUD, start screen with Continue and squad picker, autosave, audio, `window.__px` test hook.
  - `src/client/campaign/`: the campaign: holo-table city in the same canvas, incident brief, auto-resolve or deploy, after-action report, roster, Takeover track, campaign end; reads the optional `public/assets/strategy/manifest.json`.
  - `src/client/anim/`: the animation director. It plays clips from `public/assets/anim/manifest.json` and falls back to the static figure per kind.
  - `src/client/board/terrain/`: terrain v2 (default; `?terrain=v1` for the old boxes).
- `public/assets/`: 17 static figures (`models/`), 16 rigged figures with 17 clips and 14 items (`anim/`), terrain textures and 14 props (`terrain/`), 20 SFX and 5 music tracks (`audio/`, listen at `sounds.html`).
- `src/lab/` plus `figure-lab.html`: plays every clip of every rigged figure.
- `src/debug/` plus `debug.html`: the M1 top-down debug page.
- `tests/`: Vitest suites named by rule id plus client helpers; `tests/e2e/`: Playwright specs.
- `tools/`: `validate-data`, `sim`, `action-fuzz`, `ai-bench`, `pack-artifact.mjs` (GLB to `.gltf.json` for the Artifact host), `anim/` (the rigging pipeline).

## How to run
```
npm install
npm run dev                       # the game at http://localhost:5173 (debug page at /debug.html)
npm test
npm run typecheck
npm run validate:data
npm run sim -- --games 200
npm run fuzz -- --steps 20000
npm run sim:campaign -- --campaigns 500   # campaign clock sim (random, greedy, average policies)
npm run fuzz:campaign -- --steps 20000
npm run e2e                       # Playwright (PW_PORT, default 5281)
npm run build:artifact            # dist/ for the claude.ai Artifact
```
Reports: `docs/status/M1-REPORT.md`, `M2-REPORT.md`, `M3-REPORT.md`, `ASSETS-REPORT.md`, `A0-REPORT.md`, `A1-REPORT.md`, `A3-REPORT.md`, `T0-REPORT.md`, `T1-REPORT.md`, `S1-REPORT.md`. Calls made on the owner's behalf: `docs/DECISIONS-LOG.md`.

## What is next
- **Strategy, next pass:** the case board (Lieutenants, leads that unlock raids, the backer slot), corps and Standing, the fleet's response range, facilities, promotion trees (`docs/status/S1-REPORT.md`, next steps). Publishing the strategy layer as an Artifact waits for the owner.
- **Playtest round 1** by the owner (Copy report from the end screen).
- **Art follow-ups:** items in the figures' paint style, the Enforcer's baton and backpack, a clearer `point` for Recon and Fixer, the Arbiter pick (`art/contact/arbiter.png`).
- **M5:** tuning panel, roll-level combat log, seeded replays, Copy report polish.
- **v2:** the Arbiter (`docs/PROTOTYPE-PLAN.md` section 11).
