// Typed access to the JSON data files. The engine reads every rules number from here (never from literals).
import tuningJson from './tuning.json'
import weaponsJson from './weapons.json'
import unitsJson from './units.json'
import enemiesJson from './enemies.json'
import bust01 from './maps/bust-01.json'
import campaignJson from './campaign.json'

export interface WeaponBand { from: number; to: number; mod: number }
export interface WeaponDef {
  name: string
  damage: [number, number]
  resolve: number
  noise: 'loud' | 'quiet'
  melee: boolean
  maxRange: number
  bands: WeaponBand[]
  falloff: { after: number; perTile: number }
}
export interface ClassDef {
  name: string
  hp: number
  mobility: number
  aim: number
  defense: number
  weapon: string
  melee: string | null
  abilities: string[]
}
export interface EnemyDef {
  name: string
  hp: number
  resolve: number
  mobility: number
  aim: number
  defense: number
  weapon: string
  loadouts: Record<string, string>
  abilities: string[]
  gasImmune: boolean
}
export interface MapLegendEntry { kind: 'floor' | 'wall' | 'door' | 'exit' | 'escape'; object?: 'halfCover' | 'fullCover' | 'rubble' }
export interface Pt { x: number; y: number }
/** `facing` (STL-1): where an unaware enemy looks, a unit step such as { x: 0, y: 1 } (south); default south. */
export interface MapUnitDef { type: string; x: number; y: number; loadout?: string; facing?: Pt }
export interface MapData {
  id: string
  name: string
  width: number
  height: number
  legend: Record<string, MapLegendEntry>
  rows: string[]
  lamps: Pt[]
  extraction: { x: number; y: number; w: number; h: number }[]
  squadStart: Pt[]
  bulwarkFacing: Pt
  spawnPoints: { id: string; x: number; y: number }[]
  waves: Record<string, { type: string; loadout?: string }[]>
  groups: { id: string; aware: boolean; units: MapUnitDef[] }[]
  civilians: Pt[]
}

export type TuningNode = { [k: string]: number | TuningNode }
export type Tuning = typeof tuningJson

export const TUNING: Tuning = tuningJson
export const WEAPONS = weaponsJson as unknown as Record<string, WeaponDef>
export const CLASSES = unitsJson.classes as unknown as Record<string, ClassDef>
export const COMMON_TROOPER_ABILITIES: string[] = unitsJson.common
export const ENEMIES = enemiesJson.types as unknown as Record<string, EnemyDef>
export const COMMON_ENEMY_ABILITIES: string[] = enemiesJson.common
export const MAPS: Record<string, MapData> = { 'bust-01': bust01 as unknown as MapData }
export function listMapIds(): string[] { return Object.keys(MAPS) }
/** Spec 20: the campaign's tuning numbers and content (districts, modifiers, difficulty rows, variant slots, names). */
export type CampaignTuning = typeof campaignJson.tuning
export interface VariantChange {
  label?: string
  text: string
  tuning?: Record<string, unknown>
  extra?: { group: string; type: string; loadout?: string }[]
  swap?: { group: string; index: number; type: string; loadout?: string }[]
  aware?: string[]
  civilians?: number
  lampsOut?: number
}
export interface CampaignData {
  tuning: CampaignTuning
  districts: { id: string; name: string; patron: string; modifier: string }[]
  modifiers: Record<string, VariantChange & { label: string }>
  difficulty: Record<string, VariantChange>
  slots: Record<string, (Pt & { facing?: Pt })[]>
  raid: { guard: string; caches: Pt[] }
  names: string[]
  specialties: string[]
}
export const CAMPAIGN = campaignJson as unknown as CampaignData
export const RAW = { campaign: campaignJson, tuning: tuningJson, weapons: weaponsJson, units: unitsJson, enemies: enemiesJson, maps: { 'bust-01': bust01 } }
