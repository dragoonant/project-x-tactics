# 40 — Strategy layer: the asset contract (frozen 2026-11-09)

The seam between the strategy art builder (S-art) and the strategy layer builder (S1). Both build against this file; change it only through the coordinator. S-art writes only under `public/assets/strategy/` (plus its report and review sheets); S1 never writes there. Every asset is optional: a missing manifest or file falls back to plain geometry, text or silence (rule 26: preload, null Suspense fallback).

## 1. District ids (fixed for the first campaign; display names are S1's placeholders in data)

| id | Theme for art | Corp patron (placeholder) |
|---|---|---|
| `docks` | container port, cranes, sodium lights, rain | logistics corp |
| `foundry` | heavy industry, smokestacks, furnace glow | manufacturing corp |
| `spire` | corporate towers, glass, clean blue light | finance corp |
| `market` | dense street market, neon, steam (the Night Market) | biotech corp |
| `stacks` | crowded residential blocks, laundry lines, flicker | biotech corp |
| `undercity` | old transit tunnels, flooded platforms, emergency red | logistics corp |

## 2. Case board slots
`kingpin`, `lt-arms`, `lt-narcotics`, `lt-protection`, and crew faces `crew-1` to `crew-6`. The backer slot uses no portrait (a silhouette drawn by the client).

## 3. `public/assets/strategy/manifest.json`

```jsonc
{
  "version": 1,
  "districts": { "<district id>": { "emblem": "emblems/<id>.webp", "skyline": "skylines/<id>.webp" } },  // emblem: square, transparent; skyline: wide strip for the district card
  "portraits": { "<slot>": "portraits/<slot>.webp" },          // case board photos, 3:4, printed-photo look
  "textures": { "table": "textures/table.webp", "board": "textures/corkboard.webp" },
  "audio": { "music": { "strategy": "audio/strategy.ogg" }, "sfx": { "<id>": "audio/<id>.ogg" } }  // sfx ids: incident, week, takeover, district-fall, deploy, case-reveal
}
```

Paths are relative to the manifest. Unknown keys are ignored. Images at most 1024 px on the long side, WebP.
