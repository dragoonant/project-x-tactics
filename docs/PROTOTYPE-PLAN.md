# Tactical Prototype — Plan (v1, rev 2)

A browser-playable prototype of the tactical layer from [GAME-DESIGN.md](GAME-DESIGN.md), built to playtest the rules before choosing an engine. It is not the game: no campaign, no progression, one map.

**Status:** M1 in progress (2026-11-08). Rev 2 moves the board to 3D (owner: "an isometric map like XCOM and Chaos Gate") on the sibling stack from `tabletop-kb`, and adopts the KB's standing rules. Numbers marked *(tune)* are first guesses; every one of them is exposed in the in-game tuning panel.

---

## 1. Goals

The first playtest should answer:
1. **Is arresting fun?** Does breaking Resolve and cuffing feel like a real alternative to killing, or a chore?
2. **Does Alarm create good pressure?** Does quiet play feel rewarded without making loud play pointless?
3. **Do the 7 classes feel distinct?** Does each specialty have a reason to be in the squad?
4. **Do the extra systems pull their weight?** Gas, darkness, civilians and destructible cover.

---

## 2. Locked decisions

| Topic | Decision |
|---|---|
| Board | **3D isometric-style board like XCOM / Chaos Gate**: three.js through React Three Fiber, angled camera that zooms, rotates and pans (rev 2; replaces the 2D canvas plan) |
| Figures | 3D figures generated from the concept art with the local Hunyuan pipeline (`tabletop-kb/local-ai-studios.md`); static meshes with weapons fused in, no skeletal animation (KB rule 15); **no bases**: figures stand directly on the tiles (owner, 2026-11-08) |
| Hosting | Published as a private claude.ai Artifact (opens on any browser, phone included; shareable later). Code in a private GitHub repo, pushed after each milestone (owner, 2026-11-08) |
| Interface | "Bodycam feed" presentation concept (4.1) |
| Hit model | Percent + graze (see 5.2) |
| Units | Recruit + 6 specialties. K9, mech, APC and the Arbiter wait for a later build |
| Mission | One handcrafted **Bust** map |
| Extra systems | Gas, darkness, civilians, destructible cover |
| Test tools | Tuning panel, detailed combat log, squad picker, seeded replays |
| Enemy AI | Simple but fair |
| Enemy activation | Noise-based groups |
| Ammo | None in v1 |
| Elevation | Flat map in v1 |
| Trooper morale | Enemies only; troopers never panic |
| Audio | Generated music and SFX from the local Audio Studio, judged by ear on a `sounds.html` page (KB rule 9) |

### 2.1 Standing rules adopted from `tabletop-kb/rules.md`
Applied without re-asking. Numbers are the KB's rule numbers.
- **1, 20 Playable first; ask during development, never block.** Every milestone ends in something clickable with a screenshot. Open questions get a recommended default written here and work continues.
- **2 (adapted, as in Three Kingdoms Tactics) The spec is the product.** Rules have ids in `docs/spec/10-rules.md`; every ambiguity is a `RULING: <rule> | <what we did> | <why>` line; balance changes need a sim or bench result.
- **6 Cost-sensitive.** Sonnet agents implement against exact file lists; the coordinator integrates and verifies; short check-ins.
- **8 No native tooltips;** every displayed number comes from the engine (`query.*`); the UI never does rules maths.
- **9, 10, 13, 17 Studios.** Audio judged by ear; one GPU job at a time; each generated item passes its gate as it lands; stop the studio services when done.
- **11 Privacy:** credit evilgouki; grep every commit for the real name and home path.
- **21 Its own look.** A one-line presentation concept and a "must not look like" list (section 4.1).
- **22 Save and Continue** from the first playable: autosave after every accepted action; one versioned envelope (setup, seed, action list, state snapshot); storage key `px-save`.
- **23** The banned figure-prompt words never appear in any prompt, template or brief.
- **24** No text selection, callouts or tap highlights on a long press (CSS block plus listeners).
- **25 Pick by tile only.** Figures, rings and effects carry no pointer handlers; a tap resolves by tile.
- **26 Load before show.** Preload every model at startup; `Suspense` fallback is `null`; the stand-in is only for a failed load.
- **27 Mouse:** wheel zooms toward the cursor, right drag rotates and tilts, middle drag pans, left picks (left drag pans until a middle press is seen). Touch: one finger pans, two twist and pinch.

---

## 3. Tech and architecture

**Stack (the KB recipe):** Vite + React + three + React Three Fiber + drei + zustand, TypeScript strict, Vitest, Playwright. Versions follow the newest sibling (`three-kingdoms-tactics`) where they install cleanly. The Artifact build bundles the app; GLBs and audio ship as supporting files.

**The engine is engine-neutral and pure.** No DOM, no three.js, no React in `src/engine/`:
- `step(state, action) -> { state, events }` is a pure reducer. Rejected actions return a rejection result; they never throw.
- `legalActions(state)` is never empty (End Turn is always legal for the acting side).
- `query.*` owns every number the UI shows (hit chance with its breakdown, move costs, Resolve damage previews, noise radius).
- `view(state, side)` returns what a side may see (fog of war). The AI only ever reads its own view.
- **Seeded RNG** (sfc32) lives in the state, so a seed plus the action list replays exactly.
- **State is plain JSON** (no classes, Maps or functions) so the save snapshot (rule 22) is the state itself.
- **Data-driven:** units, weapons, abilities, enemies, tuning and maps are JSON, validated by schema.
- **Headless `sim`** plays random games with invariants (no unit inside a wall, Health within bounds, Alarm never decreasing, legalActions never empty, save/load round trip) and a stall cap; `action-fuzz` throws random legal and illegal actions at the reducer.

```
project-x/
├─ docs/spec/      00-architecture, 10-rules (rule ids)
├─ src/engine/     state, step, legal, query, view, rng, grid, los, cover, combat,
│                  resolve, noise, alarm, gas, light, civilians
├─ src/data/       units, weapons, abilities, enemies, tuning, maps/bust-01
├─ src/client/     R3F board, camera, figures, overlays, HUD, log, tuning panel, picker
├─ tests/          engine tests named by rule id; e2e (Playwright)
├─ tools/          sim, action-fuzz, validate-data, asset scripts
└─ public/assets/  models (GLB), audio, textures
```

**Figures:** the eight concept images are already on white with a round black base, which suits the Hunyuan pipeline directly (cutout, shape, paint, finalize, then `models:optimize` and `setMeshoptDecoder`). Syndicate enemies, civilians and later the Arbiter need concepts first, made in the same look as the existing art. Until the GLBs exist, figures are procedural stand-ins in the right colours.

---

## 4. Board readability

- **Camera:** angled XCOM-style view; rule 27 mouse map; snap-rotate buttons for touch; zoom close enough to read a figure.
- **Movement range:** blue tiles = 1 action, yellow = 2 actions (dash).
- **Cover shields** on tile edges when hovering a tile: half or full, XCOM-style.
- **Attack preview** on hovering an enemy's tile: hit %, graze %, Resolve damage, flank marker, and the line of fire.
- **Wall cutaway:** walls near selected units, the cursor and the camera side drop to low height or fade, so nothing is hidden and low views never black out (Three Kingdoms Tactics lesson).
- **Noise preview:** loud actions show a radius ring of which unaware groups they would alert.
- Dark tiles are shaded; gas tiles show a cloud; destroyed cover shows rubble.

### 4.1 Presentation concept (rule 21)
**"Bodycam feed"** (owner's choice, 2026-11-08). The HUD is framed as a live feed from the troopers' helmet cams and an overwatch drone: scanlines and slight lens vignette, a running timestamp and round counter in the corner, a REC marker, target brackets around the hovered enemy with the hit/graze readout beside them, unit cards as camera-channel tabs (one per trooper, call-sign and vitals), the event feed as a radio/telemetry ticker, and signal-loss glitch transitions between phases. The end screen is an evidence-log export of the feed. Palette: near-black, hazard amber, sodium orange, a cold monitor green for readouts.
Phone budget (Three Kingdoms Tactics lesson): no full-screen SVG filters or `backdrop-filter` every frame; scanlines and glitches are cheap static overlays or WebGL, with a "lite" setting.
Must not look like: Three Kingdoms Tactics (sand table, paper slips), Mallet 42k, or XCOM/Chaos Gate's own interfaces.

---

## 5. Tactical rules (v1)

### 5.1 Turn structure
- **Player phase:** each trooper has **2 actions**. Move = 1 action; most attacks end the unit's turn.
- **Enemy phase**, then **civilian phase**. Then the round ends and Alarm ticks.
- The camera follows enemy actions with a short pause so intent is readable.

### 5.2 Hit model: percent + graze
`hit chance = aim + weapon range modifier − target cover − target defense ± effects`, clamped to 5–95%.

Roll d100:
| Roll | Result |
|---|---|
| below hit chance | **Hit:** full damage and full Resolve damage |
| within the next **15** points *(tune)* | **Graze:** half damage (rounded up), full Resolve damage |
| otherwise | **Miss:** 1 Resolve damage to the target ("shot at"); 1 damage to the cover it was behind |

- **Cover:** half −20, full −40 *(tune)*. Directional: it only counts if it is between the shooter and the target.
- **Flanked** (no cover from the shooter's direction): +1 damage and +2 Resolve damage *(tune)*. No crit rolls in v1.
- **Hunker down:** doubles cover bonus until next turn.
- **Overwatch:** reaction shot at the first enemy that moves in sight, −15 aim *(tune)*.
- **Melee:** 85% base *(tune)*, cover doesn't apply, graze still applies.
- **Civilian risk:** a miss against a target adjacent to a civilian has a 20% *(tune)* chance to hit the civilian instead.

### 5.3 Resolve and arrests
- Enemies have **Health** and **Resolve**. Troopers have Health only.
- **Wounded:** below 50% Health, Resolve damage taken is doubled *(tune)*.
- **Resolve 0 → Surrender:** drops weapon, kneels.
- **Covered surrender:** a surrendered suspect stays put while a trooper is within 3 tiles with line of sight. Otherwise, on the enemy phase, they bolt for the nearest exit.
- **Rally:** a Fixer within 5 tiles can restore a surrendered ally to 50% Resolve (1 action).
- **Cuff:** 1 action from an adjacent trooper (Enforcer: free once per turn). Cuffed suspects are out of the fight for good.
- Nearby surrenders and arrests: every enemy within 4 tiles with line of sight takes 1 Resolve damage *(tune)*.

### 5.4 Noise, activation and Alarm
**Enemy activation:**
- Enemies start in **unaware groups**. An unaware group stands guard or patrols a short route.
- A group activates when it **sees a trooper**, when a **loud action** happens within its hearing radius (10 tiles *(tune)*), or when Alarm reaches 4.
- **Quiet:** baton, maul, shield bash, gas, Marksman's suppressed rifle, cuffing.
- **Loud:** rifle, shotgun, revolver, pistol, grenades, Heavy's LMG.
- **Ambush bonus:** shots against unaware enemies get +20 aim *(tune)*.

**Alarm (0–10):**
| Source | Alarm |
|---|---|
| End of each round | +1 |
| First loud shot each round | +1 |
| Explosion | +2 |
| Support call (smoke, spotlight) | +1 |

| Threshold | Effect *(tune)* |
|---|---|
| 4 | All groups activate; reinforcements: 2 Gunmen + 1 Thug at an edge spawn |
| 7 | The target flees for the escape van; 2 more Gunmen arrive |
| 10 | Heavy response: 1 Heavy + 2 Gunmen |

### 5.5 Downed troopers
- At 0 Health a trooper is Downed and bleeds out after 2 turns *(tune)*.
- An adjacent ally, or a Chem Trooper within 2 tiles, can **Stabilize** them (1 action). They then stay out of the fight but survive.
- A trooper who bleeds out dies, and the end screen records the loss.

### 5.6 Extra systems
- **Gas:** a cloud with a 1-tile radius (3×3) lasts 3 turns. Each enemy inside takes 2 Resolve damage per turn and −20 aim. Troopers are immune (respirators), so is the Heavy. Civilians caught in it panic.
- **Darkness:** tiles are dark unless within a lamp's light radius (4 tiles *(tune)*). A unit standing in darkness can only be seen within 2 tiles. Recon's night vision ignores darkness. Lamps have 1 Health and can be shot out (a loud shot if the weapon is loud).
- **Civilians:** wander the market. On any loud action or gas nearby they panic and run for the map edge. Each civilian casualty is counted on the end screen as an Order cost.
- **Destructible cover:** half cover has 2 Health, full cover 4 *(tune)*. Misses chip cover by 1. Explosions destroy all cover in their radius. Full cover at 0 becomes rubble (half cover); half cover at 0 is gone.

### 5.7 Fog of war
The squad shares sight: 12 tiles *(tune)*, limited by walls and darkness. Enemies outside squad sight are hidden; last-known positions are shown as ghost markers.

---

## 6. Units (v1 stat sheets)

All troopers are modelled at one rank (freshly promoted) so classes can be compared directly. Mobility = tiles per move action.

### 6.1 Troopers

| Class | HP | Mob | Aim | Weapon | Abilities |
|---|---|---|---|---|---|
| **Recruit** | 6 | 6 | 65 | Rifle | Frag grenade (1), **Suppress**, Overwatch, Hunker, Cuff |
| **Enforcer** | 8 | 6 | 65 | Shotgun | **Breach**, free Cuff (1/turn), Overwatch, Hunker |
| **Bulwark** | 9 | 5 | 60 | Revolver + shock maul | **Riot Shield**, **Shield Bash**, Maul strike, Hunker, Cuff |
| **Marksman** | 6 | 6 | 75 | Suppressed long rifle | **Pinning Shot**, **Long Watch**, Hunker, Cuff |
| **Vox Operator** | 7 | 6 | 65 | Shotgun | **Relay Orders**, **Call Support** (2 charges), Overwatch, Cuff |
| **Chem Trooper** | 7 | 6 | 65 | Shotgun | **Gas Grenade** (2), **Stim** (2), Stabilize at range 2, Cuff |
| **Recon** | 7 | 7 | 70 | Pistol + baton | **Night Vision**, **Mark Target**, Baton strike, Overwatch, Cuff |

### 6.2 Weapons

| Weapon | Damage | Resolve dmg | Range profile | Noise |
|---|---|---|---|---|
| Rifle | 3–4 | 1 | Best at 3–10 tiles; −5 per tile beyond 12 | Loud |
| Shotgun | 4–6 | 2 | +20 aim at 1–2, +10 at 3–4, −10 per tile beyond 6 | Loud |
| Revolver | 3–5 | 2 | Flat to 8 tiles; −10 per tile beyond | Loud |
| Suppressed long rifle | 4–6 | 1 | −20 aim within 4 tiles; best at 8–16 | **Quiet** |
| Pistol | 2–4 | 1 | Flat to 8 tiles | Loud |
| Baton | 2 | 3 | Melee | Quiet |
| Shock maul | 3 | 3 | Melee | Quiet |

### 6.3 Abilities

| Ability | Class | Cost | Effect |
|---|---|---|---|
| **Suppress** | Recruit | 1 action, ends turn | Target takes 2 Resolve damage now and 1 at the start of each of its turns, and −20 aim. A reaction shot fires if it moves. Lasts until the Recruit's next turn. Loud |
| **Frag grenade** | Recruit | 1 action, 1 use | Radius 1: 3 damage, 2 Resolve damage, destroys cover. Loud, +2 Alarm |
| **Breach** | Enforcer | 1 action | Opens an adjacent door and fires at the nearest visible enemy inside with +15 aim. Loud |
| **Riot Shield** | Bulwark | passive | Half cover (from the front 180°) for the Bulwark and adjacent allies; the shield faces the Bulwark's last move or attack direction |
| **Shield Bash** | Bulwark | 1 action, melee | 1 damage, 4 Resolve damage, target loses 1 action next turn. Quiet |
| **Pinning Shot** | Marksman | 1 action, ends turn | 1 damage, 3 Resolve damage, target can't move next turn. Quiet |
| **Long Watch** | Marksman | 1 action, ends turn | Overwatch with no range limit beyond sight |
| **Relay Orders** | Vox | 1 action, once per turn | Another trooper gains +1 action this turn |
| **Call Support** | Vox | 1 action, 2 shared charges | **Drone scan** (reveals radius 4 for 2 turns, darkness included), **Smoke** (radius 1, blocks line of sight for 2 turns), **Spotlight** (lights radius 3 for 2 turns). +1 Alarm each |
| **Gas Grenade** | Chem | 1 action, 2 uses | Gas cloud (see 5.6). Quiet |
| **Stim** | Chem | 1 action, 2 uses, range 1 | Heal 3, or +1 action this turn |
| **Night Vision** | Recon | passive | Sees in darkness |
| **Mark Target** | Recon | 1 action | Until the end of next turn the squad gets +15 aim and +50% Resolve damage against the target. Quiet |
| **Cuff** | all | 1 action | Arrest an adjacent surrendered suspect |

### 6.4 Syndicate and civilians

| Unit | HP | Resolve | Mob | Aim | Weapon / role |
|---|---|---|---|---|---|
| **Thug** | 4 | 4 | 7 | 55 | Club (melee 2–3) or pistol; rushes |
| **Gunman** | 5 | 6 | 6 | 60 | SMG 2–4, best at 1–6 tiles |
| **Heavy** | 9 | 8 | 5 | 55 | LMG 3–5 with Suppress; respirator (gas immune) |
| **Fixer** | 5 | 7 | 6 | 60 | Pistol; **Rally** (range 5) |
| **The Bagman** (target) | 8 | 9 | 6 | 60 | Pistol; stays in cover, flees at Alarm 7 |
| **Civilian** | 2 | — | 6 | — | Wanders; panics and flees on noise or gas |

Placeholder names throughout.

---

## 7. Enemy AI (simple but fair)

**Unaware groups:** stand guard or patrol a short route.

**Active enemies** score the tiles they can reach and pick the best one:
- Cover against the troopers they can see (main factor).
- A flanking angle on a trooper (big bonus).
- Distance to their weapon's best range.
- Gas, open ground, and tiles a trooper is overwatching (penalties).

**Then they act:**
- Shoot the target with the best expected result.
- If they have no shot, they overwatch.
- **Fixer:** rallies a surrendered ally in range before anything else.
- **Thug:** charges into melee when it can reach.
- **Heavy:** suppresses the most exposed trooper.
- **The Bagman:** holds cover. At Alarm 7 he runs for the escape van, and reaching it means he escapes.
- **Low Resolve (≤2):** enemies prefer retreating to cover over attacking.

**Readability:** each enemy's chosen action is announced in the log ("Gunman flanks Marksman"), and the AI never sees what the squad can't see of it (no cheating fog).

---

## 8. The Bust map: "Night Market"

A 22×22 *(tune)* tile street block at night. Schematic only; the exact layout is built in the map file.

```
 N  ┌─────────────────────────────────────────┐
    │  back alley (dark)       [ESCAPE VAN]    │
    │  ███████████████████████  ░░░░░░░░       │
    │  █ back room █  noodle bar  █ kitchen █  │   ← Bagman in back room
    │  █   (B) F   D    G   G     D        █   │
    │  ███████D█████████D██████████████████    │
 W  │  ╬ stalls ╬    L    ╬ stalls ╬    L      │  E
 ⇢  │   c    c    c   ▣ dumpster   c          │  ⇠  reinforcement edges
    │  ╬ stalls ╬   T  T  ╬ stalls ╬   G       │
    │  side alley (dark)  ▣   ▣    H (patrol)  │
    │        L                                 │
    │        [ SQUAD START ]                   │
    └─────────────────────────────────────────┘
 B Bagman  F Fixer  G Gunman  T Thug  H Heavy  c civilian
 L lamp  D door  ╬ stall (half cover)  ▣ dumpster/pillar (full cover)
```

- **Approaches:** loud and direct through the lit market, quiet through the dark side alley and back alley (Recon and Marksman shine), or straight through the front door (Enforcer Breach).
- **Starting enemies:** 3 groups. Market patrol (2 Thugs + Heavy), bar (2 Gunmen + Fixer), and the Bagman in the back room with 1 Gunman.
- **Win:** the Bagman is cuffed and the squad reaches the extraction zone (or all remaining enemies are neutralized).
- **Partial:** the Bagman is killed: mission success, but no intel ("case setback").
- **Loss:** the Bagman reaches the escape van, or every trooper is down.

**End screen (playtest summary):** result, rounds taken, peak Alarm, arrests vs kills by enemy type, intel earned (Thug 1, Gunman 1, Fixer 2, Heavy 2, Bagman 5), civilian casualties (Order cost), troopers downed or dead, and the seed.

---

## 9. Playtest tools

- **Squad picker:** before the mission, choose any 4 of the 7 classes (duplicates allowed) and set the seed (or randomize it).
- **Tuning panel:** sliders for every *(tune)* value. Changes apply live; *Reset* restores defaults; *Export / Import* moves a tuning set as JSON. Saved per browser.
- **Combat log:** every roll with its full breakdown: base aim, range, cover, flank, effects, final chance, the d100 roll, hit/graze/miss, damage and Resolve damage, noise and Alarm changes.
- **Seeded replays:** the seed is shown in the HUD. The same seed and the same actions replay identically, so tuning changes can be compared on one scenario. *Restart with same seed* is one click.
- **Playtest report:** the end screen has *Copy report*, which puts the summary, tuning set and seed on the clipboard as text to paste back to me.

---

## 10. Milestones

Mapped to the KB recipe (`tabletop-kb/recipe.md`): our M1 is its M0 scaffold + specs, M1 data and M2 engine.

| # | Milestone | Done when |
|---|---|---|
| M1 | **Scaffold, spec, data, engine** | `docs/spec/10-rules.md` with rule ids; data JSON + schemas + `validate:data`; the pure engine (grid, pathing, LOS, directional cover, hit/graze, Resolve, arrest, noise, Alarm, gas, darkness, civilians, destructible cover, downed/stabilize, all 7 classes' abilities, mission end); tests named by rule id; a golden turn with forced dice; `sim` and `action-fuzz` clean. A small debug page shows the map from above and plays random legal actions, so there is something clickable |
| M2 | **3D board** | R3F board of the Night Market with stand-in figures; selection by tile, move ranges, attack preview, fog; camera controls (rule 27); save/Continue (rule 22); published as an Artifact |
| M3 | **Syndicate AI** | Simple-but-fair utility AI in its own module; an AI bench (AI beats random) |
| M4 | **Art and audio** | Hunyuan figures from the concept art; syndicate and civilian concepts; SFX by weapon; music (calm / tense / combat / victory / defeat); `sounds.html` |
| M5 | **Tools and polish** | Squad picker, tuning panel, combat log, seeded replay, Copy report; phone layout |

After M5: **playtest round 1**. Art and audio generation can run alongside M2 and M3 because their files don't overlap.

## 11. Deliberately left out of v1
**The Arbiter is planned for v2**, right after the first playtest: Command Points, the three starting orders, the four **Verdicts** (with the alignment shift shown on the end screen), and the Vox Operator's Relay change. Until then the Vox keeps *Relay Orders* as written in 6.3.

Also out: K9, mech, APC, air support beyond the Vox calls, corp security, promotions and XP, ammo, elevation, crits, the campaign layer. (Save and Continue is **in**, per KB rule 22; audio is in at M4; camera rotation is in, per rule 27.)

## 12. Art needed later (not blocking v1)
The Arbiter (needed for v2), syndicate enemy concepts (Thug, Gunman, Heavy, Fixer, the Bagman), civilians, the K9 at a matching scale, the mech, the APC.
