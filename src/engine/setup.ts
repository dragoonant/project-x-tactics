// ARCH-1 createGame and map loading (MSN-1).
import { CLASSES, ENEMIES, MAPS, TUNING, type MapData } from '../data'
import type { Ctx, MapState, Setup, State, Tile, Unit } from './types'
import { mergeTuning, tn } from './util'
import { seedRng } from './rng'
import { makeCivilian, makeEnemy, makeTrooper } from './enemies'
import { startPhase } from './phase'
import { updateKnowledge } from './fog'
import { coverHp } from './cover'

export function loadMap(s: State, m: MapData): MapState {
  const tiles: Tile[] = []
  for (let y = 0; y < m.height; y++) {
    const row = m.rows[y]
    if (!row || row.length !== m.width) throw new Error(`map ${m.id}: row ${y} has wrong width`)
    for (let x = 0; x < m.width; x++) {
      const ch = row[x] as string
      const def = m.legend[ch]
      if (!def) throw new Error(`map ${m.id}: unknown legend char '${ch}' at ${x},${y}`)
      const t: Tile = { k: def.kind }
      if (def.kind === 'door') t.open = false
      if (def.object) { t.o = def.object; t.hp = coverHp(s, def.object) }
      tiles.push(t)
    }
  }
  for (const l of m.lamps) {
    const t = tiles[l.y * m.width + l.x]
    if (!t || t.k === 'wall') throw new Error(`map ${m.id}: lamp at ${l.x},${l.y} is not on floor`)
    t.o = 'lamp'; t.hp = 1
  }
  const extraction: { x: number; y: number }[] = []
  for (const r of m.extraction) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) extraction.push({ x, y })
  return { id: m.id, name: m.name, w: m.width, h: m.height, tiles, extraction, spawns: m.spawnPoints.map((p) => ({ ...p })), waves: JSON.parse(JSON.stringify(m.waves)) }
}

export function createGame(setup: Setup): State {
  const mapData = setup.mapData ?? MAPS[setup.mapId]
  if (!mapData) throw new Error(`unknown map ${setup.mapId}`)
  if (!Array.isArray(setup.squad) || setup.squad.length < 1 || setup.squad.length > 6) throw new Error('squad must have 1-6 members')
  for (const cl of setup.squad) if (!CLASSES[cl]) throw new Error(`unknown class ${cl}`)
  const s = {
    setup: JSON.parse(JSON.stringify(setup)) as Setup,
    tuning: mergeTuning(TUNING, setup.tuning),
    map: { id: '', name: '', w: 0, h: 0, tiles: [], extraction: [], spawns: [], waves: {} } as MapState,
    units: [] as Unit[],
    groups: [],
    round: 1,
    phase: 'squad',
    alarm: 0,
    alarmFired: [],
    loudRound: 0,
    supportCharges: 0,
    gas: [], smoke: [], scans: [], spotlights: [],
    rng: seedRng(setup.seed),
    forcedRolls: [...(setup.forcedRolls ?? [])],
    lastSeen: { squad: {}, syndicate: {} },
    outcome: null,
    log: [],
    nextIds: { e: 0, c: 0 },
    steps: 0,
  } as State
  s.supportCharges = tn(s, 'support.charges')
  s.map = loadMap(s, mapData)
  // VAR-2: a raid carries an evidence cache on a passable floor tile.
  const objective = setup.objective ?? 'bust'
  if (objective !== 'bust' && objective !== 'raid') throw new Error(`unknown objective ${String(objective)}`)
  if (objective === 'raid') {
    const p = setup.cache
    const t = p && Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 && p.x < s.map.w && p.y < s.map.h ? s.map.tiles[p.y * s.map.w + p.x] : undefined
    if (!t || t.k !== 'floor' || t.o) throw new Error('a raid needs a cache on a passable floor tile')
    s.raid = { cache: { x: p!.x, y: p!.y }, seized: false, burned: false }
  }
  setup.squad.forEach((cl, i) => {
    const p = mapData.squadStart[i]
    if (!p) throw new Error('map has too few squad start tiles')
    const u = makeTrooper(s, `s${i + 1}`, cl, p.x, p.y)
    if (cl === 'bulwark') u.facing = { ...mapData.bulwarkFacing }
    s.units.push(u)
  })
  for (const g of mapData.groups) {
    const members: string[] = []
    for (const d of g.units) {
      if (!ENEMIES[d.type]) throw new Error(`unknown enemy type ${d.type}`)
      const id = `e${++s.nextIds.e}`
      const u = makeEnemy(id, d.type, d.x, d.y, d.loadout)
      u.group = g.id
      u.facing = d.facing ? { x: Math.sign(d.facing.x), y: Math.sign(d.facing.y) } : { x: 0, y: 1 } // STL-1
      s.units.push(u)
      members.push(id)
    }
    s.groups.push({ id: g.id, aware: g.aware, members })
  }
  for (const p of mapData.civilians) s.units.push(makeCivilian(s, `c${++s.nextIds.c}`, p.x, p.y))
  const c: Ctx = { s, ev: [] }
  startPhase(c, 'squad')
  updateKnowledge(c)
  return s
}
