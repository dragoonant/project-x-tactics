// OPS-2/3/4/6: the mission bridge. An incident becomes a Night Market variant (a tactical Setup), and a finished tactical game
// becomes a campaign MissionResult. Pure data transforms; the tactical engine is only read, never changed.
import { CAMPAIGN, MAPS, type MapData, type VariantChange } from '../data'
import type { Setup, State as TacticalState } from '../engine/types'
import { summarize } from '../engine/mission'
import type { CampaignState, Incident, MissionResult, Trooper } from './types'
import { mergeNumbers } from './util'

export const BASE_MAP = 'bust-01'

export interface VariantNote { label: string; text: string }
export interface VariantPlan {
  objective: 'bust' | 'raid'
  cache: { x: number; y: number } | null
  mapData: MapData
  tuning: Record<string, unknown>
  notes: VariantNote[]
}

/** OPS-3 / OPS-4: the changes that make an incident's Night Market, in the order they apply. */
export function variantChanges(s: CampaignState, inc: Incident): { change: VariantChange; label: string }[] {
  const d = s.districts.find((x) => x.id === inc.district)
  const out: { change: VariantChange; label: string }[] = []
  const row = CAMPAIGN.difficulty[String(inc.difficulty)]
  if (row) out.push({ change: row, label: `Difficulty ${inc.difficulty}` })
  const mod = d ? CAMPAIGN.modifiers[d.modifier] : undefined
  if (mod) out.push({ change: mod, label: mod.label })
  const turf = CAMPAIGN.modifiers.turf
  if (turf && ((d && d.fallen) || inc.role === 'retake')) out.push({ change: turf, label: turf.label })
  return out
}

/** OPS-3: build the variant map and tuning for an incident. */
export function variantFor(s: CampaignState, inc: Incident): VariantPlan {
  const base = MAPS[BASE_MAP]
  if (!base) throw new Error(`missing base map ${BASE_MAP}`)
  const m = JSON.parse(JSON.stringify(base)) as MapData
  let tuning: Record<string, unknown> = {}
  const used: Record<string, number> = {}
  let civ = 0
  const notes: VariantNote[] = []
  for (const { change: c, label } of variantChanges(s, inc)) {
    for (const sw of c.swap ?? []) {
      const g = m.groups.find((x) => x.id === sw.group)
      const u = g?.units[sw.index]
      if (u) { u.type = sw.type; if (sw.loadout) u.loadout = sw.loadout; else delete u.loadout }
    }
    for (const e of c.extra ?? []) {
      const g = m.groups.find((x) => x.id === e.group)
      const k = used[e.group] ?? 0
      const p = CAMPAIGN.slots[e.group]?.[k]
      if (!g || !p) continue
      used[e.group] = k + 1
      g.units.push({ type: e.type, x: p.x, y: p.y, ...(e.loadout ? { loadout: e.loadout } : {}), ...(p.facing ? { facing: { ...p.facing } } : {}) })
    }
    for (const gid of c.aware ?? []) { const g = m.groups.find((x) => x.id === gid); if (g) g.aware = true }
    for (let i = 0; i < (c.civilians ?? 0); i++) {
      const p = CAMPAIGN.slots.civilians?.[civ]
      if (!p) break
      civ++
      m.civilians.push({ x: p.x, y: p.y })
    }
    if (c.lampsOut) m.lamps = m.lamps.slice(0, Math.max(0, m.lamps.length - c.lampsOut))
    if (c.tuning) tuning = mergeNumbers(tuning, c.tuning)
    notes.push({ label, text: c.text })
  }
  let cache: { x: number; y: number } | null = null
  if (inc.kind === 'raid') {
    for (const g of m.groups) for (const u of g.units) if (u.type === 'bagman') { u.type = CAMPAIGN.raid.guard; delete u.loadout }
    const caches = CAMPAIGN.raid.caches
    const p = caches[Math.abs(inc.seed) % caches.length]!
    cache = { x: p.x, y: p.y }
    notes.push({ label: 'Raid', text: 'Seize the evidence cache before Alarm 7, then extract or clear the market.' })
  } else {
    notes.push({ label: inc.role === 'kingpin' ? 'Kingpin' : 'Bust', text: inc.role === 'kingpin' ? "Cuff the Kingpin's bagman: his ledger closes the case." : 'Cuff the Bagman, then extract or clear the market.' })
  }
  return { objective: inc.kind, cache, mapData: m, tuning, notes }
}

/** OPS-2: the tactical setup for an incident and a squad (trooper i is unit s{i+1}). */
export function incidentSetup(s: CampaignState, inc: Incident, squad: Trooper[]): Setup {
  const v = variantFor(s, inc)
  const setup: Setup = { mapId: BASE_MAP, squad: squad.map((t) => t.cls), seed: inc.seed, objective: v.objective, mapData: v.mapData, tuning: v.tuning as Setup['tuning'] }
  if (v.cache) setup.cache = v.cache
  return setup
}

/** OPS-6: a finished (or abandoned) tactical game as a campaign mission result. */
export function resultFromTactical(t: TacticalState, squadIds: string[]): MissionResult {
  const sum = summarize(t)
  const arrests = new Map<string, number>()
  for (const a of t.log) if (a.type === 'ability' && a.ability === 'cuff') arrests.set(a.unit, (arrests.get(a.unit) ?? 0) + 1)
  return {
    outcome: sum.outcome ?? 'loss',
    intel: sum.intel,
    evidence: sum.evidence,
    civilianCasualties: sum.civilianCasualties,
    troopers: squadIds.map((id, i) => {
      const u = t.units.find((x) => x.id === `s${i + 1}`)
      const dead = !!u && u.status === 'dead'
      return { id, dead, downed: !!u && !dead && u.wasDowned, hp: u ? u.hp : 0, maxHp: u ? u.maxHp : 1, arrests: arrests.get(`s${i + 1}`) ?? 0 }
    }),
  }
}
