# M1 report: scaffold, spec, data, engine

Status: **done, all gates green.** Two commits on `main` (`701777c` engine, data, tools; `0adaa86` tests, debug page, docs).

## What was built
- **Stack:** `package.json` (sibling versions, `ajv` added), strict `tsconfig.json`, `vite.config.ts` (`base: './'`), `playwright.config.ts` (`PW_PORT`, default 5281), `index.html`, `CLAUDE.md`, `STATUS.md`. `npm install` ran once; Chromium for Playwright 1.63 was installed once for the screenshot.
- **Engine (`src/engine/`, no DOM or three.js):** `types`, `rng` (sfc32 + forced-roll hook), `util` (`tn()` tuning lookup), `grid` (tiles, 8-direction BFS with the no-corner-cutting rule, distance fields), `los` (supercover lines, peeking, lamp and spotlight light), `fog` (`sees`, shared sight, Drone Scan, Squadsight, `view`), `cover` (directional cover, Riot Shield, destructible cover), `combat` (hit breakdown, attack resolution, stray shots, frag), `resolve` (damage and Resolve, surrender, ripple, cuff, flight, rally), `noise` (groups, noise, Alarm, waves), `gas`, `civilians`, `enemies` (unit factories), `move` (movement, doors, overwatch and suppression reactions), `abilities` (validation and execution of all attacks and abilities), `phase` (phase start/end, end of round), `mission` (outcomes, summary), `setup` (`createGame`, map loading), `step`, `legal`, `query`, `save`, `policy-random`, `invariants`, `index`.
- **Data (`src/data/`):** `tuning.json` (every spec number), `units.json` (7 classes), `weapons.json` (bands, falloff, maxRange), `enemies.json`, `maps/bust-01.json` (22x22 Night Market, editable rows plus lists), five JSON schemas.
- **Tools:** `validate-data` (schemas, cross-references, bust-01 sanity, and a scan that every `tn(s, 'key')` in the engine exists in `tuning.json`), `sim`, `action-fuzz`.
- **Debug page:** `src/debug/main.tsx` + `debug.css` (owner CSS block verbatim, no `title` attributes). Top-down SVG with tiles, cover, lamps and lit/dark shading, doors, units by side, gas, smoke, scans, extraction zone; round, phase, Alarm, outcome; Step random, Run to end, New seed, seed field, scrolling event log. It only shows state and `query.*` numbers.
- **Screenshot:** `docs/status/m1-debug.png` (debug page after Run to end, seed 1; that game stalled at the round cap with all lamps shot out, hence no lit tiles).

## Tests
`npm test`: **137 tests in 8 files, all passing.** Files: `core` (ARCH, SAV, TURN), `world` (MOVE, LOS, LGT, FOG, COV), `combat` (HIT, DMG, RES, ARR, DWN), `rules` (OW, HNK, SPR, NOI, ALM, GAS, CIV, DST), `abilities` (ABL, SUP, ENM, MSN, INV), `golden`, `coverage`, and `tests/data/map.test.ts`. Names carry rule ids; `coverage.test.ts` reads the spec and fails if any rule id appears in no test name (138 ids covered). Nearly all tests drive real `step()` calls; a few use `query.*`, `coverAgainst`, `lineClear`, `hasLOS` and `blocksSight` directly for geometry.
- **Golden turn** (`golden.test.ts`): a worked round on a hand-built map with `state.forcedRolls = [30, 3, 70, 4]`: Mark, a hit at 60% (roll 30, damage 3, Resolve 1 to 2 to 4), a graze return shot (roll 70) on a flanked trooper, end of round; asserts the exact event-kind sequence and every number, then replays the log to the identical state.
- **bust-01 map tests:** squad start reaches the Bagman's back room through the front door (back door walled off) and through the back alley (front door walled off), and a route that touches no lit tile exists; every spawn, exit, escape, extraction tile, civilian and enemy start is reachable; lamps light patrol and civilian tiles and over 75% of market floor; the west alley, back alley and squad start are dark; both doors walled off seals the room.

## Gates
| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | 137 passed |
| `npm run validate:data` | OK |
| `npm run sim -- --games 200` | 200 games (seeds 1-200, squads of 4, every fifth game 6), 82,354 steps, 66 s. **0 invariant failures** (INV-1..5 per step, INV-5 replay at game end). Outcomes: win 1, partial 0, loss 99, stalled at 40 rounds 100 (INV-6: reported, not failures). Peak Alarm 10 in every game on average, 139 arrests, 1,400 kills, 18 civilian casualties, 388 troopers downed. |
| `npm run fuzz -- --steps 20000` | 20,000 steps over 33 games: 12,493 accepted (2,579 of them mutated but still legal), 7,507 rejected, **0 throws, 0 internal errors, 0 violations** (every legal action accepted, rejected actions never mutate the input, surely-illegal actions never accepted, invariants hold). |
| `npm run build` | OK (debug page bundle 242 kB) |

Random-vs-random play almost never wins (the Bagman has to be cuffed); the outcome table is a coverage tool, not a balance result.

## New rulings (R-4 to R-26, all in spec section 21)
R-4 engine-driven moves never trigger reactions; R-5 wave spawn point round-robin and nearest free tiles; R-6 explosions smash lamps; R-7 graze halving before the flank bonus; R-8 stray civilian hit is in addition to miss effects; R-9 melee takes HIT-2 modifiers, ignores cover for chance, no chip or stray on a melee miss; R-10 Resolve multipliers apply to attacks with Health damage only; R-11 weapon range bands, falloff and `maxRange` values; R-12 free Cuff needs an able unit; R-13 only active units see, Drone Scan does not enable attacks; R-14 ripples never chain at all; R-15 which actions wake a group (damage yes, gas and Mark no); R-16 a surrendered Bagman bolting through an exit escapes; R-17 outcome precedence; R-18 area damage kills downed troopers; R-19 bonus actions can revive a spent unit; R-20 `legalActions` is empty after the game ends; R-21 sim replay check once per game, round trip every N steps; R-22 policy picks a category uniformly then an action, sim end-phase chance 8%; R-23 forced rolls are final results, `setup.mapData` and `setup.forcedRolls` test hooks; R-24 only ranged armed units overwatch; R-25 Breach adjacency and targeting; R-26 what `view()` hides.

## Known gaps
- No patrol movement or utility AI (M3): unaware groups hold, aware syndicate units act randomly. Random play makes half the sim games stall at the 40-round cap.
- Overwatch triggers on moves only (not on other actions); there is no reaction to being shot at beyond SPR-1.
- Dash is two Move actions with no combined 2-action reach tile list in `query.reachable` (one-action reach only).
- Bulwark facing for an attack at a diagonal picks the dominant axis (ties go to x).
- `view()` returns a full `State`-shaped object with hidden units removed; a lean client DTO is an M2 decision.
- Tuning is read once into `state.tuning` at `createGame`; there is no live-edit API yet (M5 tuning panel).
- The debug page is a god view; it does not draw fog or ghost markers.

## Commands
```
npm install
npm run dev                         # debug page
npm test
npm run typecheck
npm run validate:data
npm run sim -- --games 200 [--seed 1] [--squad 4] [--end 0.08]
npm run fuzz -- --steps 20000 [--seed 1]
npm run build
npx vitest run tests/engine/golden.test.ts   # the golden turn alone
```
