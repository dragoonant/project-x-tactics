import type { MapData, Pt, Tuning } from '../data'

export type { Pt, MapData, Tuning }
export type Side = 'squad' | 'syndicate' | 'civilians'
export type Phase = 'squad' | 'syndicate' | 'civilians'
export type UnitStatus = 'active' | 'downed' | 'stabilized' | 'dead' | 'surrendered' | 'cuffed' | 'escaped' | 'safe'
export type Outcome = 'win' | 'partial' | 'loss'
export type TileKind = 'floor' | 'wall' | 'door' | 'exit' | 'escape'
export type TileObject = 'halfCover' | 'fullCover' | 'lamp' | 'rubble'

export interface Tile {
  k: TileKind
  open?: boolean
  o?: TileObject
  hp?: number
}

export interface Unit {
  id: string
  side: Side
  kind: string
  name: string
  x: number
  y: number
  hp: number
  maxHp: number
  resolve: number
  maxResolve: number
  mobility: number
  aim: number
  defense: number
  actions: number
  status: UnitStatus
  weapon: string | null
  melee: string | null
  armed: boolean
  group: string | null
  facing: Pt
  overwatch: null | 'overwatch' | 'longWatch'
  hunkered: boolean
  suppressedBy: string | null
  suppressReacted: boolean
  pinned: boolean
  noMove: boolean
  stunned: boolean
  marked: number
  fleeing: boolean
  panicked: boolean
  bleed: number
  wasDowned: boolean
  relayUsed: boolean
  cuffFreeUsed: boolean
  uses: Record<string, number>
  gasImmune: boolean
  abilities: string[]
}

export interface Group { id: string; aware: boolean; members: string[] }
export interface Cloud { x: number; y: number; r: number; t: number }

export interface MapState {
  id: string
  name: string
  w: number
  h: number
  tiles: Tile[]
  extraction: Pt[]
  spawns: { id: string; x: number; y: number }[]
  waves: Record<string, { type: string; loadout?: string }[]>
}

export interface Setup {
  mapId: string
  squad: string[]
  seed: number
  tuning?: DeepPartial<Tuning>
  /** Test hook: custom map data instead of a registered map. */
  mapData?: MapData
  /** Test hook: forced rolls consumed first (copied into state.forcedRolls). */
  forcedRolls?: number[]
  /** VAR-2: mission objective (default 'bust'). */
  objective?: 'bust' | 'raid'
  /** VAR-2: the evidence cache tile of a raid. */
  cache?: Pt
}

/** VAR-2: present only in raids. */
export interface RaidState { cache: Pt; seized: boolean; burned: boolean }
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

export interface LastSeen { x: number; y: number; round: number }

export interface State {
  setup: Setup
  tuning: Tuning
  map: MapState
  units: Unit[]
  groups: Group[]
  round: number
  phase: Phase
  alarm: number
  alarmFired: string[]
  loudRound: number
  supportCharges: number
  gas: Cloud[]
  smoke: Cloud[]
  scans: Cloud[]
  spotlights: Cloud[]
  rng: number[]
  forcedRolls: number[]
  lastSeen: { squad: Record<string, LastSeen>; syndicate: Record<string, LastSeen> }
  outcome: Outcome | null
  log: Action[]
  nextIds: { e: number; c: number }
  steps: number
  /** VAR-2: the raid's cache (absent in a bust). */
  raid?: RaidState
}

export type Action =
  | { type: 'move'; unit: string; to: Pt }
  | { type: 'attack'; unit: string; target?: string; at?: Pt }
  | { type: 'ability'; unit: string; ability: string; target?: string; at?: Pt; option?: string }
  | { type: 'endPhase' }

export type GameEvent = { kind: string; round: number; [k: string]: any }
export type StepResult = { ok: true; state: State; events: GameEvent[] } | { ok: false; reason: string }
export interface Ctx { s: State; ev: GameEvent[] }

export interface HitBreakdown {
  attacker: string
  target: string
  weapon: string
  distance: number
  melee: boolean
  auto: boolean
  aim: number
  range: number
  mods: { name: string; value: number }[]
  cover: { level: 'none' | 'half' | 'full'; value: number; flanked: boolean; hunkered: boolean; source: string | null }
  defence: number
  raw: number
  chance: number
  grazeChance: number
  missChance: number
}
