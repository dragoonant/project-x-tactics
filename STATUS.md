# Status

**Milestone:** M2 done (the playable 3D board). M1 (engine, data, tests, tools) is done; M3 (syndicate AI) landed separately, see its report. Next: publish as an Artifact, M4 art and audio, M5 tools and polish.

## What exists
- `docs/spec/10-rules.md`: the rules spec with ids and 26 rulings.
- `src/engine/`: the pure rules engine. Movement, line of sight with peeking, light and fog, directional cover, hit and graze rolls, damage and Resolve, surrender, ripple, arrest and flight, overwatch, hunker, suppression, noise, Alarm and reinforcement waves, gas, civilians, destructible cover, downed troopers, all 7 classes' abilities, mission end, save envelope, random-legal-action policy for the syndicate.
- `src/data/`: `tuning.json`, `units.json`, `weapons.json`, `enemies.json`, `maps/bust-01.json`, schemas.
- `tests/`: Vitest suites named by rule id, a golden turn with forced dice, map checks for bust-01.
- `tools/`: `validate-data`, `sim` (random games with invariants), `action-fuzz`.
- `src/debug/` plus `debug.html`: the M1 top-down debug page with Step random, Run to end, New seed, seed field and event log.
- `src/client/` plus `index.html`: **the game** (M2). One persistent R3F canvas with the Night Market, bodycam HUD, start screen (Continue, squad picker, seed), End Turn with an animated syndicate phase, incident-report end screen, autosave and Continue, optional model and audio manifests, `window.__px` test hook. Details in `docs/status/M2-REPORT.md`.
- `tests/e2e/`: Playwright specs for smoke, rules 8, 22, 24, 25, 27, touch, turn flow, models, audio and a full game. `tests/client/`: unit tests for the pure client helpers.

## How to run
```
npm install
npm run dev                       # the game at http://localhost:5173 (debug page at /debug.html)
npm run e2e                       # Playwright (PW_PORT, default 5281)
npm test                          # engine + data tests
npm run typecheck
npm run validate:data
npm run sim -- --games 200        # invariants after every step
npm run fuzz -- --steps 20000     # legal and malformed actions
npm run build
```
Results of the last full runs are in `docs/status/M1-REPORT.md` and `docs/status/M2-REPORT.md`.

## What is next
- **Publish** `dist/` as a private claude.ai Artifact with its files (`base: './'` is set; checked from a deep path).
- **M4 art and audio:** drop `public/assets/models/manifest.json` (GLBs, optional `yaw` / `height`) and `public/assets/audio/manifest.json`; the client picks them up at build time. Wire the real SFX ids (see the M2 report).
- **M5 tools and polish:** tuning panel, roll-level combat log, device frame-rate check on a phone.
- Known gaps are listed in the M1 and M2 reports.
