# Status

**Milestone:** M1 done (scaffold, spec, data, engine, tests, sim, fuzz, debug page). Next: **M2, the 3D board**.

## What exists
- `docs/spec/10-rules.md`: the rules spec with ids and 26 rulings.
- `src/engine/`: the pure rules engine. Movement, line of sight with peeking, light and fog, directional cover, hit and graze rolls, damage and Resolve, surrender, ripple, arrest and flight, overwatch, hunker, suppression, noise, Alarm and reinforcement waves, gas, civilians, destructible cover, downed troopers, all 7 classes' abilities, mission end, save envelope, random-legal-action policy for the syndicate.
- `src/data/`: `tuning.json`, `units.json`, `weapons.json`, `enemies.json`, `maps/bust-01.json`, schemas.
- `tests/`: Vitest suites named by rule id, a golden turn with forced dice, map checks for bust-01.
- `tools/`: `validate-data`, `sim` (random games with invariants), `action-fuzz`.
- `src/debug/` plus `index.html`: top-down debug page with Step random, Run to end, New seed, seed field and event log.

## How to run
```
npm install
npm run dev                       # debug page at http://localhost:5173
npm test                          # engine + data tests
npm run typecheck
npm run validate:data
npm run sim -- --games 200        # invariants after every step
npm run fuzz -- --steps 20000     # legal and malformed actions
npm run build
```
Results of the last full run are in `docs/status/M1-REPORT.md`.

## What is next
- **M2 3D board:** R3F board of the Night Market with stand-in figures, selection by tile, move ranges (`query.reachable`), attack preview (`query.preview`), fog (`view`), camera controls, save and Continue (`serialize`, key `px-save`), published as an Artifact. The engine is ready for it; keep rules maths out of the client.
- **M3 syndicate AI** replaces `randomAction` (`src/engine/policy-random.ts`).
- Known gaps are listed in the M1 report.
