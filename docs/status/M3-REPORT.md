# M3 report: syndicate utility AI

Status: **done, all gates green.** Branch `worktree-agent-acacf012fb50c0ad0`. `src/engine/` untouched; the seam `src/ai/index.ts` keeps its exports and contract (only the body of `syndicatePolicy` changed).

## What was built
| File | Role |
|---|---|
| `src/ai/index.ts` | the frozen seam: `Policy`, `syndicatePolicy = (s) => decideSyndicate(s).action` |
| `src/ai/syndicate.ts` | the decision: picks the acting unit, builds candidates, validates them with the engine's own `actionProblem`, returns the best. Also `decideSyndicate(s) -> { action, why }` ("Gunman flanks Marksman") for the client log, and a `stats` counter for the bench |
| `src/ai/score.ts` | tile evaluation (cover, exposure, flanks, open ground, gas, overwatch, range band) and shot valuation |
| `src/ai/weights.ts` | **every** weight, named, in one `weights` object |
| `src/ai/geo.ts` | tiny helpers: "unit placed on another tile", weapon lookups, seeded jitter |
| `src/ai/squad-bot.ts` | greedy squad policy for benches and sims only |
| `tools/ai-bench.ts` | the bench (`npm run bench:ai -- --games 200 [--seed] [--squad] [--det 8] [--only greedy-ai]`) |
| `tools/sim.ts` | new optional flags `--syn ai` and `--squadbot greedy` (defaults unchanged) so the invariant checker can run AI games |
| `tests/ai/policy.test.ts`, `tests/ai/behaviour.test.ts` | 20 tests |

## Design summary
One call returns one action. Each call takes the aware, active enemies that still have actions (Fixer first, Bagman last, otherwise by id), scores candidates for the first unit that has a valid one, and returns the best that `actionProblem(s, a)` accepts (so the result is always in `legalActions(s)`). The next call sees the new state, so "move, then shoot" is two consistent calls.

**Candidates per unit.** *Stand still* with a plan that ends the turn: shoot (best target), Suppress (Heavy), Overwatch (ranged units), Hunker. *Move* to any reachable tile; with two actions the tile is valued together with the best plan available from it (so a move that has a shot beats a move into the open, and a move with no shot is only chosen for cover or progress). Score = tile value + plan value.

**Tile value** (computed with the engine's own `hitBreakdown` and `coverAgainst` on a copy of the unit "standing there", for every trooper that can see the tile): cover first (mean best cover against the troopers that see it; a tile nobody sees counts as full cover plus a hidden bonus), expected incoming damage, flanked-by count, open ground, gas, a tile an overwatching trooper covers (when moving in), and the distance from the weapon's best range band. **Shot value:** expected damage, kill chance, finishing wounded troopers, flanked targets (no cover from our tile), target aim (dangerous shooters).

**Roles.** Fixer: Rally a surrendered ally in range before anything else (or walk to a low-exposure tile from which it can). Thug with a club: melee shot value plus a charge bonus, stronger progress weight, cover matters less. Heavy: Suppress is worth more than a plain shot unless a kill is likely, penalised on an already suppressed target. Bagman: before Alarm 7 he and his guards stay within 3 steps of where they stand, hold cover and shoot; once `fleeing` he takes the legal move that ends closest to the escape tile (a distance field from the van; reaching it escapes). Resolve <= 2: cover/hidden/exposure weights x2.2, shot values x0.3, no progress, so the unit retreats to cover (or hunkers) rather than attacks.

**Without a visible trooper.** Aware units head for the nearest fresh last-seen ghost (`view.lastSeen.syndicate`, at most 4 rounds old), otherwise for the extraction zone (static map data, "they cover your way out"); Bagman's guards just hold. They advance to cover and hold Overwatch rather than dashing twice.

**Fairness.** All perception reads `view(s, 'syndicate')`. A trooper outside syndicate sight is not in that view, so it is never targeted, never counted as a threat, and never moved toward (only its ghost is). The real state is used for three things only: validating the chosen action with `actionProblem`, `s.round`, and the tuning table. One minor, accepted channel: a candidate move onto a tile that a hidden trooper occupies is rejected by validation and the next-best candidate is used. Pure and deterministic: ties are broken by `jitter(seed, step, unit, tile)`, no `Math.random`, no clock.

**Deep imports.** The AI reads `hitBreakdown`, `coverAgainst`, `sees`, `hasLOS`, `bfs`/`distField`/`inCloud` from `src/engine/*` (read-only, no mutation). The public API has no "hit chance from a hypothetical tile" query; see the suggestion under Engine notes.

## Weights (`src/ai/weights.ts`)
Tile: cover 1.6, hidden 0.6, exposure 0.9, flankedBy 0.5, openGround 0.6, gas 3.0, overwatchTile 1.1, rangeOff 0.12 (cap 4 tiles), step 0.03, progress 0.35 (rushers 0.7). Shot: damage 1.0, kill 2.0, finish 1.2, flankedTarget 0.8, threat 0.8. Plans: overwatch 0.8, hunkerExposure 0.45, hunkerBase 0.2. Roles: charge 2.5, meleeTile 0.35, suppressBase 3.8, suppressExposure 1.6, suppressRepeat 3, lowResolve 2, lowResolveSafety 2.2, lowResolveShot 0.3, guardLeash 3, fixerMaxExposure 1.6, ghostMemory 4, jitter 0.02. Units are "damage points" (1.0 is about one point of expected Health damage).

## Bench (`npm run bench:ai -- --games 200 --det 10`, seeds 1..200, squads of 4, every fifth game 6)
| pairing (squad - syndicate) | win | partial | loss | stall | Bagman escaped | avg rounds | troopers downed | AI ms mean / max | fallbacks |
|---|---|---|---|---|---|---|---|---|---|
| random - random | 1% | 0% | 50% | 50% | 33% | 34.8 | 1.94 | n/a | n/a |
| random - AI | 0% | 0% | 100% | 0% | 93% | 5.2 | 1.83 | 0.39 / 2.2 | 0 |
| greedy - random | 31% | 60% | 3% | 7% | 2% | 13.7 | 0.45 | n/a | n/a |
| greedy - AI | 2% | 7% | 90% | 2% | 47% | 6.5 | 3.04 | 0.40 / 8.0 | 0 |

## Gate verdicts
| Gate | Result |
|---|---|
| AI beats random: squad-loss rate up by >= 20 points vs the greedy squad | **pass: 3% -> 90% (+87 points)**; squad wins 31% -> 2%, partials 60% -> 7% |
| 0 fallbacks (AI result outside `legalActions`, or random fallback) | **pass: 0** in all AI games (bench checks every decision against `legalActions`; the sim flags do too) |
| Deterministic (same seed, same game) | **pass**: first 10 seeds of each AI pairing replayed, identical action logs; also in `tests/ai/policy.test.ts` (3 seeds, plus a purity check that deciding does not mutate the state and a deep copy decides the same) |
| Max decision time <= 50 ms | **pass: 8.0 ms max** (0.4 ms mean) |
| `npm run sim -- --games 200` | 200 games, 82,354 steps, **0 invariant failures** (unchanged defaults: both sides random). `--syn ai --squadbot greedy` (100 games) and `--syn ai` (100 games): **0 failures**, every policy action inside `legalActions` |
| `npm run fuzz -- --steps 20000` | 20,000 steps, **0 throws / 0 violations** |
| `npm run typecheck`, `npm test` (157 tests), `npm run validate:data` | green |

Reading the numbers: the +87 points is far above the target, and 90% squad losses against a greedy bot looks harsh. About half of those losses are the Bagman getting away, not the squad dying. That is the engine's ENM-5: the Alarm rises by at least 1 a round plus 1 for each round with a loud shot, so he is fleeing by round 4-5, and a Bagman with Mobility 6 and two actions covers 12 tiles of the 12-tile run from his room to the van in one phase. The greedy squad is also a weak stand-in for a person (it runs straight at the Bagman, one trooper at a time, into Overwatch). So the table says "the AI is competent and plays its objective", not "the mission is balanced". Balance is an M5 / playtest question: the levers are `alarm.perRound`, `alarm.t2`, the Bagman's escape route length and the AI's `weights.flankedTarget` / `weights.suppress*`.

## Tests (`tests/ai/`, 20)
- **Contract:** a legal action at every syndicate decision of 8 full games (more than 100 decisions) and under 50 ms; same seed gives the same game; deciding is pure (no mutation, deep-copy equal).
- **Fairness:** in a dark hall a trooper more than 2 tiles from every enemy is not in the view, and its position (six different hidden placements) does not change the decision; the same trooper inside 2 tiles is seen and changes the decision; across a whole game nothing hidden is ever targeted.
- **Roles:** the Fixer rallies first even when a lower-id gunman has a shot, and walks into Rally range when it must; a club Thug moves next to a trooper then hits it, and closes distance when it cannot reach; a fleeing Bagman ends each move at the minimum escape distance among his legal moves, runs onto the van and escapes when in reach, and a calm Bagman stays in his room; shoots the finishable trooper; never targets a downed trooper; the Heavy suppresses a healthy exposed trooper; Resolve <= 2 does not attack.

## Engine notes
No engine bug found. Observations and suggestions (no code changed):
1. There is no public query for "what would my hit chance be from tile T" (the AI calls `hitBreakdown` and `coverAgainst` through deep imports on a copy of the unit). A `query.hitChanceFrom(s, attackerId, tile, targetId)` and `query.sightFrom` would let AI and client share it.
2. `view()` deep-clones the whole state (about 0.3 ms); fine for now, but a lean DTO would help the client too.
3. A fleeing Bagman can run from his room to the van in one phase (see above). Not a bug, but it decides how long the squad has.

## Known gaps
- Unaware groups still hold (R-1); there is no patrol. Aware units without a visible trooper or ghost head for the extraction zone, which implicitly tells them where the squad came in. If that feels like cheating, replace it with the last loud-noise position once the engine exposes noise events to the view.
- No lamp shooting, no use of doors (Breach is squad-only), no grenades; Gunmen never Suppress (only the Heavy has it).
- Enemies do not coordinate (no focus-fire plan, no covering fire for the Fixer beyond tile exposure); units act in id order, each greedily.
- The squad bot is intentionally simple (no regrouping, no Breach, no Call Support, no Pinning Shot / Shield Bash); do not read its win rates as a human's.
- Weights were set by reasoning and one tuning pass against the bench, not searched; no sensitivity study was run.
- `weights.suppress*` makes the Heavy suppress rather than shoot most of the time; whether that is better than shooting is not measured (the plan asks for it).

## Commands
```
npm run bench:ai -- --games 200 [--seed 1] [--squad 4] [--det 8] [--only greedy-ai]
npm run sim -- --games 200 [--syn ai] [--squadbot greedy]
npx vitest run tests/ai
```
