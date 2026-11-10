# 10 — Tactical Rules Spec (prototype v1)

The rules of the tactical prototype, with stable ids. **The spec is the product:** the engine implements exactly this, tests are named by these ids, and every ambiguity found while building is logged in section 21 as `RULING: <id> | <what we did> | <why>` instead of blocking.

Source documents: [PROTOTYPE-PLAN.md](../PROTOTYPE-PLAN.md) sections 5–8 (design intent). Where this spec and the plan disagree, this spec wins. Every number in `code` is a key in `src/data/tuning.json` (default shown); the engine reads numbers only from data, never from literals.

---

## 0. Engine contract (ARCH)

- **ARCH-1** `createGame(setup) -> State`. `setup = { mapId, squad: ClassId[] (1–6, duplicates allowed), seed: number, tuning?: Partial<Tuning> }`.
- **ARCH-2** `step(state, action) -> { ok: true, state, events } | { ok: false, reason }`. Pure: never mutates its input, never throws on a bad action (returns `ok: false` with a readable reason).
- **ARCH-3** `legalActions(state) -> Action[]` for the side to act. Never empty while the game is not over: `endPhase` is always legal for the acting side.
- **ARCH-4** `query.*` computes every number the UI shows (hit chance with breakdown, damage range, Resolve damage preview, reachable tiles with costs, noise radius, cover per side, mission summary). The UI never does rules maths.
- **ARCH-5** `view(state, side) -> State` hides what that side cannot see (FOG). The AI only reads its own view.
- **ARCH-6** State is **plain JSON**: no classes, Maps, Sets, functions or `undefined` values. `JSON.parse(JSON.stringify(s))` round-trips to a deep-equal state.
- **ARCH-7** Randomness comes only from an sfc32 RNG whose 4×32-bit state lives in `state.rng`. Same seed + same actions = same game.
- **ARCH-8** Every resolved roll emits an event with its full breakdown (inputs, modifiers, final chance, the d100 roll, outcome). Every Alarm, noise, Resolve and state change emits an event.
- **ARCH-9** `state.log` keeps the accepted action list (for replay and bug reports).

## 1. Turn structure (TURN)

- **TURN-1** Sides: `squad` (player), `syndicate` (enemies), `civilians` (engine-driven, no decisions).
- **TURN-2** A **round** is: squad phase → syndicate phase → civilian phase → end of round. Round 1 starts with the squad phase.
- **TURN-3** At the start of its side's phase, each able unit gets **2 actions** (`actions.perPhase`). Unused actions are lost at phase end.
- **TURN-4** Within a phase the acting side may activate its units in any order and switch between them freely.
- **TURN-5** An action marked **ends turn** (all weapon attacks, melee, grenades, Suppress, Pinning Shot, Overwatch, Long Watch, Hunker) sets that unit's remaining actions to 0.
- **TURN-6** `endPhase` ends the acting side's phase. The civilian phase and end of round resolve automatically inside the `endPhase` that ends the syndicate phase.
- **TURN-7** End of round, in order: Alarm +`alarm.perRound` (ALM-2); gas durations −1 (GAS-4); timed effects −1 and expire at 0; bleed-out counters −1 (DWN-2); round +1.
- **TURN-8** Unaware enemies (NOI-1) take no actions; the syndicate's legal actions exclude them.

## 2. Grid and movement (MOVE)

- **MOVE-1** Square grid, `x` east, `y` south, origin top-left. Tile kinds: `floor`, `wall`, `door` (closed or open), `exit` (floor at the map edge), `escape` (the Bagman's van tile). Objects on tiles: `halfCover`, `fullCover`, `lamp`, `rubble` (= half cover).
- **MOVE-2** Movement is 8-directional; every step costs 1. A diagonal step is allowed only if both orthogonal neighbours it passes are passable (no corner cutting).
- **MOVE-3** Impassable: walls, closed doors (see MOVE-5), tiles with a cover object or lamp, tiles holding any unit (cuffed prisoners and downed troopers included). Units may not pass through other units.
- **MOVE-4** A **Move** action costs 1 action and moves the unit along a path of at most its **Mobility** steps. A dash is simply two Move actions.
- **MOVE-5** A closed door opens when a unit steps into it as part of a move (no extra cost). Open doors stay open. Breach (ABL-ENF-1) also opens doors.
- **MOVE-6** Moves resolve step by step so overwatch (OW-2) can interrupt. If an interrupting shot downs, kills or makes the mover surrender, the move stops on the current tile.
- **MOVE-7** Distance for ranges and radii is `floor(euclidean distance between tile centres)` unless a rule says "radius N (square)", which means Chebyshev distance ≤ N (a 3×3 block for N = 1).

## 3. Line of sight (LOS)

- **LOS-1** A line between two tile centres is **clear** if no tile it passes through (excluding both endpoints) blocks sight. Use a supercover line: a line passing exactly through a corner touches both tiles; it is blocked if **both** tiles at that corner block.
- **LOS-2** Blocks sight: walls, closed doors, full cover objects, smoke tiles (SUP-2). Half cover, rubble, lamps and units do not.
- **LOS-3** **Peeking:** a unit orthogonally adjacent to a sight-blocking tile may also trace lines from each **step-out tile**: an orthogonal neighbour of its tile that is passable floor, perpendicular to the blocker (i.e. the two tiles beside it along the blocker's face).
- **LOS-4** `hasLOS(a, b)` is true if a clear line exists from any of a's origin points (its tile plus its step-out tiles) to any of b's points (its tile plus its step-out tiles).
- **LOS-5** `sight.radius` = 12 tiles for every unit.

## 4. Light and darkness (LGT)

- **LGT-1** A tile is **lit** if it is within `light.lampRadius` (4) of an intact lamp **and** has a clear line (LOS-1) from the lamp's tile, or inside an active Spotlight (SUP-3). Otherwise it is **dark**.
- **LGT-2** A unit on a dark tile can be seen only from within `light.darkSightRange` (2) tiles, unless the observer has Night Vision (ABL-REC-1).
- **LGT-3** Lamps have 1 HP and can be targeted by any ranged attack that has LOS (the attack auto-hits; noise follows the weapon). A destroyed lamp stops lighting at once.

## 5. Visibility and fog (FOG)

- **FOG-1** Observer O **sees** unit U if: distance ≤ `sight.radius`, `hasLOS(O, U)`, U is inside O's cone when O is an unaware enemy (STL-1), and (U's tile is lit, or distance ≤ `light.darkSightRange`, or O has Night Vision). A Drone Scan (SUP-1) area reveals every unit inside it to the squad regardless.
- **FOG-2** A side sees what any of its units sees (shared sight).
- **FOG-3** `view(state, side)` removes opposing units the side does not see (they keep `lastSeen` ghost records), hides unaware groups' composition, and keeps all terrain.
- **FOG-4** A unit may attack only a target it sees itself, except the Marksman's Squadsight (ABL-MRK-3).

## 6. Cover (COV)

- **COV-1** Cover comes from the 4 orthogonal neighbours of the defender's tile: a `halfCover` object or `rubble` gives **half**; a `fullCover` object, a wall or a closed door gives **full**.
- **COV-2** A cover piece on side `d` (unit vector) applies against an attacker at offset `v = attacker − defender` if `v · d > 0`. The defender uses the **best** applicable piece.
- **COV-3** **Flanked:** no cover piece applies (including the Riot Shield, ABL-BUL-1).
- **COV-4** Cover values: half `cover.half` (20), full `cover.full` (40). **Hunkered** doubles the value (HNK-1).
- **COV-5** Cover is directional only; a unit standing *on* a tile has no cover from its own tile.

## 7. Hitting (HIT)

- **HIT-1** `chance = aim + rangeMod(weapon, distance) + modifiers − cover − defence`, clamped to `hit.min`–`hit.max` (5–95).
- **HIT-2** Modifiers: Mark Target +`mark.aim` (15); attacking an unaware target +`ambush.aim` (20); overwatch shot −`overwatch.aimPenalty` (15); attacker suppressed −`suppress.aimPenalty` (20); attacker standing in gas and not gas-immune −`gas.aimPenalty` (20).
- **HIT-3** Roll `r` = d100 (0–99). `r < chance` → **hit**. `chance ≤ r < chance + hit.grazeBand` (15) → **graze**. Otherwise **miss**.
- **HIT-4** Grenades (ABL-RCT-2, ABL-CHM-1) and attacks on lamps always hit; they don't roll.
- **HIT-5** **Melee** (adjacent, 8-neighbour) uses `melee.base` (85) + Mark; cover and range don't apply; grazes apply.

## 8. Damage and Resolve (DMG)

- **DMG-1** On a hit, damage = uniform integer in the weapon's [min, max]. On a graze, `ceil(damage / 2)`.
- **DMG-2** Flanked target (COV-3): +`flank.damage` (1) damage and +`flank.resolve` (2) Resolve damage, on hits and grazes.
- **DMG-3** Health damage is applied first. Then Resolve damage = the attack's base Resolve damage (+ flank) → ×`mark.resolveMult` (1.5, round up) if the target is marked → ×`resolve.woundedMult` (2) if the target is now **wounded** (Health < 50% of max after this hit).
- **DMG-4** Hits and grazes both deal full Resolve damage (only Health is halved on a graze).
- **DMG-5** A **miss** deals `resolve.shotAt` (1) Resolve damage to the target (no multipliers) and 1 damage to the cover piece that applied (DST-2).
- **DMG-6** **Civilian risk:** a missed ranged attack whose target has a civilian in an adjacent tile rolls d100; under `civilian.strayChance` (20) it hits one such civilian (lowest id) for the rolled damage instead.
- **DMG-7** Troopers have no Resolve (RES-6). Resolve damage to a trooper is ignored.

## 9. Resolve, surrender and arrest (RES / ARR)

- **RES-1** Syndicate units have Health and Resolve. Resolve never goes below 0.
- **RES-2** Health 0 → the enemy is **dead** (even if Resolve also hit 0 on the same hit).
- **RES-3** Resolve 0 with Health > 0 → **surrendered**: unarmed (no attacks), keeps its tile, takes no actions except fleeing (ARR-2).
- **RES-4** **Ripple:** when an enemy surrenders, is cuffed or is killed, every other active enemy within `resolve.rippleRadius` (4) that has LOS to it takes `resolve.ripple` (1) Resolve damage (no multipliers; ripples don't chain within one event).
- **RES-5** Gas, Suppress, Shield Bash and the abilities in section 13 deal Resolve damage as listed there; DMG-3's multipliers apply only to attacks that also deal Health damage, unless an ability says otherwise.
- **RES-6** Troopers have no Resolve and never panic. Suppression only gives them an aim penalty.
- **ARR-1** **Covered surrender:** at the start of each syndicate phase, a surrendered, uncuffed enemy with no trooper within `arrest.coverRadius` (3) that has LOS to it **flees**.
- **ARR-2** A fleeing surrendered enemy moves up to its Mobility toward the nearest `exit` tile during the syndicate phase (engine-driven). On reaching an exit it **escapes** (removed; counts as lost). If a trooper comes within the cover radius with LOS, it stops fleeing at its next check.
- **ARR-3** **Cuff:** 1 action, the trooper adjacent (8-neighbour) to a surrendered enemy. The enemy becomes **cuffed**: inert, stays on its tile, can't be rallied, can't flee. Enforcers cuff as a free action once per phase (ABL-ENF-2).
- **ARR-4** **Rally** (Fixer): see ENM-4.
- **ARR-5** At a mission win, every cuffed enemy is secured (MSN-5).

## 10. Overwatch, hunker, suppression (OW / HNK / SUP)

- **OW-1** Overwatch: 1 action, ends turn. Until the start of the unit's next phase, it holds one reaction shot.
- **OW-2** The reaction triggers on the first step of an opposing unit's move that ends on a tile the overwatcher sees (FOG-1) within weapon range. It fires with −`overwatch.aimPenalty`, then overwatch is spent. Unaware enemies never trigger it (they don't move).
- **OW-3** Several overwatchers react to the same step in unit-id order.
- **HNK-1** Hunker: 1 action, ends turn. Until the start of the unit's next phase its cover values double. Flanked units get nothing from hunkering.
- **SPR-1** **Suppressed** (from Suppress): −`suppress.aimPenalty` to the target's attacks; if the target moves, the suppressor takes one reaction shot at normal aim (once per suppression). Ends at the start of the suppressor's next phase.

## 11. Noise, activation and Alarm (NOI / ALM)

- **NOI-1** Enemies start in **groups**, each `unaware` or `aware` per the map. Unaware groups hold position (RULING R-1).
- **NOI-2** A group becomes aware when (a) any member sees a trooper (checked after every squad action and every step of a squad move), (b) a **loud** action happens within `noise.hearingRadius` (10) of any member, or (c) Alarm reaches its first threshold (ALM-4).
- **NOI-3** Loud: rifle, shotgun, revolver, pistol, Breach, Suppress, frag grenade, attacks on lamps with a loud weapon. Quiet: long rifle, Pinning Shot, baton, maul, Shield Bash, gas, Cuff, Mark, Relay, Stim, Stabilize, movement.
- **NOI-4** Noise origin is the acting unit's tile (for grenades, the impact tile).
- **NOI-5** Attacking a group damages its unaware status: any attack on a member makes the whole group aware after the attack resolves (the ambush bonus applies to that attack). A Takedown (ABL-TKD-1) is not an attack and does not do this (ABL-TKD-2).
- **ALM-1** Alarm is an integer 0–`alarm.max` (10). It never decreases.
- **ALM-2** +`alarm.perRound` (1) at each end of round.
- **ALM-3** Only squad actions raise Alarm: +`alarm.loudShot` (1) the first time each round a squad loud action happens; +`alarm.explosion` (2) per frag grenade; +`alarm.supportCall` (1) per support call.
- **ALM-4** Thresholds fire once each, when Alarm first reaches them: `alarm.t1` (4) → all groups aware + reinforcement wave `A`; `alarm.t2` (7) → the Bagman flees (ENM-5) + wave `B`; `alarm.t3` (10) → wave `C`. Waves come from the map's spawn points; units take the nearest free tiles. New units are aware.

## 11.1 Stealth (STL)

- **STL-1** An enemy of an **unaware** group sees only inside a cone of half-angle `stealth.coneHalfAngle` (60, so 120° wide) around its **facing**, measured from its tile centre to the target's; everything else in FOG-1 still applies. A unit straight behind or square to the side is not seen, even next to it.
- **STL-2** Facing comes from the map (`facing` on each enemy, a unit step; campaign variant slots carry one too) and defaults to south `{ x: 0, y: 1 }`. Unaware enemies don't move or turn (NOI-1). Aware enemies see all round; their facing only follows their moves and attacks.
- **STL-3** `query.unawareSight(view)` lists, for every enemy of an unaware group the side sees, the tiles on which it would spot a trooper (FOG-1 with STL-1). The UI draws these cones and never computes them itself (ARCH-4).

## 12. Gas (GAS)

- **GAS-1** A gas grenade creates a cloud of radius 1 (square) at the target tile with duration `gas.duration` (3).
- **GAS-2** When thrown, and at the start of each syndicate phase, every non-immune enemy in a gas tile takes `gas.resolve` (2) Resolve damage (no multipliers).
- **GAS-3** Units in gas suffer HIT-2's gas penalty unless immune. **Troopers and the Heavy are immune** (respirators).
- **GAS-4** Durations drop by 1 at end of round; the cloud disappears at 0. Overlapping clouds don't stack damage on a tile.
- **GAS-5** Civilians within `civilian.gasPanicRadius` (3) of a new cloud panic (CIV-2).

## 13. Abilities (ABL)

Common to all troopers: **Move**, **Overwatch** (OW), **Hunker** (HNK), **Cuff** (ARR-3), **Stabilize** (DWN-3), **Takedown** (ABL-TKD-1). Classes and weapons: `src/data/units.json`, `weapons.json` (values from PROTOTYPE-PLAN 6.1–6.2).

**All troopers**
- **ABL-TKD-1 Takedown:** 1 action, ends turn, quiet, no roll. Target: an active enemy adjacent (8-neighbour) to the trooper whose group is unaware. The target **surrenders** at once (Resolve 0, unarmed; RES-4 ripple and ARR-1..3 apply as for any surrender). No noise, no Alarm.
- **ABL-TKD-2** A Takedown does not wake the target's group by itself (not NOI-5). After it resolves, NOI-2a still runs: if another member sees a trooper, the group wakes. `query.stealthOutlook` tells the UI whether an action drops the target (`always` / `onHit` / `no`) and whether it would wake the target's group.

**Recruit**
- **ABL-RCT-1 Suppress:** 1 action, ends turn, loud, target seen within weapon range. Target takes `suppress.resolveNow` (2) Resolve now and `suppress.resolvePerPhase` (1) at the start of each of its phases while suppressed; SPR-1 applies.
- **ABL-RCT-2 Frag grenade** (1 use): 1 action, ends turn, target tile within `grenade.range` (8) the thrower has a clear line to. Radius 1 (square): `frag.damage` (3) damage and `frag.resolve` (2) Resolve to every unit (any side, civilians included); destroys cover (DST-3); explosion (ALM-3); loud.

**Enforcer**
- **ABL-ENF-1 Breach:** 1 action, ends turn, loud; the Enforcer is adjacent to a closed door. Opens it, then fires at the nearest enemy it now sees with +`breach.aim` (15). If none is seen, it only opens the door.
- **ABL-ENF-2 Quick Cuffs:** the first Cuff each phase costs no action.

**Bulwark**
- **ABL-BUL-1 Riot Shield** (passive): the shield faces the Bulwark's **facing** (the dominant axis of its last move step or attack; the map sets the start facing). It gives half cover to the Bulwark and to allies orthogonally or diagonally adjacent to it against attackers with `v · facing > 0` (v measured from the protected unit). It is a cover piece for COV-2/COV-3 and is never damaged.
- **ABL-BUL-2 Shield Bash:** melee, 1 action, ends turn, quiet. `bash.damage` (1), `bash.resolve` (4); on a hit or graze the target is **stunned**: it has 1 action fewer in its next phase.
- **ABL-BUL-3 Maul Strike:** melee with the shock maul weapon.

**Marksman**
- **ABL-MRK-1 Pinning Shot:** 1 action, ends turn, quiet, long-rifle range profile. `pin.damage` (1), `pin.resolve` (3); on a hit or graze the target is **pinned**: it can't move in its next phase.
- **ABL-MRK-2 Long Watch:** overwatch that uses Squadsight (ABL-MRK-3).
- **ABL-MRK-3 Squadsight** (passive): the Marksman may target any enemy seen by any trooper if the Marksman has LOS to it, ignoring sight radius and darkness.

**Vox Operator**
- **ABL-VOX-1 Relay Orders:** 1 action, once per phase, does not end turn. Another trooper the Vox sees gains +1 action this phase.
- **ABL-VOX-2 Call Support:** 1 action, does not end turn, uses one of the squad's `support.charges` (2). Target tile within `support.range` (12) of the Vox (no LOS needed). +1 Alarm. One of SUP-1..3.
- **SUP-1 Drone Scan:** reveals every unit within radius `scan.radius` (4) to the squad for `scan.duration` (2) rounds.
- **SUP-2 Smoke:** radius 1 (square) tiles block sight for `smoke.duration` (2) rounds.
- **SUP-3 Spotlight:** tiles within `spotlight.radius` (3) are lit for `spotlight.duration` (2) rounds.

**Chem Trooper**
- **ABL-CHM-1 Gas Grenade** (`gas.uses`, 2): as ABL-RCT-2's targeting, quiet, creates gas (GAS-1). No damage.
- **ABL-CHM-2 Stim** (`stim.uses`, 2): 1 action, does not end turn, an adjacent ally or self that isn't downed: either heal `stim.heal` (3) up to max, or +1 action this phase.
- **ABL-CHM-3 Field Medic** (passive): may Stabilize at range `stabilize.chemRange` (2) with LOS.

**Recon**
- **ABL-REC-1 Night Vision** (passive): ignores LGT-2.
- **ABL-REC-2 Mark Target:** 1 action, does not end turn, quiet, a seen enemy. Until the end of the next squad phase, squad attacks on it get +`mark.aim` and ×`mark.resolveMult` Resolve.
- **ABL-REC-3 Baton Strike:** melee with the baton.

## 14. Downed troopers (DWN)

- **DWN-1** A trooper at 0 Health is **downed**: no actions, keeps its tile, can't be targeted, bleed-out counter `downed.bleedOut` (2).
- **DWN-2** At end of round, each unstabilized downed trooper's counter −1; at 0 it **dies**.
- **DWN-3** **Stabilize:** 1 action by an ally adjacent (8-neighbour) to the downed trooper (Chem: ABL-CHM-3). The trooper is **stabilized**: still out of the fight, but can't die.

## 15. Destructible cover (DST)

- **DST-1** Cover objects have HP: half `destruct.halfHp` (2), full `destruct.fullHp` (4). Walls and doors are indestructible.
- **DST-2** A miss deals 1 damage to the cover object that applied (DMG-5); the Riot Shield and walls ignore it.
- **DST-3** Explosions set every cover object in their area to 0 HP.
- **DST-4** At 0 HP: full cover becomes `rubble` (half cover, HP `destruct.halfHp`); half cover and rubble are removed.

## 16. Civilians (CIV)

- **CIV-1** Civilians have `civilian.hp` (2) Health, no Resolve, no actions for the player. They are units on side `civilians`, visible to both sides when seen (FOG applies to the squad's view).
- **CIV-2** **Panic** triggers: a loud action within `civilian.panicRadius` (8), any explosion within 8, gas (GAS-5). Panicked civilians stay panicked.
- **CIV-3** Civilian phase: each calm civilian moves 0–`civilian.wander` (2) steps to a random passable tile (seeded); each panicked civilian moves up to `civilian.mobility` (6) toward the nearest `exit` and is removed safely on reaching it.
- **CIV-4** A civilian reduced to 0 Health is a **casualty** (counted in the summary as an Order cost).

## 17. Syndicate units (ENM)

- **ENM-1** Stat lines: `src/data/enemies.json` (PROTOTYPE-PLAN 6.4). All have 2 actions; attacks end turn (TURN-5).
- **ENM-2** **Thug:** club (melee) or pistol per the map's loadout.
- **ENM-3** **Heavy:** LMG; **Suppress** works as ABL-RCT-1 against troopers except no Resolve (RES-6); gas-immune.
- **ENM-4** **Fixer — Rally:** 1 action, a surrendered, uncuffed ally within `rally.range` (5) with LOS: Resolve set to `ceil(max / 2)`, armed again, no longer surrendered.
- **ENM-5** **The Bagman:** target of the mission. From ALM-4's `alarm.t2` on, the engine marks him **fleeing**: his legal moves are only those that end closer to the `escape` tile, and on ending a move on it he **escapes** (MSN-3).
- **ENM-6** Syndicate decisions in M1 come from a placeholder policy that picks a random legal action (seeded). The utility AI is M3.

## 18. Mission: Bust (MSN)

- **MSN-1** Map data: `src/data/maps/bust-01.json` (22×22, layout per PROTOTYPE-PLAN section 8): tiles, objects, lamps, doors, exits, the escape tile, the extraction zone, squad start tiles (6), enemy groups with members and awareness, civilians, reinforcement spawn points and waves A/B/C, the Bulwark start facing.
- **MSN-2** **Win:** the Bagman is cuffed and either every able trooper stands in the extraction zone or no active enemy remains (active = not dead, surrendered, cuffed or escaped).
- **MSN-3** **Loss:** the Bagman escapes, or no able trooper remains (all downed or dead).
- **MSN-4** **Partial win ("case setback"):** the Bagman is dead and either win clause's second half holds.
- **MSN-5** The game ends as soon as an outcome holds (checked after every step). At the end, downed troopers that haven't died survive; cuffed enemies are secured; surrendered but uncuffed ones are lost.
- **MSN-6** `query.summary(state)`: outcome, rounds, peak Alarm, per enemy type arrests/kills/escapes, intel (`intel.*`: Thug 1, Gunman 1, Fixer 2, Heavy 2, Bagman 5, for cuffed only), civilian casualties, troopers downed/dead, seed.

## 18.1 Mission variants (VAR)

The campaign (spec 20, OPS-2/OPS-3) deploys into variants of the Night Market. A variant is plain setup data; with none of these fields a game is the plain Bust above.

- **VAR-1** `setup.mapData` carries a variant map (enemy mix, lamps, civilians changed from `bust-01`; it keeps the id `bust-01` so the client draws the Night Market) and `setup.tuning` the variant's tuning overrides. Both ride in the save envelope (SAV-1).
- **VAR-2** `setup.objective` is `'bust'` (default: MSN-2..4) or `'raid'`. A raid needs `setup.cache`, a passable floor tile; `state.raid = { cache, seized, burned }` exists only in raids.
- **VAR-3** **Seize:** after every squad action, if the cache is neither seized nor burned and an active trooper stands within `raid.seizeRadius` (1, square) of the cache tile, the cache is **seized** (event).
- **VAR-4** **Burn:** after every step, if the cache is not seized and Alarm has reached `raid.burnAlarm` (7), the syndicate **burns** it (event). Seizing is checked first.
- **VAR-5** **Raid outcome** (instead of MSN-2..4): loss if no able trooper remains; win if the cache is seized and either every able trooper stands in the extraction zone or no active enemy remains; partial ("evidence lost") if the cache burned and the same second clause holds.
- **VAR-6** `query.summary` adds `objective` and `evidence`: `raid.evidence` (3) for a seized cache in a raid, else 0.

## 19. Save (SAV)

- **SAV-1** `serialize(state)` returns the versioned envelope `{ v: 1, setup, seed, actions, state }`; `deserialize` restores the snapshot and rejects an unknown version or malformed envelope with a reason (never throws).
- **SAV-2** Invariant: for any reachable state, `deserialize(serialize(s)).state` deep-equals `s`, and replaying `setup` + `actions` from the seed reproduces `s`.

## 20. Invariants (INV) — checked by `sim` after every step

- **INV-1** `legalActions` is non-empty while the game is not over.
- **INV-2** No two units share a tile; no unit stands on an impassable tile kind (wall, closed door, object).
- **INV-3** 0 ≤ Health ≤ max; 0 ≤ Resolve ≤ max; actions ≥ 0.
- **INV-4** Alarm never decreases and stays within 0–max.
- **INV-5** SAV-2 holds (checked every N steps).
- **INV-6** Games end within a stall cap (`sim.maxRounds`, 40) or are reported.

## 21. Rulings log

- **R-1** NOI-1 | Unaware groups hold position instead of patrolling | Patrols need route data and AI; v1 tests the activation rules, not patrol play.
- **R-2** ALM-3 | Only squad actions raise Alarm | Alarm is the syndicate's response to the raid; letting enemy fire raise it would make Alarm climb to 10 in every firefight.
- **R-3** FOG-4 | Attacks need the attacker's own sight, except Marksman Squadsight | Keeps darkness and flanking meaningful; gives the Marksman a clear identity.
- **R-4** MOVE-6/OW-2 | Engine-driven movement (fleeing surrendered enemies, civilians) never triggers Overwatch or Suppress reactions | Only decided moves are "moves" for reaction purposes; it also stops overwatch from farming free kills on surrendered enemies.
- **R-5** ALM-4 | Wave spawn point is chosen round-robin by wave (A first point, B second, C first again); units take the nearest free floor tiles in BFS order, never door or exit tiles | The spec only says "from the map's spawn points".
- **R-6** DST-3 | Explosions also smash lamps in their area | Lamps have 1 HP; leaving them lit after a grenade would be odd.
- **R-7** DMG-1/2 | Order of damage maths: roll, halve on a graze (round up), then add the flank bonus | The spec lists both without an order.
- **R-8** DMG-6 | A stray hit on a civilian happens in addition to the miss effects (shot-at Resolve, cover chip) | "Instead" is read as "the civilian takes the damage rather than the target"; the shot was still a miss.
- **R-9** HIT-2/HIT-5 | Melee attacks take every HIT-2 modifier (Mark, ambush, suppressed, gas); flanking uses the same cover geometry as ranged attacks; melee ignores cover for the hit chance and a melee miss neither chips cover nor risks a stray hit | HIT-5 says only "base + Mark"; ambush on melee is the point of quiet takedowns.
- **R-10** RES-5/DMG-3 | The Mark and wounded Resolve multipliers apply to every attack that deals Health damage (weapon attacks, Pinning Shot, Shield Bash, frag) and never to Suppress, gas, ripple or shot-at Resolve | Matches RES-5's "attacks that also deal Health damage".
- **R-11** HIT-1 | Weapon range profiles in `weapons.json` are bands plus a per-tile falloff, with a `maxRange` per weapon (rifle 20, shotgun 12, revolver 14, long rifle 24, pistol 12, SMG 14, LMG 16); the plan only gave prose | Needs numbers to be data; sight radius 12 still limits most shots.
- **R-12** ABL-ENF-2 | A free Cuff still needs the Enforcer to have at least 1 action left | Every unit action requires an able unit with actions; the free cuff just does not spend one.
- **R-13** FOG-1/FOG-4 | Only active units contribute sight (downed, surrendered and cuffed ones do not); a Drone Scan reveals units to the squad but does not let a trooper attack them without seeing them itself | Keeps FOG-4 intact.
- **R-14** RES-4 | Ripples never chain, not even across separate ripple events; a unit surrendering from a ripple does not ripple | "Ripples don't chain" read strictly.
- **R-15** NOI-5 | Any damaging squad action on a member (attack, Suppress, Pinning Shot, Bash, frag, Breach shot) wakes the group; gas and Mark do not | Gas is quiet and not an attack; Mark deals no damage.
- **R-16** ENM-5/MSN-3 | A surrendered Bagman who bolts through an exit (ARR-2) escapes the same as one reaching the van; ordinary moves onto an exit tile do not escape | ARR-2 says fleeing surrendered enemies escape through exits; the Bagman escaping is a loss either way.
- **R-17** MSN-2..4 | Outcome precedence per check: Bagman escaped, then no able trooper (both loss), then win, then partial; "able" means status active | Prevents a vacuous "every able trooper in the zone" win when nobody is left.
- **R-18** DWN-1 | Area damage (frag) to a downed or stabilized trooper kills it | They cannot be targeted, but a grenade does not check.
- **R-19** ABL-VOX-1/ABL-CHM-2 | A bonus action from Relay Orders or Stim may be spent even by a unit whose turn already ended (its actions were 0) | "+1 action this phase".
- **R-20** ARCH-3 | `legalActions` returns an empty list once the game is over (no side is acting) | Otherwise it could never be "empty while the game is not over".
- **R-21** SAV-2/INV-5 | The sim checks the serialize/deserialize round trip every `sim.saveCheckEvery` steps and replays seed + actions from scratch once at the end of each game | A replay per check is quadratic in game length.
- **R-22** ENM-6 | The random policy picks an action category (move, attack, each ability, endPhase) uniformly, then an action inside it uniformly; the sim lowers the endPhase chance to 8% | A flat pick over all legal actions is almost all Moves.
- **R-23** ARCH-7 | `state.forcedRolls` entries are final roll results, consumed one per roll in order (d100 and damage rolls alike) and clamped into that roll's range; `setup.forcedRolls` and `setup.mapData` are test hooks | Lets tests assert exact numbers; both stay plain JSON.
- **R-24** OW-1 | Only an armed unit with a ranged weapon can set Overwatch or Long Watch | A Thug with a club has nothing to fire.
- **R-25** ABL-ENF-1 | Breach needs the Enforcer orthogonally adjacent to the closed door and fires at the nearest active enemy (ties by unit id) that the Enforcer now sees; it is loud even when nothing is seen | A door's orthogonal side is the only side you can stand on; NOI-3 lists Breach as loud.
- **R-26** FOG-3 | `view()` empties the member list of unaware groups for the opposing side and drops its RNG state and log | Hidden information must not leak through the view.
- **R-27** VAR-3 | Seizing needs no action: standing next to (or on) the cache after any squad action secures it | A cuffed prisoner left on the cache tile would otherwise block it for good; reaching it under fire is the test.
- **R-28** VAR-1 | A variant keeps the map id `bust-01` and only changes units, lamps and civilians, never walls or cover | The client's terrain and props are drawn for `bust-01`; a lamp missing from the variant shows as a dead lamp.
- **R-29** STL-1 | The cone is measured between tile centres and ignores LOS-3 peeking offsets; the boundary counts as inside | Keeps the cone a simple shape the board can draw; peeking still applies to the line itself.
- **R-30** ABL-TKD-1 | Takedown works on every enemy type, the Bagman included, and leaves a surrender to cuff rather than a cuffed prisoner | Owner choice: "a melee action that only works on an unaware enemy you reach unseen: it always makes them surrender". Cuffing stays a second step (Quick Cuffs makes it free for the Enforcer).
- **R-31** ABL-TKD-2 | No separate witness rule: a takedown inside another member's cone is caught by NOI-2a because that member sees the trooper | The owner chose the takedown over a witness rule; NOI-2a already covers being seen.
