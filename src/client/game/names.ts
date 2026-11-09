// Display names: call-signs for troopers, readable labels for everything else. No rules maths here.
import type { Unit } from '../../engine'

export const CALL_SIGNS = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT']

/** Campaign missions show the roster's names instead of the call-sign list (index i is unit s{i+1}); null restores call-signs. */
let rosterNames: string[] | null = null
export function setCallSignNames(names: string[] | null): void { rosterNames = names ? names.map((n) => n.toUpperCase()) : null }

export function callSign(u: Pick<Unit, 'id' | 'side'>): string {
  if (u.side !== 'squad') return u.id.toUpperCase()
  const n = Number(u.id.slice(1))
  const named = rosterNames && Number.isFinite(n) ? rosterNames[n - 1] : undefined
  if (named) return named
  return CALL_SIGNS[(Number.isFinite(n) ? n - 1 : 0) % CALL_SIGNS.length] ?? 'UNIT'
}

/** Short name used in the ticker: ALPHA for troopers, "Gunman E4" for the syndicate. */
export function shortName(u: Pick<Unit, 'id' | 'side' | 'name'>): string {
  if (u.side === 'squad') return callSign(u)
  return `${u.name} ${u.id.toUpperCase()}`
}

export const ABILITY_LABELS: Record<string, string> = {
  attack: 'Fire', overwatch: 'Overwatch', hunker: 'Hunker', cuff: 'Cuff', stabilize: 'Stabilize', suppress: 'Suppress', frag: 'Frag grenade',
  breach: 'Breach', shieldBash: 'Shield bash', maul: 'Maul', baton: 'Baton', pinningShot: 'Pinning shot', longWatch: 'Long watch',
  relay: 'Relay orders', callSupport: 'Call support', gas: 'Gas grenade', stim: 'Stim', mark: 'Mark target', rally: 'Rally',
  shield: 'Riot shield', squadsight: 'Squadsight', fieldMedic: 'Field medic', nightVision: 'Night vision', quickCuffs: 'Quick cuffs',
}
export const PASSIVE_ABILITIES = new Set(['shield', 'squadsight', 'fieldMedic', 'nightVision', 'quickCuffs'])
export const ABILITY_TEXT: Record<string, string> = {
  attack: 'Fire the primary weapon at a seen target.',
  overwatch: 'Reaction shot at the first enemy that moves in sight.',
  hunker: 'Double the cover bonus until your next phase.',
  cuff: 'Arrest an adjacent surrendered suspect.',
  stabilize: 'Stop a downed trooper bleeding out.',
  suppress: 'Pin a target down with Resolve damage and an aim penalty.',
  frag: 'Radius 1 blast: damage, Resolve damage, destroys cover. Loud.',
  breach: 'Open an adjacent door and fire at the nearest enemy inside.',
  shieldBash: 'Melee: Resolve damage, target loses an action.',
  maul: 'Melee strike with the shock maul.',
  baton: 'Quiet melee strike.',
  pinningShot: 'Quiet shot: the target cannot move next turn.',
  longWatch: 'Overwatch with no range limit beyond sight.',
  relay: 'Another trooper gains +1 action this turn.',
  callSupport: 'Drone scan, smoke or spotlight. Raises the Alarm.',
  gas: 'Throw a gas cloud (3x3) that wrecks enemy Resolve.',
  stim: 'Heal 3, or give +1 action.',
  mark: 'The squad gets +aim and extra Resolve damage on the target.',
}
export const PASSIVE_TEXT: Record<string, string> = {
  shield: 'Half cover from the front for the Bulwark and adjacent allies.',
  squadsight: 'Can shoot anything the squad sees.',
  fieldMedic: 'Stabilizes downed troopers from 2 tiles.',
  nightVision: 'Sees in the dark.',
  quickCuffs: 'One free Cuff per turn.',
}

export function abilityLabel(id: string, option?: string): string {
  const base = ABILITY_LABELS[id] ?? id
  if (!option) return base
  const o = option === 'action' ? '+action' : option
  return `${base}: ${o}`
}
