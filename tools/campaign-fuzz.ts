// Throws random legal, malformed and illegal actions at stepCampaign, including deployments answered with random (valid and
// invalid) mission reports. Usage: npm run fuzz:campaign -- --steps 20000 [--seed 1]
// Asserts: stepCampaign never throws or reports an internal error; a rejected action leaves its input untouched; every legal action
// is accepted; CINV-1..5 hold after every accepted action.
import { checkCampaignInvariants, createCampaign, legalCampaignActions, stepCampaign } from '../src/campaign'
import type { CampaignAction, CampaignState, MissionResult } from '../src/campaign'

function flag(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? Number(process.argv[i + 1]) : def
}
const total = flag('steps', 20000)
let st = (flag('seed', 1) * 2654435761) >>> 0
const rnd = (): number => { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; return st / 4294967296 }
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)] as T
const junk: unknown[] = [null, undefined, NaN, -1, 1.5, '', 'zzz', 't1', 'i1', true, [], {}, ['t1', 't1'], ['t99'], [1, 2]]

function randomResult(s: CampaignState): MissionResult {
  const squad = s.deployment!.squad
  return {
    outcome: pick(['win', 'partial', 'loss'] as const),
    intel: Math.floor(rnd() * 8), evidence: Math.floor(rnd() * 4), civilianCasualties: rnd() < 0.2 ? 1 : 0,
    troopers: squad.map((id) => { const dead = rnd() < 0.08; const maxHp = 6 + Math.floor(rnd() * 3); return { id, dead, downed: !dead && rnd() < 0.2, hp: dead ? 0 : Math.floor(rnd() * (maxHp + 1)), maxHp, arrests: Math.floor(rnd() * 3) } }),
  }
}

function mutate(a: CampaignAction, s: CampaignState): unknown {
  const o: any = JSON.parse(JSON.stringify(a))
  switch (Math.floor(rnd() * 6)) {
    case 0: o.type = pick([...junk, 'deploy ', 'ENDWEEK']); return o
    case 1: o.incident = pick(junk); return o
    case 2: o.squad = pick(junk); return o
    case 3: o.trooper = pick(junk); o.cls = pick(['recruit', 'arbiter', 'enforcer', 5]); return o
    case 4: if (s.deployment) { const r: any = randomResult(s); const k = pick(['outcome', 'intel', 'troopers', 'hp']); if (k === 'hp') r.troopers[0].hp = 99; else r[k] = pick(junk); return { type: 'report', result: r } } return { type: 'report', result: {} }
    default: return pick([null, 3, 'endWeek', { type: 'abort' }, { type: 'treat' }, { type: 'promote', trooper: 't1', cls: 'enforcer' }])
  }
}

let s = createCampaign({ seed: flag('seed', 1) })
let accepted = 0, rejected = 0, campaigns = 1
const errors: string[] = []
const t0 = Date.now()
for (let i = 0; i < total && errors.length < 20; i++) {
  if (s.outcome) { s = createCampaign({ seed: flag('seed', 1) + campaigns++ }); continue }
  const legal = legalCampaignActions(s)
  if (!legal.length) { errors.push(`step ${i}: no legal action`); break }
  let a: unknown
  let mustAccept = false
  const roll = rnd()
  if (s.phase === 'deployed' && roll < 0.7) { a = { type: 'report', result: randomResult(s) }; mustAccept = true }
  else if (roll < 0.75) { a = pick(legal); mustAccept = true }
  else a = mutate(pick(legal), s)
  const before = JSON.stringify(s)
  let r
  try { r = stepCampaign(s, a as CampaignAction) } catch (e) { errors.push(`step ${i}: threw ${(e as Error).message}`); break }
  if (!r.ok) {
    rejected++
    if (r.reason.startsWith('internal error')) errors.push(`step ${i}: ${r.reason} for ${JSON.stringify(a)}`)
    if (mustAccept) errors.push(`step ${i}: a legal action was refused: ${JSON.stringify(a)}: ${r.reason}`)
    if (JSON.stringify(s) !== before) errors.push(`step ${i}: a rejected action changed the input`)
    continue
  }
  accepted++
  if (JSON.stringify(s) !== before) errors.push(`step ${i}: an accepted action mutated its input`)
  for (const b of checkCampaignInvariants(r.state)) errors.push(`step ${i}: ${b}`)
  s = r.state
}
console.log(`fuzz:campaign steps=${total} accepted=${accepted} rejected=${rejected} campaigns=${campaigns} time=${((Date.now() - t0) / 1000).toFixed(1)}s`)
console.log(`errors: ${errors.length}`)
for (const e of errors) console.log('  ' + e)
if (errors.length) process.exit(1)
