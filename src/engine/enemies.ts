// Unit factories (ENM-1, class sheets) built from data.
import { CLASSES, COMMON_ENEMY_ABILITIES, COMMON_TROOPER_ABILITIES, ENEMIES } from '../data'
import type { State, Unit } from './types'
import { tn } from './util'

function base(id: string, side: Unit['side'], kind: string, name: string, x: number, y: number): Unit {
  return {
    id, side, kind, name, x, y,
    hp: 1, maxHp: 1, resolve: 0, maxResolve: 0, mobility: 6, aim: 0, defense: 0, actions: 0,
    status: 'active', weapon: null, melee: null, armed: true, group: null,
    facing: { x: 0, y: -1 }, overwatch: null, hunkered: false, suppressedBy: null, suppressReacted: false,
    pinned: false, noMove: false, stunned: false, marked: 0, fleeing: false, panicked: false, bleed: 0,
    wasDowned: false, relayUsed: false, cuffFreeUsed: false, uses: {}, gasImmune: false, abilities: [],
  }
}

export function makeTrooper(s: State, id: string, classId: string, x: number, y: number): Unit {
  const def = CLASSES[classId]
  if (!def) throw new Error(`unknown class ${classId}`)
  const u = base(id, 'squad', classId, def.name, x, y)
  u.hp = u.maxHp = def.hp
  u.mobility = def.mobility
  u.aim = def.aim
  u.defense = def.defense
  u.weapon = def.weapon
  u.melee = def.melee
  u.abilities = [...COMMON_TROOPER_ABILITIES, ...def.abilities]
  u.gasImmune = true // GAS-3: respirators
  if (u.abilities.includes('frag')) u.uses.frag = tn(s, 'frag.uses')
  if (u.abilities.includes('gas')) u.uses.gas = tn(s, 'gas.uses')
  if (u.abilities.includes('stim')) u.uses.stim = tn(s, 'stim.uses')
  return u
}

export function makeEnemy(id: string, type: string, x: number, y: number, loadout?: string): Unit {
  const def = ENEMIES[type]
  if (!def) throw new Error(`unknown enemy type ${type}`)
  const u = base(id, 'syndicate', type, def.name, x, y)
  u.hp = u.maxHp = def.hp
  u.resolve = u.maxResolve = def.resolve
  u.mobility = def.mobility
  u.aim = def.aim
  u.defense = def.defense
  u.weapon = (loadout && def.loadouts[loadout]) || def.weapon
  u.abilities = [...COMMON_ENEMY_ABILITIES, ...def.abilities]
  u.gasImmune = def.gasImmune
  return u
}

export function makeCivilian(s: State, id: string, x: number, y: number): Unit {
  const u = base(id, 'civilians', 'civilian', 'Civilian', x, y)
  u.hp = u.maxHp = tn(s, 'civilian.hp')
  u.mobility = tn(s, 'civilian.mobility')
  u.armed = false
  return u
}
