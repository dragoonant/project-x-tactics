# S1 — Strategy layer, first pass (campaign spec, engine, clock sim, holo-table greybox)

Built overnight on 2026-11-09 by S1 in its own worktree, against the owner's answers of that day (`docs/DECISIONS-LOG.md`) and the frozen asset seam (`docs/spec/40-strategy-assets.md`). Scope: the clock sim plus a playable greybox. The case board, corps, fleet, facilities, the Arbiter and alignment are out of scope (seams only).

## What was built

- **Spec** `docs/spec/20-campaign.md`: 71 rule ids in 13 groups (CMP contract, WEEK, DIST, INC, TAKE, FUND, ROST, PROM, OPS mission bridge, AUTO auto-resolve, AAR after-action, END, CINV invariants) and rulings R-1 to R-11. Every number is a key under `tuning` in `src/data/campaign.json`, which also holds the district names, the district modifiers, the difficulty table, the variant slots, the raid cache tiles and the trooper names. `npm run validate:data` checks the file against its schema, checks that every variant fits the Night Market (slots on open floor, no overlaps, enough slots for the worst case), and checks that every `ctn(s, '...')` key the campaign engine reads exists. `tests/engine/coverage.test.ts` now fails if any spec-20 id appears in no test name.
- **Tactical variants** (spec 10, new section 18.1, VAR-1 to VAR-6, rulings R-27 and R-28): `setup.objective` `'bust' | 'raid'`, `setup.cache`, and `state.raid` (present only in raids). A raid's cache is seized when an active trooper stands within 1 tile of it after a squad action, and burns at Alarm 7. Win = seized plus the usual extract-or-clear clause; partial = burned plus that clause. The summary gains `objective` and `evidence`. The variant's map rides in `setup.mapData`, which was already a test hook, so the save and replay contract is unchanged. Busts behave exactly as before; every existing tactical test, the sim and the fuzz stay green. The squad bot heads for the cache in raids.
- **Campaign engine** `src/campaign/`, built on the tactical engine's contract: a pure `createCampaign` / `stepCampaign` (never throws; `{ ok: false, reason }`), `legalCampaignActions` (never empty while running: `endWeek` or `abort`), `campaignQuery.*` for every number the UI shows, plain-JSON state with its own sfc32 RNG (the tactical generator), events with roll breakdowns, and the versioned `serializeCampaign` / `deserializeCampaign` / `replayCampaign`.
  - The week: 2-3 incidents (bust or raid) in different standing districts, plus a Retake in a fallen district and the Kingpin once Intel reaches 110. One mission a week, by deploy or auto-resolve. At the end of the week: ignored incidents cost Order, injuries heal, the Takeover advances every second week, the final countdown runs, and Funding plus patrol recovery come every fourth week.
  - Districts with Order 0-5; a district falls at 0 (+2 Takeover, no Funding, an extra Gunman in its missions).
  - The roster: 6 Recruits, injuries (downed 3 weeks, wounded 1 week), deaths, recruiting (40), treatment (30), XP and ranks; promotion from rank 2 into the six specialties, and the class each trooper deploys as on the tactical map.
  - The **mission bridge** `bridge.ts`: `incidentSetup` builds the Night Market variant (difficulty row, district modifier, turf, objective; seed from the incident), and `resultFromTactical` turns the finished tactical state into a campaign result (outcome, Intel, Evidence, arrests per trooper from the Cuff actions in the log, dead, downed, Health).
  - **Auto-resolve**: squad strength (base + rank + specialty) against a difficulty threshold, a d100 for win / partial / loss, then per-trooper death and injury rolls, arrests, Intel, Evidence and a possible civilian casualty, all in the event breakdown.
  - Bot policies `random`, `greedy` and `average` in `policies.ts` (sim only).
- **Clock sim** `npm run sim:campaign -- --campaigns 500 [--seed 1] [--policy average|greedy|random|all] [--deploy N] [--tune JSON]`: CINV-1..5 after every step, the save round trip every 40 steps, and a full replay at the end of every campaign. `--deploy N` plays every Nth mission for real on the tactical map (squad bot against the syndicate AI) through the bridge. **Campaign fuzz** `npm run fuzz:campaign -- --steps 20000`: random legal, malformed and illegal actions, including deployments answered with random (valid and invalid) mission reports.
- **Greybox UI** `src/client/campaign/`:
  - The start screen has a **Campaign** section: New campaign, Continue campaign (names the week, the Takeover, Funding, Intel, roster and save time; "squad deployed" if a mission is running), Discard (asks again), and a corrupt save says why. The single-operation entry is unchanged.
  - The **holo-table city** sits in the same R3F canvas as the board: six district plates on a 3 x 2 table, procedural wireframe skylines per district, Order pips, incident markers (amber bust, blue raid, red retake, magenta kingpin), labels, the S-art emblems and table texture when the manifest has them, plain geometry and a grid when not. Tapping a plate selects its incident (rule 25: one pick plane, labels ignore the pointer).
  - The **HUD**: the dispatch bar (week, Funding with the next payment, Intel with the Kingpin threshold, Evidence, ready troopers), the 12-segment **Takeover track** with the next advance or the final countdown, the incident list, and the **brief**: the district skyline image, variant notes, squad picker, auto-resolve odds with strength and threshold, then DEPLOY or AUTO-RESOLVE.
  - The **after-action report**, the **roster** (rank, XP to next, missions, arrests, status; promote, treat, recruit), the end-of-week confirmation when incidents would be ignored, and the **campaign end** screen (won or city lost, with the summary).
  - **Deploying** starts the variant on the board with the roster's names as call-signs, a RAID or BUST objective line, a cache crate marker, and a two-step WITHDRAW (counts as a loss; injuries so far stand). The result reaches the campaign the moment the mission ends, so a reload on the end screen cannot replay it; RETURN TO THE CITY opens the report.
  - Saves follow rule 22: `px-campaign` is written before the first render and after every accepted action, and cleared when the campaign ends. A running campaign mission has its own slot, `px-campaign-mission`, so the single-operation Continue never offers it, and Continue campaign reopens the same mission on the board.
  - Strategy music and the six cues play if the manifest lists them, following mute and volume.
  - The phone layout (390 x 844) puts the table in the upper half and a bottom sheet for incidents and the brief.

## Calls made (no owner input; each can be reversed)

| # | Call | Why |
|---|---|---|
| S1-1 | **Monthly patrol recovery** (DIST-6, R-11): every fourth week, standing districts under Order 3 gain 1, up to 3. | With 2-3 incidents a week and one mission, about 1.5 incidents go ignored every week. Without a way back, the sim had 4 of 6 districts falling in every campaign, average policy included (average: 84% lost). |
| S1-2 | **The Kingpin unlocks at 110 Intel** (R-2) as the stand-in for "2 of 3 Lieutenants down". | The case board is out of scope; Intel is its currency. 110 puts the Kingpin in weeks 18-24 for the average policy, matching design 8's endgame. |
| S1-3 | **Raids spawn by chance (15%)** instead of from leads (R-1). | No case board yet; raids are the regular way to push the clock back. |
| S1-4 | **A raid is the Night Market with an evidence cache** (VAR, R-5, R-27): seize it before Alarm 7, then extract or clear; a Gunman stands where the Bagman was. | Cheapest real second objective, and it stays on the existing map, terrain and AI. Rescue was not cheap (civilians are engine-driven), so it is not in this pass. |
| S1-5 | **Variants never change walls or cover** (R-28), only units, lamps, civilians and tuning. The map keeps the id `bust-01`. | The terrain and props are drawn for `bust-01`; a lamp missing from a variant shows as a dead lamp. |
| S1-6 | **District modifiers**: docks rain (dark tiles seen from 1 tile), foundry an extra Heavy, spire corporate alarms (first threshold at Alarm 3), market 3 more civilians, stacks 2 lamps out, undercity 3 lamps out. Fallen districts add a Gunman. | One readable twist per district, each a data change. |
| S1-7 | **Withdraw counts as lost, and injuries taken so far stand.** The engine's `abort` (R-8, no harm) is kept only for a mission that cannot be restored. | Withdrawing should not be a free escape from a bad mission. |
| S1-8 | **A campaign mission reports the moment it ends**, before the end screen shows. | Rule 22: a reload on the end screen must not replay the mission. |
| S1-9 | **The countdown does not stop** once started, even if a raid pushes the track below full (R-3). | Otherwise the last weeks become a raid farm. |
| S1-10 | **Rank only counts for auto-resolve** (R-6). Tactical stats stay per class. | Rank perks belong to the promotion trees (design 3.2), which are not in this pass. |
| S1-11 | **Auto-resolve is tuned to the design target, not to the squad bot.** | The greedy squad bot wins 2% of plain Night Market games (`npm run sim -- --games 100 --syn ai --squadbot greedy`) and 4% of campaign variants, so it is a poor model of a player. Auto-resolve odds come from the clock sim's target instead (below). |
| S1-12 | **Decisions are logged here, not in `DECISIONS-LOG.md`.** | The coordinator merges that file from several builders; this keeps the merge clean. Copy any row across as wanted. |

## Clock sim (`npm run sim:campaign -- --campaigns 500`, seeds 1-500 per policy)

| policy | won | lost | stalled | Takeover at end (avg %) | Takeover when won (avg %) | won ending in 70-90% | weeks (avg) | missions (avg) | mission wins | districts fallen (avg) | troopers lost (avg) | promotions (avg) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| random | 1% | 99% | 0% | 97.4 | 95.8 | 17% | 16.2 | 11.1 | 52.0% | 4.31 | 1.23 | 4.0 |
| greedy | 48% | 52% | 0% | 93.3 | 86.9 | 27% | 20.4 | 20.4 | 81.3% | 2.59 | 0.78 | 4.2 |
| **average** | **78%** | **22%** | 0% | **79.1** | 74.3 | 36% | 22.6 | 22.5 | 77.2% | 0.89 | 1.13 | 5.9 |

74,581 steps in 9.9 s, **0 invariant failures** (CINV-1..5 every step, the save round trip every 40 steps, a full replay per campaign).

How it got here (each a `--tune` run of 300 campaigns, average policy): first numbers: 96% won at 33% Takeover (far too easy); harder auto-resolve plus Kingpin at 100 Intel: 16% won at 94% with 4 districts falling (a collapse); with patrol recovery (S1-1): 90% won at 61%; raids at 15% and Kingpin at 110: 77-80% won at 77-79%.

- **Average** (protects the weakest district, chases something else 1 week in 5, saves Funding for replacements, takes the Kingpin at even odds or when time is short): ends with the Takeover at about **79% full**, inside the design's 70-90% target, after about 22 weeks and 22 missions (design: 20-25). Most campaigns are won and about one in five is lost.
- **Greedy** (spends everything and always takes the incident with the best odds) wins less often: it neglects the districts that are slipping, so more fall and the clock runs out.
- **Random** loses almost every campaign, as it should.
- Integration check with real tactical games: `npm run sim:campaign -- --campaigns 10 --policy average --deploy 3` played 52 deployed missions through the bridge with 0 invariant failures (the squad bot won 4% of them, see S1-11).

## Gates (final commit)

| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | 19 files, **303 tests passed** (spec 10 coverage incl. VAR-1..6, spec 20 coverage: all 71 ids in test names) |
| `npm run validate:data` | OK (now includes `campaign.json`, its variant cross-checks and every `ctn` key) |
| `npm run sim -- --games 200` | 85,641 steps, **0 invariant failures** (win 0, loss 70, stalled 130: random squads, same shape as the M1 baseline) |
| `npm run fuzz -- --steps 20000` | 0 throws / internal errors / violations |
| `npm run sim:campaign -- --campaigns 500` | 1,500 campaigns, 74,581 steps, **0 invariant failures** (table above) |
| `npm run fuzz:campaign -- --steps 20000` | 16,740 accepted, 2,938 rejected, 323 campaigns, **0 errors** |
| `npm run build` | OK |
| `PW_PORT=5391 npm run e2e` | **41 passed**, 5 skipped (the `PX_SHOTS` screenshot specs); `tests/e2e/campaign.spec.ts` adds a full week with auto-resolve, a deployed raid that returns to the city, Continue after reload (city and mid-mission) plus Withdraw and a corrupt save, tapping a district plate, and the 390 x 844 phone layout |

## Screenshots (`docs/status/s1/`, regenerate with `PX_| File | What |
|---|---|
| `s1/start.png` | The start screen after a finished campaign (its save is cleared, so only New campaign shows) above the single operation |
| `s1/city-brief.png` | Week 1: the holo-table, dispatch bar, Takeover track and the brief (district skyline, variant notes, squad picker, odds) |
| `s1/city-map.png` | The incident list and the table with markers, Order pips and emblems |
| `s1/after-action.png` | An auto-resolved after-action report |
| `s1/roster.png` | The roster in week 6: ranks, specialists, injuries, a trooper killed in action |
| `s1/city-week6.png` | The city in week 6 (Order changed, Takeover moving) |
| `s1/deployed-variant.png` | A deployed raid on the Night Market: roster names as call-signs, the RAID objective and WITHDRAW |
| `s1/after-action-deployed.png` | Back in the city after that raid (partial: the cache burned) |
| `s1/campaign-end.png` | City lost: the campaign end summary |
| `s1/phone-city.png`, `s1/phone-brief.png`, `s1/phone-roster.png` | Phone, 390 x 844 |=1 npx playwright test tests/e2e/s1-screens.spec.ts`)

| File | What |
|---|---|
| `s1/start.png` | The start screen after a finished campaign (its save is cleared, so only New campaign shows) above the single operation |
| `s1/city-brief.png` | Week 1: the holo-table, dispatch bar, Takeover track and the brief (district skyline, variant notes, squad picker, odds) |
| `s1/city-map.png` | The incident list and the table with markers, Order pips and emblems |
| `s1/after-action.png` | An auto-resolved after-action report |
| `s1/roster.png` | The roster in week 6: ranks, specialists, injuries, a trooper killed in action |
| `s1/city-week6.png` | The city in week 6 (Order changed, Takeover moving) |
| `s1/deployed-variant.png` | A deployed raid on the Night Market: roster names as call-signs, the RAID objective and WITHDRAW |
| `s1/after-action-deployed.png` | Back in the city after that raid (partial: the cache burned) |
| `s1/campaign-end.png` | City lost: the campaign end summary |
| `s1/phone-city.png`, `s1/phone-brief.png`, `s1/phone-roster.png` | Phone, 390 x 844 |

## Known gaps

- **Greybox look.** The skylines are procedural wireframes; the S-art emblems, skylines and table texture are used, but the portraits and the corkboard wait for the case board.
- **Auto-resolve and the tactical game are not calibrated against each other.** There is no competent squad bot to measure tactical win rates with, so a player's deployed missions may go better or worse than the odds the brief shows.
- **No rescue objective**, and no per-district maps: every incident is a Night Market variant.
- **Rank has no tactical effect**, and there are no promotion trees, gear, facilities or corp Standing.
- **Intel and Evidence are only tracked.** Intel unlocks the Kingpin and nothing spends either.
- **One squad and every district reachable.** There is no fleet.
- **Strategy audio is not verified by ear** (rule 9).
- **The holo-table camera is fixed** (a slow sway, no orbit or zoom): rule 27's mouse map applies to the tactical board, not to the city map.

## Next steps

- **Case board** (design 5.4): turn Intel into reveals on the board (the portraits are in the manifest under `portraits/`), Lieutenants with rackets that modify incidents (better guns: difficulty +1; bribed officials: Funding -X; informants: ambush variants), leads that unlock Raids and Takedowns, and the Kingpin unlocking on "2 of 3 Lieutenants down" instead of the Intel threshold (R-2). Seams: `campaignQuery.kingpin`, the `role` field on incidents, and `INC-2` (raid spawning).
- **Corps** (design 6): a `standing` record per corp and districts' `patron` (already in data) driving Standing from Order; corp Contracts as a third incident role.
- **Fleet** (design 5.5): a `reachable` flag per district in `spawnIncidents`; incidents in uncovered districts appear but `missionProblem` refuses them.
- **Facilities**: an Infirmary (injury weeks), Barracks (squad size 5-6), and a Comms Room (one more incident a week) map straight onto existing tuning keys.
- Re-run `sim:campaign` after each of these; the tuning keys are all in `campaign.json`.
