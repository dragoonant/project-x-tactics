// Validates src/data/*.json against schemas/*.schema.json plus cross-file checks. Usage: npm run validate:data
import Ajv from 'ajv'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readJson = (p: string): any => JSON.parse(readFileSync(join(root, p), 'utf8'))

export function validateData(): string[] {
  const errors: string[] = []
  const ajv = new Ajv({ allErrors: true, strict: false })
  const files: [string, string][] = [
    ['src/data/tuning.json', 'src/data/schemas/tuning.schema.json'],
    ['src/data/weapons.json', 'src/data/schemas/weapons.schema.json'],
    ['src/data/units.json', 'src/data/schemas/units.schema.json'],
    ['src/data/enemies.json', 'src/data/schemas/enemies.schema.json'],
    ['src/data/campaign.json', 'src/data/schemas/campaign.schema.json'],
  ]
  const mapFiles = readdirSync(join(root, 'src/data/maps')).filter((f) => f.endsWith('.json')).map((f) => `src/data/maps/${f}`)
  for (const m of mapFiles) files.push([m, 'src/data/schemas/map.schema.json'])
  for (const [data, schema] of files) {
    const validate = ajv.compile(readJson(schema))
    if (!validate(readJson(data))) for (const e of validate.errors ?? []) errors.push(`${data}: ${e.instancePath} ${e.message}`)
  }
  if (errors.length) return errors

  const weapons = readJson('src/data/weapons.json')
  const units = readJson('src/data/units.json')
  const enemies = readJson('src/data/enemies.json')
  const tuning = readJson('src/data/tuning.json')
  for (const [id, w] of Object.entries<any>(weapons)) {
    if (w.damage[0] > w.damage[1]) errors.push(`weapon ${id}: damage min > max`)
    for (const b of w.bands) if (b.from > b.to) errors.push(`weapon ${id}: band from > to`)
  }
  for (const [id, c] of Object.entries<any>(units.classes)) {
    if (!weapons[c.weapon]) errors.push(`class ${id}: unknown weapon ${c.weapon}`)
    if (c.melee && !weapons[c.melee]) errors.push(`class ${id}: unknown melee weapon ${c.melee}`)
  }
  for (const [id, e] of Object.entries<any>(enemies.types)) {
    if (!weapons[e.weapon]) errors.push(`enemy ${id}: unknown weapon ${e.weapon}`)
    for (const [k, w] of Object.entries<string>(e.loadouts)) if (!weapons[w]) errors.push(`enemy ${id}: loadout ${k} uses unknown weapon ${w}`)
    if (tuning.intel[id] === undefined) errors.push(`enemy ${id}: no intel.${id} tuning value`)
  }

  // Every tuning key the engine reads must exist (the engine never hard-codes a rules number).
  const engineDir = join(root, 'src/engine')
  const keyRe = /\btn\(\s*\w+\s*,\s*['"`]([A-Za-z0-9_.]+)['"`]\s*\)/g
  const has = (key: string): boolean => key.split('.').reduce<any>((o, k) => (o === undefined ? undefined : o[k]), tuning) !== undefined
  for (const f of readdirSync(engineDir).filter((x) => x.endsWith('.ts'))) {
    const src = readFileSync(join(engineDir, f), 'utf8')
    for (const m of src.matchAll(keyRe)) if (!has(m[1] as string)) errors.push(`src/engine/${f}: tuning key ${m[1]} is not in tuning.json`)
  }
  for (const k of ['alarm.t1', 'alarm.t2', 'alarm.t3']) if (!has(k)) errors.push(`missing ${k}`)

  for (const m of mapFiles) {
    const map = readJson(m)
    const id = map.id as string
    if (map.rows.length !== map.height) errors.push(`${id}: ${map.rows.length} rows but height ${map.height}`)
    map.rows.forEach((r: string, y: number) => {
      if (r.length !== map.width) errors.push(`${id}: row ${y} is ${r.length} wide, expected ${map.width}`)
      for (const ch of r) if (!map.legend[ch]) errors.push(`${id}: row ${y} uses unknown legend char '${ch}'`)
    })
    const kindAt = (x: number, y: number): any => map.legend[map.rows[y]?.[x] ?? '']
    const floorAt = (x: number, y: number): boolean => { const k = kindAt(x, y); return !!k && k.kind !== 'wall' && !k.object }
    const seen = new Set<string>()
    const place = (what: string, x: number, y: number): void => {
      if (!floorAt(x, y)) errors.push(`${id}: ${what} at ${x},${y} is not on open floor`)
      if (kindAt(x, y)?.kind === 'door') errors.push(`${id}: ${what} at ${x},${y} is on a door`)
      const key = `${x},${y}`
      if (seen.has(key)) errors.push(`${id}: ${what} at ${x},${y} overlaps another placement`)
      seen.add(key)
    }
    for (const l of map.lamps) {
      const k = kindAt(l.x, l.y)
      if (!k || k.kind !== 'floor' || k.object) errors.push(`${id}: lamp at ${l.x},${l.y} must stand on plain floor`)
    }
    map.squadStart.forEach((p: any) => place('squad start', p.x, p.y))
    for (const g of map.groups) for (const u of g.units) {
      if (!enemies.types[u.type]) errors.push(`${id}: unknown enemy type ${u.type}`)
      if (u.loadout && !enemies.types[u.type]?.loadouts[u.loadout]) errors.push(`${id}: ${u.type} has no loadout ${u.loadout}`)
      place(`${u.type}`, u.x, u.y)
    }
    for (const c of map.civilians) place('civilian', c.x, c.y)
    for (const sp of map.spawnPoints) if (!floorAt(sp.x, sp.y)) errors.push(`${id}: spawn point ${sp.id} is not on open floor`)
    for (const [w, list] of Object.entries<any[]>(map.waves)) for (const d of list) if (!enemies.types[d.type]) errors.push(`${id}: wave ${w} has unknown type ${d.type}`)
    let escapes = 0, exits = 0
    for (const r of map.rows) for (const ch of r) { const k = map.legend[ch]; if (k?.kind === 'escape') escapes++; if (k?.kind === 'exit') exits++ }
    if (escapes !== 1) errors.push(`${id}: needs exactly one escape tile (found ${escapes})`)
    if (exits < 1) errors.push(`${id}: needs at least one exit tile`)
    if (!map.groups.some((g: any) => g.units.some((u: any) => u.type === 'bagman'))) errors.push(`${id}: no Bagman placed`)
    for (const w of ['A', 'B', 'C']) if (!map.waves[w]) errors.push(`${id}: missing wave ${w}`)
  }
  errors.push(...validateCampaign(readJson('src/data/campaign.json'), readJson('src/data/maps/bust-01.json'), enemies, units, tuning))
  return errors
}

/** Spec 20: campaign.json cross-checks (variants must fit the Night Market) and every key the campaign engine reads. */
function validateCampaign(camp: any, map: any, enemies: any, units: any, tuning: any): string[] {
  const errors: string[] = []
  const has = (key: string): boolean => key.split('.').reduce<any>((o, k) => (o === undefined ? undefined : o[k]), camp.tuning) !== undefined
  const dir = join(root, 'src/campaign')
  const keyRe = /\bctn\(\s*\w+\s*,\s*['"`]([A-Za-z0-9_.]+)['"`]\s*\)/g
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
    const src = readFileSync(join(dir, f), 'utf8')
    for (const m of src.matchAll(keyRe)) if (!has(m[1] as string)) errors.push(`src/campaign/${f}: campaign tuning key ${m[1]} is not in campaign.json`)
  }
  for (const sp of camp.specialties) if (!units.classes[sp] || sp === 'recruit') errors.push(`campaign: specialty ${sp} is not a promotable class`)
  const groups = new Map<string, any>(map.groups.map((g: any) => [g.id, g]))
  const changes: [string, any][] = [...Object.entries<any>(camp.modifiers).map(([k, v]) => [`modifier ${k}`, v] as [string, any]), ...Object.entries<any>(camp.difficulty).map(([k, v]) => [`difficulty ${k}`, v] as [string, any])]
  if (!camp.modifiers.turf) errors.push('campaign: modifier turf is missing')
  for (const d of camp.districts) if (!camp.modifiers[d.modifier]) errors.push(`campaign: district ${d.id} uses unknown modifier ${d.modifier}`)
  const kindAt = (x: number, y: number): any => map.legend[map.rows[y]?.[x] ?? '']
  const used = new Set<string>()
  for (const g of map.groups) for (const u of g.units) used.add(`${u.x},${u.y}`)
  for (const c of map.civilians) used.add(`${c.x},${c.y}`)
  for (const p of map.squadStart) used.add(`${p.x},${p.y}`)
  for (const l of map.lamps) used.add(`${l.x},${l.y}`)
  const open = (what: string, p: any): void => {
    const k = kindAt(p.x, p.y)
    if (!k || k.kind !== 'floor' || k.object) errors.push(`campaign: ${what} at ${p.x},${p.y} is not open floor`)
    if (used.has(`${p.x},${p.y}`)) errors.push(`campaign: ${what} at ${p.x},${p.y} overlaps another placement`)
    used.add(`${p.x},${p.y}`)
  }
  for (const [g, list] of Object.entries<any[]>(camp.slots)) list.forEach((p, i) => open(`slot ${g}[${i}]`, p))
  camp.raid.caches.forEach((p: any, i: number) => open(`cache ${i}`, p))
  if (!enemies.types[camp.raid.guard]) errors.push(`campaign: raid guard ${camp.raid.guard} is not an enemy type`)
  const extrasPer = (c: any): Map<string, number> => { const m = new Map<string, number>(); for (const e of c.extra ?? []) m.set(e.group, (m.get(e.group) ?? 0) + 1); return m }
  for (const [what, c] of changes) {
    for (const e of [...(c.extra ?? []), ...(c.swap ?? [])]) {
      if (!groups.has(e.group)) errors.push(`campaign: ${what} names unknown group ${e.group}`)
      if (!enemies.types[e.type]) errors.push(`campaign: ${what} names unknown enemy type ${e.type}`)
      if (e.loadout && !enemies.types[e.type]?.loadouts[e.loadout]) errors.push(`campaign: ${what}: ${e.type} has no loadout ${e.loadout}`)
    }
    for (const sw of c.swap ?? []) if (!groups.get(sw.group)?.units[sw.index]) errors.push(`campaign: ${what} swaps a unit that does not exist (${sw.group}[${sw.index}])`)
    for (const g of c.aware ?? []) if (!groups.has(g)) errors.push(`campaign: ${what} wakes unknown group ${g}`)
    if ((c.lampsOut ?? 0) > map.lamps.length) errors.push(`campaign: ${what} turns out more lamps than the map has`)
    if ((c.civilians ?? 0) > (camp.slots.civilians?.length ?? 0)) errors.push(`campaign: ${what} needs more civilian slots`)
    if (c.tuning) {
      const walk = (o: any, pre: string): void => {
        for (const [k, v] of Object.entries<any>(o)) {
          const key = pre ? `${pre}.${k}` : k
          if (typeof v === 'object') walk(v, key)
          else if (key.split('.').reduce<any>((x, kk) => x?.[kk], tuning) === undefined) errors.push(`campaign: ${what} overrides unknown tactical tuning ${key}`)
        }
      }
      walk(c.tuning, '')
    }
  }
  // Worst case per group: the biggest difficulty row + the biggest district modifier + turf must fit the group's slots.
  const diffRows = Object.values<any>(camp.difficulty).map(extrasPer)
  const modRows = Object.entries<any>(camp.modifiers).filter(([k]) => k !== 'turf').map(([, v]) => extrasPer(v))
  const turf = extrasPer(camp.modifiers.turf ?? {})
  for (const g of groups.keys()) {
    const need = Math.max(0, ...diffRows.map((m) => m.get(g) ?? 0)) + Math.max(0, ...modRows.map((m) => m.get(g) ?? 0)) + (turf.get(g) ?? 0)
    if (need > (camp.slots[g]?.length ?? 0)) errors.push(`campaign: group ${g} can need ${need} extra slots but has ${camp.slots[g]?.length ?? 0}`)
  }
  if (new Set(camp.names).size !== camp.names.length) errors.push('campaign: trooper names repeat')
  return errors
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = validateData()
  if (errors.length) {
    console.error(`validate:data FAILED (${errors.length})`)
    for (const e of errors) console.error('  ' + e)
    process.exit(1)
  }
  console.log('validate:data OK')
}
