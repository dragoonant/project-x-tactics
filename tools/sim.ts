// Headless seeded games: both sides pick random legal actions. Checks INV-1..6 after every step.
// Usage: npm run sim -- --games 200 [--seed 1] [--squad 4] [--syn ai] [--squadbot greedy]
// Defaults (both sides random) are unchanged; --syn ai plays the syndicate with the utility AI, --squadbot greedy plays the squad with the greedy bot.
import { isDeepStrictEqual } from 'node:util'
import { createGame, step, randomAction, checkInvariants, serialize, deserialize, replay, summarize, legalActions } from '../src/engine'
import { CLASSES, TUNING } from '../src/data'
import type { Action, State } from '../src/engine'
import { syndicatePolicy } from '../src/ai'
import { squadBot } from '../src/ai/squad-bot'

function flag(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? Number(process.argv[i + 1]) : def
}

function sflag(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}
const useAi = sflag('syn') === 'ai'
const useBot = sflag('squadbot') === 'greedy'
const games = flag('games', 200)
const firstSeed = flag('seed', 1)
const squadSize = flag('squad', 4)
const classIds = Object.keys(CLASSES)
const maxRounds = TUNING.sim.maxRounds
const endChance = flag('end', 0.08)
const saveEvery = TUNING.sim.saveCheckEvery

interface Failure { seed: number; step: number; what: string }
const failures: Failure[] = []
const outcomes: Record<string, number> = { win: 0, partial: 0, loss: 0, stalled: 0 }
let totalSteps = 0, totalRounds = 0, rejected = 0, peakAlarmSum = 0, civCas = 0, arrests = 0, kills = 0, downed = 0
const t0 = Date.now()

for (let g = 0; g < games; g++) {
  const seed = firstSeed + g
  // Deterministic squad per seed: every class gets used across the batch.
  const squad: string[] = []
  const size = g % 5 === 4 ? 6 : squadSize
  for (let i = 0; i < size; i++) squad.push(classIds[(seed * 3 + i * 5 + (seed >> 2)) % classIds.length] as string)
  const setup = { mapId: 'bust-01', squad, seed }
  let s: State = createGame(setup)
  let n = 0
  let failed = false
  const fail = (what: string): void => { failures.push({ seed, step: n, what }); failed = true }
  while (!s.outcome && s.round <= maxRounds && !failed) {
    const legal = legalActions(s)
    const a: Action = s.phase === 'syndicate' && useAi ? syndicatePolicy(s) : s.phase === 'squad' && useBot ? squadBot(s) : randomAction(s, 0, legal, endChance)
    if ((useAi || useBot) && !legal.some((l) => JSON.stringify(l) === JSON.stringify(a))) fail(`policy returned an action outside legalActions: ${JSON.stringify(a)}`)
    const r = step(s, a)
    n++
    if (!r.ok) { rejected++; fail(`step rejected a legal action ${JSON.stringify(a)}: ${r.reason}`); break }
    const bad = checkInvariants(r.state, s.alarm)
    for (const b of bad) fail(b)
    if (n % saveEvery === 0) {
      const d = deserialize(JSON.parse(JSON.stringify(serialize(r.state))))
      if (!d.ok || !isDeepStrictEqual(d.state, r.state)) fail('INV-5: save round trip differs')
    }
    s = r.state
  }
  if (!failed) {
    // INV-5 at game end: replaying setup + actions reproduces the final state.
    const rep = replay(setup, s.log)
    if (!rep.ok || !isDeepStrictEqual(rep.state, s)) fail('INV-5: replay from seed + actions differs from the final state')
  }
  if (!s.outcome && !failed) outcomes.stalled = (outcomes.stalled ?? 0) + 1 // INV-6: reported, not a failure
  else if (s.outcome) outcomes[s.outcome] = (outcomes[s.outcome] ?? 0) + 1
  const sum = summarize(s)
  totalSteps += n; totalRounds += s.round; peakAlarmSum += sum.peakAlarm; civCas += sum.civilianCasualties
  for (const e of Object.values(sum.enemies)) { arrests += e.arrests; kills += e.kills }
  downed += sum.troopersDowned
}

const secs = ((Date.now() - t0) / 1000).toFixed(1)
console.log(`sim: games=${games} seeds=${firstSeed}..${firstSeed + games - 1} steps=${totalSteps} time=${secs}s`)
console.log(`outcomes: win=${outcomes.win} partial=${outcomes.partial} loss=${outcomes.loss} stalled(>${maxRounds} rounds)=${outcomes.stalled}`)
console.log(`averages: steps/game=${(totalSteps / games).toFixed(0)} rounds/game=${(totalRounds / games).toFixed(1)} peakAlarm=${(peakAlarmSum / games).toFixed(1)}`)
console.log(`totals: arrests=${arrests} kills=${kills} civilianCasualties=${civCas} troopersDowned=${downed}`)
console.log(`invariant failures: ${failures.length}`)
for (const f of failures.slice(0, 20)) console.log(`  seed=${f.seed} step=${f.step}: ${f.what}`)
if (failures.length) process.exit(1)
