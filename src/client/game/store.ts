// The client store (zustand). Plain data only; the controller owns every transition.
import { create } from 'zustand'
import type { Pt, State } from '../../engine'
import type { Armed } from './tap'
import type { Line } from './describe'
import { DEFAULT_SETTINGS, type SaveRead, type Settings } from './persist'

export type Screen = 'start' | 'play' | 'end'
export interface TickerLine extends Line { id: number; round: number }

export interface Store {
  screen: Screen
  state: State | null
  /** What the squad may see (view(state, 'squad')). */
  fog: State | null
  selected: string | null
  armed: Armed | null
  hover: Pt | null
  busy: boolean
  /** Message about the last refused tap / action, shown under the ability bar. */
  hint: string | null
  ticker: TickerLine[]
  settings: Settings
  saveError: string | null
  models: { done: number; total: number; ready: boolean }
  audioFound: 'unknown' | 'yes' | 'no'
  picker: { squad: string[]; seed: number }
  save: SaveRead
  /** Counts up when a phase changes (drives the glitch transition). */
  phaseTick: number
  /** Show the debug report overlay etc. */
  panel: 'none' | 'settings' | 'log'
  confirmNew: boolean
  endShownAt: number
}

export const DEFAULT_SQUAD = ['recruit', 'enforcer', 'bulwark', 'recon']

export const useStore = create<Store>(() => ({
  screen: 'start',
  state: null,
  fog: null,
  selected: null,
  armed: null,
  hover: null,
  busy: false,
  hint: null,
  ticker: [],
  settings: { ...DEFAULT_SETTINGS },
  saveError: null,
  models: { done: 0, total: 0, ready: false },
  audioFound: 'unknown',
  picker: { squad: [...DEFAULT_SQUAD], seed: 1 },
  save: { kind: 'none' },
  phaseTick: 0,
  panel: 'none',
  confirmNew: false,
  endShownAt: 0,
}))

export const get = (): Store => useStore.getState()
export const set = (p: Partial<Store> | ((s: Store) => Partial<Store>)): void => useStore.setState(p)
