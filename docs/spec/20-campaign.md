# 20 — Campaign Rules Spec (strategy layer, first pass)

The rules of the strategy layer's first pass: the weekly clock, the six districts and their Order, incidents, the Takeover, Funding, the roster with injuries, XP and promotion, the mission bridge into the tactical game, and auto-resolve. Same format as [10-rules.md](10-rules.md): stable ids, tests named by id (`tests/engine/coverage.test.ts` fails if an id here appears in no test name), and every ambiguity logged in section 13 as `R-n | rule | what we did | why`.

Source documents: [GAME-DESIGN.md](../GAME-DESIGN.md) sections 3.1–3.2, 4.9, 5 and 8; the owner's answers of 2026-11-09 in [DECISIONS-LOG.md](../DECISIONS-LOG.md); the asset seam [40-strategy-assets.md](40-strategy-assets.md). Where this spec and the design doc disagree, this spec wins. Every number in `code` is a key under `tuning` in `src/data/campaign.json` (default shown); the campaign engine reads numbers only through `ctn(state, 'key')`, and `npm run validate:data` checks every key it reads exists. District names, modifiers, the difficulty table, unit slots, cache tiles and trooper names are data in the same file.

**Out of scope for this pass** (seams only): the case board (5.4; Intel only gates the Kingpin), the strategic fleet (5.5; every district is reachable), facilities (5.7), the Arbiter (3.0, 5.8), corps and Standing (6; districts carry a placeholder patron), alignment (7), a second squad, promotion trees.

---

## 0. Engine contract (CMP)

- **CMP-1** `createCampaign(setup) -> CampaignState`. `setup = { seed: number, tuning?: DeepPartial<CampaignTuning> }`. It builds the six districts, the starting roster and week 1's incidents.
- **CMP-2** `stepCampaign(state, action) -> { ok: true, state, events } | { ok: false, reason }`. Pure: never mutates its input, never throws (a bad action returns `ok: false` with a readable reason).
- **CMP-3** `legalCampaignActions(state) -> CampaignAction[]`. Never empty while the campaign runs: `endWeek` is always legal in the `week` phase and `abort` in the `deployed` phase. Squad-taking actions are listed with the default squad (`campaignQuery.defaultSquad`); any other valid squad is also accepted by `stepCampaign`.
- **CMP-4** `campaignQuery.*` computes every number the UI shows (auto-resolve odds with breakdown, the Takeover track, the next Funding payment, district Order, trooper rank progress, costs, the after-action report, the end summary). The UI never does rules maths.
- **CMP-5** State is **plain JSON** (no classes, Maps, Sets, functions or `undefined` values).
- **CMP-6** Randomness comes only from an sfc32 RNG whose state lives in `state.rng`, seeded from `setup.seed` (the tactical engine's generator). Same seed + same actions = same campaign. Each incident's tactical seed is drawn from it.
- **CMP-7** Every roll emits an event with its full breakdown (inputs, chance, the d100 roll, outcome). Every change to Order, the Takeover, Funding, Intel, Evidence and the roster emits an event.
- **CMP-8** `state.log` keeps the accepted action list.
- **CMP-9** `serializeCampaign(state)` returns `{ v: 1, kind: 'px-campaign', setup, seed, actions, state }`; `deserializeCampaign` restores the snapshot and rejects an unknown version or a malformed envelope with a reason (never throws); `replayCampaign(setup, actions)` reproduces the state.

## 1. The week (WEEK)

- **WEEK-1** The campaign runs in weeks from week 1. Phases: `week` (the city map: incidents are open, the roster can be managed), `deployed` (a tactical mission is running), `over`.
- **WEEK-2** One mission per week (`week.missions`, 1): once an incident is resolved (auto-resolve or a mission report), no other incident can be taken until the next week.
- **WEEK-3** Management actions (promote, recruit, treat) are legal at any time in the `week` phase, before or after the week's mission.
- **WEEK-4** `endWeek` resolves, in order: (1) ignored incidents (INC-5); (2) injuries tick (ROST-4); (3) the scheduled Takeover advance (TAKE-2); (4) the final countdown (TAKE-5); (5) in a Funding week, patrol recovery (DIST-6) and then Funding (FUND-2); (6) unless the campaign is over, the week number goes up by 1 and the new week's incidents spawn (INC-1).
- **WEEK-5** Stall cap: if the week number would pass `week.max` (40), the campaign is lost ("the case went cold"); the sim reports it as a stall.

## 2. Districts and Order (DIST)

- **DIST-1** Six districts with the fixed ids of spec 40 (`docks foundry spire market stacks undercity`), each with Order 0–`order.max` (5) starting at `order.start` (3), a placeholder corp patron and a district modifier (OPS-4). Display names are placeholders in data.
- **DIST-2** Order changes after a mission in the district: win +`order.win` (1), partial +`order.partial` (0), loss −`order.loss` (1), and −`order.casualty` (1) more if any civilian died; an ignored incident costs −`order.ignored` (1) (INC-5). Order is clamped to 0–max.
- **DIST-3** A fallen district's Order stays 0 and changes only by a retake (DIST-5).
- **DIST-4** A district whose Order reaches 0 **falls** at once: the Takeover +`takeover.fall` (2), it pays no Funding, and its incidents carry the `turf` modifier (an extra Gunman).
- **DIST-5** **Retake:** while any district has fallen, one Retake incident spawns each week in a fallen district (the lowest district index first). Winning it restores the district at Order `order.retake` (2) and pushes the Takeover back `takeover.retake` (1). A partial or a loss changes nothing for the district.
- **DIST-6** **Patrols:** at the end of every week whose number is a multiple of `funding.periodWeeks` (4), each standing district under Order `order.recoverTo` (3) gains `order.recover` (1), up to that value.

## 3. Incidents (INC)

- **INC-1** At the start of each week, `incidents.base` (2) incidents spawn, plus 1 more if a d100 roll is under `incidents.thirdChance` (50). Each goes to a different standing (not fallen) district, chosen uniformly; with fewer standing districts, fewer incidents spawn.
- **INC-2** Each regular incident is a **raid** if a d100 roll is under `incidents.raidChance` (15), else a **bust**.
- **INC-3** Retake (DIST-5) and Kingpin (END-2) incidents come on top of INC-1's count. A Retake is a raid; the Kingpin is a bust.
- **INC-4** Difficulty 1–`difficulty.max` (5) = `difficulty.base` (1) + floor(Takeover / `difficulty.perTakeover` (3)) + a roll of 0–`difficulty.spread` (1); a Retake adds `difficulty.retake` (1); the Kingpin is `difficulty.kingpin` (5). Clamped to 1–max.
- **INC-5** Every regular incident still open when the week ends is **ignored**: its district loses Order (DIST-2). Ignored Retake and Kingpin incidents cost nothing.
- **INC-6** Each incident carries a tactical seed drawn from the campaign RNG when it spawns (CMP-6), so a deployed mission is reproducible.

## 4. The Takeover (TAKE)

- **TAKE-1** A track of 0–`takeover.segments` (12) segments, starting at `takeover.start` (0). It never leaves that range.
- **TAKE-2** **Scheduled:** +`takeover.scheduled` (1) at the end of every week whose number is a multiple of `takeover.everyWeeks` (2).
- **TAKE-3** +`takeover.fall` (2) when a district falls (DIST-4); +`takeover.kingpinFail` (1) when a Kingpin mission is not won.
- **TAKE-4** **Pushed back:** a won raid −`takeover.raid` (1); a won Retake −`takeover.retake` (1) (a Retake is a raid: both apply).
- **TAKE-5** **Final countdown:** at the end of a week, if no countdown runs and the track is full, a countdown of `takeover.countdown` (3) weeks starts. At each later end of week it drops by 1 (before the full-track check); at 0 the city is lost (END-3).

## 5. Funding, Intel and Evidence (FUND)

- **FUND-1** Funding starts at `start.funding` (120) and never goes negative: an action that costs more than the Funding held is illegal.
- **FUND-2** **Monthly income** at the end of every week whose number is a multiple of `funding.periodWeeks` (4): `funding.base` (20) + `funding.perOrder` (5) × the summed Order of standing districts. The event lists each district's share.
- **FUND-3** Funding is spent on recruits (ROST-5) and treatment (ROST-6).
- **FUND-4** Intel (from arrests) and Evidence (from raids) start at `start.intel` (0) and `start.evidence` (0) and only grow. Intel unlocks the Kingpin (END-2); nothing spends either yet.

## 6. Roster (ROST)

- **ROST-1** The roster starts with `roster.start` (6) Recruits at rank 0 and 0 XP, named in order from the data's placeholder name list.
- **ROST-2** A trooper is `ready`, `injured` (with weeks left) or `dead`. Only ready troopers can be sent on a mission.
- **ROST-3** A squad is 1–`squad.size` (4) distinct ready troopers.
- **ROST-4** **Injuries:** after a mission a deployed trooper who died is dead for good; one who was downed is injured for `injury.downed` (3) weeks; one who ended at or under `injury.woundedPct` (50)% of max Health is injured for `injury.wounded` (1) week. At each end of week, injured weeks −1; at 0 the trooper is ready.
- **ROST-5** **Recruit:** costs `recruit.cost` (40) Funding and adds a rank-0 Recruit, while the living roster is under `roster.max` (10).
- **ROST-6** **Treat:** costs `treat.cost` (30) Funding; an injured trooper is ready at once.

## 7. XP, ranks and promotion (PROM)

- **PROM-1** After a mission, every deployed trooper who survived gains `xp.mission` (1), +`xp.win` (1) on a win, and +`xp.arrest` (1) per arrest credited to them.
- **PROM-2** Rank from XP: rank 1 at `rank.r1` (2), 2 at `rank.r2` (5), 3 at `rank.r3` (9), 4 at `rank.r4` (14); `rank.max` (4). A rank-up emits an event.
- **PROM-3** A **Recruit** of rank `promotion.rank` (2) or more can be promoted, free, into one of the six specialties (Enforcer, Bulwark, Marksman, Vox Operator, Chem Trooper, Recon). Rank and XP are kept. A specialist is not promoted again in this pass.
- **PROM-4** A trooper's class (Recruit or a specialty) is the class they deploy as on the tactical map (OPS-2). Rank has no tactical effect in this pass.

## 8. Missions and the bridge (OPS)

- **OPS-1** `deploy { incident, squad }` needs the `week` phase, an open incident, no mission taken this week and a valid squad (ROST-3). The phase becomes `deployed` and `state.deployment = { incident, squad, setup }`.
- **OPS-2** The tactical setup (`incidentSetup`): `{ mapId: 'bust-01', squad: the troopers' classes in squad order, seed: the incident's seed, objective, cache?, mapData: the variant map, tuning: the variant's tuning overrides }`. Squad trooper *i* is tactical unit `s{i+1}`.
- **OPS-3** **Variant map:** the Night Market (`bust-01`) changed by, in order: the difficulty row (swaps, extra units, groups that start aware), the district modifier (OPS-4), the `turf` modifier for a fallen district or a Retake, and the objective: a bust keeps the Bagman; a raid replaces him with a `raid.guard` and places the evidence cache on one of the data's cache tiles, picked by the incident seed. Extra units take the next free slot of their group in data order; extra civilians take the civilian slots.
- **OPS-4** **District modifiers** (data): docks *rain and fog* (`light.darkSightRange` 1), foundry *furnace crew* (an extra Heavy), spire *corporate alarms* (`alarm.t1` 3), market *crowded stalls* (3 more civilians), stacks *failing grid* (2 lamps out), undercity *blackout* (3 lamps out). Lamps go out from the end of the map's lamp list.
- **OPS-5** `report { result }` (phase `deployed`) applies a mission result (AAR) and returns to the `week` phase. `abort` (phase `deployed`) withdraws the squad: a loss with no harm to the troopers.
- **OPS-6** **Result from the tactical end state** (`resultFromTactical`): outcome = the tactical outcome (none counts as a loss); Intel = the summary's intel; Evidence = the summary's evidence; arrests credited to each trooper from the accepted Cuff actions in the tactical log; per trooper: dead, downed (was downed and survived), wounded (ROST-4); civilian casualties from the summary.
- **OPS-7** `stepCampaign` validates a reported result: outcome, non-negative integers, exactly one entry per deployed trooper, nobody both dead and downed.

## 9. Auto-resolve (AUTO)

- **AUTO-1** `autoResolve { incident, squad }` has the same preconditions as `deploy` (OPS-1) and resolves the incident at once.
- **AUTO-2** **Squad strength** = the sum over the squad of `auto.base` (10) + `auto.perRank` (2) × rank + `auto.specialty` (3) for a specialist.
- **AUTO-3** **Threshold** = `auto.diffBase` (34) + `auto.perDiff` (7) × difficulty + `auto.raid` (0) for raids. **Win chance** = `auto.center` (50) + (strength − threshold) × `auto.scale` (2), clamped to `auto.min`–`auto.max` (5–95). Roll d100: under the win chance → win; under win chance + `auto.partialBand` (15) → partial; otherwise loss. The event carries the full breakdown.
- **AUTO-4** **Casualties:** each deployed trooper rolls d100: under `auto.death.<outcome>` (win 0, partial 3, loss 10) → dead; else a second d100 under `auto.injury.<outcome>` (10, 25, 40) → downed (ROST-4).
- **AUTO-5** **Rewards:** arrests `auto.arrests.<outcome>` (3, 1, 0), credited one at a time to the surviving troopers in squad order; a bust yields Intel `auto.intel.<outcome>` (6, 2, 0), a raid yields Evidence `auto.evidence.<outcome>` (3, 0, 0) and Intel equal to its arrests; one civilian casualty if a d100 roll is under `auto.casualty.<outcome>` (5, 15, 30).

## 10. After-action (AAR)

- **AAR-1** A result (auto-resolved or reported) applies: Order (DIST-2), the Takeover (TAKE-3, TAKE-4), Intel and Evidence, the deployed troopers (ROST-4, PROM-1, PROM-2), and the incident's special effect (Retake DIST-5, Kingpin END-2/END-4).
- **AAR-2** The incident is closed with its outcome and the week's mission is taken (WEEK-2).
- **AAR-3** `state.report` keeps the after-action report until the next mission: incident, mode (auto or deployed), outcome, the auto-resolve breakdown, Order before and after, Takeover before and after, Intel, Evidence, arrests, civilian casualties, and per trooper XP gained, rank before and after, injury weeks, death. `campaignQuery.report` returns it.

## 11. Campaign end (END)

- **END-1** `state.outcome` is `null`, `won` or `lost`.
- **END-2** The **Kingpin** unlocks when Intel reaches `kingpin.intel` (110): from then on a Kingpin incident spawns every week until it is won (the Kingpin's bagman carries the ledger that closes the case).
- **END-3** **Lost** when the final countdown reaches 0 (TAKE-5) or at the stall cap (WEEK-5).
- **END-4** **Won** when a Kingpin mission ends in a win (a partial does not count). The end is checked after every step; afterwards no action is legal.
- **END-5** `campaignQuery.summary`: outcome, weeks, the Takeover at the end (segments and percent), missions (auto-resolved and deployed; wins, partials, losses), districts fallen, troopers lost, promotions, Intel, Evidence, Funding.

## 12. Invariants (CINV) — checked by `sim:campaign` after every step

- **CINV-1** `legalCampaignActions` is non-empty while the campaign runs.
- **CINV-2** Every district's Order is within 0–max, and a fallen district has Order 0.
- **CINV-3** The Takeover is within 0–segments; Funding, Intel and Evidence are non-negative integers; a running countdown is within 1–`takeover.countdown`.
- **CINV-4** Roster ids are unique; injured troopers have at least 1 week left; ready and dead troopers have none; every rank matches its XP; the living roster is at most `roster.max`.
- **CINV-5** The week is within 1–`week.max`; at most `week.missions` missions per week; `deployment` is set exactly in the `deployed` phase.
- **CINV-6** The serialize / deserialize round trip deep-equals the state (every N steps), and replaying setup + actions reproduces the final state.

## 13. Rulings log

- **R-1** INC-2 | Raids spawn by chance instead of from case-board leads | The case board is out of scope for this pass; a chance keeps raids (the only regular way to push the clock back) in the loop.
- **R-2** END-2 | The Kingpin unlocks on an Intel threshold instead of "2 of 3 Lieutenants down" | Lieutenants live on the case board (next pass); Intel is the case board's currency, so the threshold is its stand-in.
- **R-3** TAKE-5 | Once started, the final countdown runs even if a raid pushes the track below full | The design says the countdown starts when the track fills; letting raids cancel it would make the last weeks a raid farm.
- **R-4** DIST-4 | A district falls the moment its Order reaches 0, not at the end of the week | "At 0 Order the district falls"; immediate is also what the after-action report can show.
- **R-5** OPS-3 | A raid's objective is the evidence cache (spec 10 VAR), and its target is a Gunman where the Bagman stood | The design's raid is "seize evidence"; the bust's Bagman would otherwise turn every raid into a bust.
- **R-6** PROM-4 | Rank has no tactical effect yet | The tactical stat lines are per class (spec 10); rank perks are the promotion trees of design 3.2, not in this pass. Rank does count for auto-resolve (AUTO-2).
- **R-7** AUTO-5 | Auto-resolve does not model kills or per-enemy tallies, only arrests, Intel, Evidence and one possible civilian casualty | The campaign uses nothing else from a mission yet.
- **R-8** OPS-5 | Abort is a loss with no harm to the squad | It is the only way out of a deployed mission without playing it (and the UI's "withdraw"); harm needs the tactical state, which an abort may not have.
- **R-9** WEEK-2 | A Kingpin or Retake incident uses the week's one mission like any other | One squad, one mission a week (design 5.1).
- **R-10** FUND-2 | A fallen district contributes nothing to Funding, and Order counts at its value at the end of the week | "Order sets that district's Funding each month."
- **R-11** DIST-6 | Added a monthly patrol recovery that the design does not list | With 2-3 incidents a week and one mission, about 1.5 incidents go ignored every week; without a way back, the sim had 4 of 6 districts falling in every campaign, average player included. Recovery up to the starting Order keeps neglect costly (a district hit twice in a month still drops) without making every campaign a collapse. Sim result in `docs/status/S1-REPORT.md`.
