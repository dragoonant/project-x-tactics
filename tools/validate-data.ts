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
