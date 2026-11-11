# 30 — Animated figures and terrain: the asset contract (frozen 2026-11-08)

The seam between the asset pipeline (A1/A2, T1) and the client (A3). Both sides build against this file; change it only through the coordinator. Units: glTF space, y up, figures face +Z, 1 unit = 1 inch, 1 tile = 1 unit (as in the A0 spike).

## 1. `public/assets/anim/manifest.json`

```jsonc
{
  "version": 1,
  "skeleton": "ual-standard",          // Quaternius UAL Standard bone names (hand_r, hand_l, ...), shared by every figure
  "figures": {
    "<kind>": {                         // the unit kind, same keys as public/assets/models/manifest.json
      "file": "<kind>.glb",             // skinned mesh + all clips, path relative to this manifest
      "height": 1.8,
      "clips": { "<clip>": { "duration": 1.33, "loop": true, "speed": 0.54 } },  // speed only on walk/run: ground speed (units/s) with no foot skating
      "attachments": [
        { "id": "shotgun", "bone": "hand_r", "matrix": [16 numbers, row-major, item-local -> bone-local], "muzzle": [x, y, z] }
      ]
    }
  },
  "items": { "<id>": { "file": "items/<id>.glb" } }   // weapons and props held or worn: rifle, shotgun, revolver, long-rifle, pistol, smg, lmg, baton, maul, riot-shield, club, case, handset, injector
}
```

- Two-handed grips are **baked into the clips** (left-hand IK solved per frame at bake time), so the client never runs IK. The client only parents each attachment to its bone with its matrix.
- `muzzle` (item-local) is where muzzle flashes and tracers start.
- A kind missing from this manifest falls back to its **static** figure from `public/assets/models/manifest.json` (rule 26 applies to both: preload, null Suspense fallback, stand-in only on a failed load).

## 2. Canonical clip names

| Clip | Loop | Who has it | Played when |
|---|---|---|---|
| `idle` | yes | everyone | standing |
| `cover` | yes | troopers, armed syndicate | kneeling aim behind low cover (half cover, rubble), or hunkered; built at load from the raw idle (`posefix.ts`) |
| `coverHigh` | yes | troopers, armed syndicate | standing aim beside high cover (wall, closed door, full cover); built at load from the raw idle. In cover the figure turns to the closest active hostile it can see; an unaware syndicate group keeps its facing (sight cone). The cover on the side facing that target picks the clip |
| `peekLeft` / `peekRight` | yes | troopers, armed syndicate | beside high cover when the line to the aim target is blocked from the figure's own tile and the engine names a step-out tile (LOS-3, `query.peekFrom`): the standing aim with the chest rolled out to that side (`COVER_FIX.peekLean`) and the head partly back upright, gun aim unchanged; built at load from `coverHigh`. The board also steps the figure `PEEK_STEP` (0.32) of a tile toward the step-out tile. Left / right is the side of that tile relative to the facing toward the target |
| `walk`, `run` | yes | everyone | moving (run when a move uses the second action / dash); played at `speed` along the path, phase from distance travelled |
| `aim` | no, holds last frame | armed units | target lock / before a shot |
| `fire` | no | armed units | each ranged attack, overwatch and reaction shot |
| `melee` | no | units with a melee weapon (Bulwark maul, Recon baton, club Thug) | melee attack |
| `bash` | no | Bulwark | Shield Bash |
| `throw` | no | Recruit, Chem Trooper | grenades, gas |
| `point` | no | Vox Operator, Recon (and Fixer: rally) | Relay Orders, Mark Target, Call Support, Rally |
| `hit` | no | everyone | taking Health damage (graze too) |
| `downed` | yes | troopers | at 0 Health (bleeding out or stabilized) |
| `surrender` | yes | syndicate | Resolve 0 (kneeling, hands up) |
| `cuffed` | yes | syndicate | after Cuff (kneeling, hands behind the back) |
| `death` | no, holds last frame | everyone | killed |
| `panic` | yes | civilians | panicked civilians moving |
| `cower` | yes | civilians | panicked civilians standing |

A missing clip falls back to `idle` (and `run` → `walk`, `cover` → `idle`, `coverHigh` → `cover`, `peekLeft` / `peekRight` → `coverHigh`, `panic` → `run`, `cower` → `idle`), never to a T-pose.

## 3. Figures and their items (A1)

| Kind | Right hand | Other attachments |
|---|---|---|
| recruit | rifle | — |
| enforcer | shotgun | — |
| bulwark | revolver | riot-shield (left forearm), maul swapped in for `melee` |
| marksman | long-rifle | — |
| vox-operator | shotgun | handset (left hand during `point`) |
| chem-trooper | shotgun | injector (left hand) |
| recon | pistol | baton (left hand) |
| thug-club | club | — |
| thug-pistol | pistol | — |
| gunman | smg | — |
| heavy | lmg | — |
| fixer | pistol | — |
| bagman | pistol | case (left hand) |
| civilian-a/b/c | — | — |

The K9 waits (quadruped rig). Swapping an item mid-clip (Bulwark revolver → maul) is a client job: hide one attachment, show the other.

## 4. `public/assets/terrain/manifest.json` (T1)
As built by spike T0 (`props`: file, footprint, height, the map object kind it replaces; `textures`: color/normal/rough per surface). T1 may add keys; it must not rename existing ones.
