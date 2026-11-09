// Headless campaign clock sim (spec 20). Bot policies play whole campaigns with auto-resolve; CINV-1..5 are checked after every
// step, CINV-6 (save round trip) every N steps and the replay once per campaign.
// Usage: npm run sim:campaign -- --campaigns 500 [--seed 1] [--policy average|greedy|random|all] [--deploy 0]
// --deploy N: every Nth mission is deployed and played on the tactical map (squad bot vs the syndicate AI) instead of auto-resolved.
import { isDeepStrictEqual } from 'node:util'
import {
  POLICIES, campaignQuery, checkCampaignInvariants, createCampaign, deserializeCampaign, legalCampaignActions, replayCampaign, resultFromTactical, serializeCampaign, stepCampaign,
} from '../src/campaign'
import type { CampaignAction, CampaignState } from '../src/campaign'
import { createGame, step as tstep } from '../src/engine'
import { syndicatePolicy } from '../src/ai'
import { squadBot } from '../src/ai/squad-bot'
import { TUNING } from '../src/data'

function flag(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? (process.argv[i + 1] ?? def) : def
}
const campaigns = Number(flag('campaigns', '500'))
const firstSeed = Number(flag('seed', '1'))
const policyArg = flag('policy', 'all')
const deployEvery = Number(flag('deploy', '0'))
const saveEvery = 40
const tuneArg = flag('tune', '')
const tuneOver = tuneArg ? JSON.parse(tuneArg) : undefined
const policies = policyArg === 'all' ? ['random', 'greedy', 'average'] : [policyArg]
for (const p of policies) if (!POLICIES[p]) { console.error(`unknown policy ${p}`); process.exit(2) }

function lcg(seed: number): () => number {
  let st = (seed * 2654435761) >>> 0
  return () => { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; return st / 4294967296 }
}

/** Plays a deployed mission headless: the greedy squad bot against the syndicate AI, capped at sim.maxRounds. */
function playTactical(s: CampaignState): CampaignAction {
  const dep = s.deployment!
  let t = createGame(dep.setup)
  let guard = 0
  while (!t.outcome && t.round <= TUNING.sim.maxRounds && guard++ < 5000) {
    const a = t.phase === 'syndicate' ? syndicatePolicy(t) : squadBot(t)
    const r = tstep(t, a)
    t = r.ok ? r.state : (tstep(t, { type: 'endPhase' }) as { ok: true; state: typeof t }).state
  }
  return { type: 'report', result: resultFromTactical(t, dep.squad) }
}

interface Row { policy: string; n: number; won: number; lost: number; stall: number; takeoverEnd: number[]; takeoverWon: number[]; weeks: number[]; missions: number; fallen: number; lostTroopers: number; promotions: number; winRateMissions: number[]; tacticalWins: number; tacticalN: number }
const failures: { policy: string; seed: number; step: number; what: string }[] = []
const rows: Row[] = []
const t0 = Date.now()
let totalSteps = 0

for (const policy of policies) {
  const row: Row = { policy, n: 0, won: 0, lost: 0, stall: 0, takeoverEnd: [], takeoverWon: [], weeks: [], missions: 0, fallen: 0, lostTroopers: 0, promotions: 0, winRateMissions: [], tacticalWins: 0, tacticalN: 0 }
  const pol = POLICIES[policy]!
  for (let k = 0; k < campaigns; k++) {
    const seed = firstSeed + k
    const rnd = lcg(seed * 31 + policy.length)
    const setup = tuneOver ? { seed, tuning: tuneOver } : { seed }
    let s = createCampaign(setup)
    let n = 0, failed = false, missions = 0
    const fail = (what: string): void => { failures.push({ policy, seed, step: n, what }); failed = true }
    while (!s.outcome && !failed && n < 5000) {
      let a = pol(s, rnd)
      if (deployEvery > 0 && a.type === 'autoResolve' && (missions + 1) % deployEvery === 0) a = { type: 'deploy', incident: a.incident, squad: a.squad }
      if (!legalCampaignActions(s).some((l) => JSON.stringify(l) === JSON.stringify(a)) && a.type !== 'autoResolve' && a.type !== 'deploy' && a.type !== 'promote') fail(`policy returned an action outside legalCampaignActions: ${JSON.stringify(a)}`)
      let r = stepCampaign(s, a)
      n++
      if (!r.ok) { fail(`step rejected ${JSON.stringify(a)}: ${r.reason}`); break }
      if (a.type === 'autoResolve') missions++
      if (a.type === 'deploy') {
        missions++
        const rep = playTactical(r.state)
        row.tacticalN++
        if (rep.type === 'report' && rep.result.outcome === 'win') row.tacticalWins++
        r = stepCampaign(r.state, rep)
        n++
        if (!r.ok) { fail(`report rejected: ${r.reason}`); break }
      }
      for (const b of checkCampaignInvariants(r.state)) fail(b)
      if (n % saveEvery === 0) {
        const d = deserializeCampaign(JSON.parse(JSON.stringify(serializeCampaign(r.state))))
        if (!d.ok || !isDeepStrictEqual(d.state, r.state)) fail('CINV-6: save round trip differs')
      }
      s = r.state
    }
    if (!s.outcome && !failed) fail('campaign did not end within 5000 steps')
    if (!failed) {
      const rep = replayCampaign(setup, s.log)
      if (!rep.ok || !isDeepStrictEqual(rep.state, s)) fail('CINV-6: replay from seed + actions differs from the final state')
    }
    const sum = campaignQuery.summary(s)
    row.n++
    if (s.outcome === 'won') { row.won++; row.takeoverWon.push(sum.takeoverPct) }
    else if (s.endReason === 'stall') row.stall++
    else row.lost++
    row.takeoverEnd.push(sum.takeoverPct)
    row.weeks.push(sum.weeks)
    row.missions += sum.missions
    row.fallen += sum.districtsFallen
    row.lostTroopers += sum.troopersLost
    row.promotions += sum.promotions
    if (sum.missions) row.winRateMissions.push(sum.wins / sum.missions)
    totalSteps += n
  }
  rows.push(row)
}

const avg = (a: number[]): string => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '-')
const pct = (a: number, b: number): string => `${((a / Math.max(1, b)) * 100).toFixed(0)}%`
const inBand = (a: number[]): string => (a.length ? pct(a.filter((x) => x >= 70 && x <= 90).length, a.length) : '-')
console.log(`sim:campaign campaigns=${campaigns} per policy, seeds=${firstSeed}..${firstSeed + campaigns - 1}, steps=${totalSteps}, time=${((Date.now() - t0) / 1000).toFixed(1)}s${deployEvery ? `, every ${deployEvery}th mission deployed` : ''}`)
console.log('| policy | won | lost | stalled | Takeover at end (avg %) | Takeover when won (avg %) | won ending in 70-90% | weeks (avg) | missions (avg) | mission wins | districts fallen (avg) | troopers lost (avg) | promotions (avg) |')
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
for (const r of rows) {
  console.log(`| ${r.policy} | ${pct(r.won, r.n)} | ${pct(r.lost, r.n)} | ${pct(r.stall, r.n)} | ${avg(r.takeoverEnd)} | ${avg(r.takeoverWon)} | ${inBand(r.takeoverWon)} | ${avg(r.weeks)} | ${(r.missions / r.n).toFixed(1)} | ${avg(r.winRateMissions.map((x) => x * 100))}% | ${(r.fallen / r.n).toFixed(2)} | ${(r.lostTroopers / r.n).toFixed(2)} | ${(r.promotions / r.n).toFixed(1)} |`)
  if (r.tacticalN) console.log(`  ${r.policy}: deployed tactical missions ${r.tacticalN}, won ${pct(r.tacticalWins, r.tacticalN)}`)
}
console.log(`invariant failures: ${failures.length}`)
for (const f of failures.slice(0, 20)) console.log(`  ${f.policy} seed=${f.seed} step=${f.step}: ${f.what}`)
if (failures.length) process.exit(1)
