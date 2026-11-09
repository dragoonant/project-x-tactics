// AI bench: seeded headless games for every pairing squad {random, greedy} x syndicate {random, AI}.
// Usage: npm run bench:ai -- [--games 100] [--seed 1] [--squad 4] [--det 8] [--only greedy-ai]
// Reports squad win / partial / loss / stall rates, average rounds, troopers downed, AI decision time and the
// fallback count (AI returned something outside legalActions, or fell back to random: must be 0).
import { createGame, legalActions, randomAction, step, summarize } from '../src/engine'
import type { Action, State } from '../src/engine'
import { CLASSES, TUNING } from '../src/data'
import { syndicatePolicy } from '../src/ai'
import { squadBot } from '../src/ai/squad-bot'
import { stats as aiStats } from '../src/ai/syndicate'

function flag(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? Number(process.argv[i + 1]) : def
}
function sflag(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}

const games = flag('games', 100)
const firstSeed = flag('seed', 1)
const squadSize = flag('squad', 4)
const detGames = flag('det', 8)
const only = sflag('only')
const classIds = Object.keys(CLASSES)
const maxRounds = TUNING.sim.maxRounds
const END = 0.08

type Policy = (s: State) => Action
const randomPolicy: Policy = (s) => randomAction(s, 0, undefined, END)

interface Pairing { name: string; squad: Policy; syn: Policy; ai: boolean }
const pairings: Pairing[] = [
  { name: 'random-random', squad: randomPolicy, syn: randomPolicy, ai: false },
  { name: 'random-ai', squad: randomPolicy, syn: syndicatePolicy, ai: true },
  { name: 'greedy-random', squad: squadBot, syn: randomPolicy, ai: false },
  { name: 'greedy-ai', squad: squadBot, syn: syndicatePolicy, ai: true },
]

interface Result {
  outcome: string; rounds: number; downed: number; ms: number[]; fallbacks: number; log: string; steps: number; escaped: boolean
}

function squadFor(seed: number, g: number): string[] {
  const squad: string[] = []
  const size = g % 5 === 4 ? 6 : squadSize
  for (let i = 0; i < size; i++) squad.push(classIds[(seed * 3 + i * 5 + (seed >> 2)) % classIds.length] as string)
  return squad
}

function play(p: Pairing, seed: number, g: number): Result {
  let s: State = createGame({ mapId: 'bust-01', squad: squadFor(seed, g), seed })
  const ms: number[] = []
  let fallbacks = 0
  const before = aiStats.fallbacks
  while (!s.outcome && s.round <= maxRounds) {
    let a: Action
    if (s.phase === 'syndicate') {
      const t0 = performance.now()
      a = p.syn(s)
      const dt = performance.now() - t0
      if (p.ai) {
        ms.push(dt)
        const key = JSON.stringify(a)
        if (!legalActions(s).some((l) => JSON.stringify(l) === key)) fallbacks++
      }
    } else a = p.squad(s)
    const r = step(s, a)
    if (!r.ok) { fallbacks++; throw new Error(`rejected ${JSON.stringify(a)}: ${r.reason}`) }
    s = r.state
  }
  fallbacks += aiStats.fallbacks - before
  const sum = summarize(s)
  return { outcome: s.outcome ?? 'stalled', rounds: s.round, downed: sum.troopersDowned, ms, fallbacks, log: JSON.stringify(s.log), steps: s.steps, escaped: (sum.enemies.bagman?.escapes ?? 0) > 0 }
}

const pct = (n: number, d: number): string => `${((100 * n) / d).toFixed(0)}%`.padStart(4)
const rows: string[] = []
const loss: Record<string, number> = {}
let totalFallbacks = 0, maxMs = 0
let detFail = 0
const t0 = Date.now()
for (const p of pairings) {
  if (only && p.name !== only) continue
  const out: Record<string, number> = { win: 0, partial: 0, loss: 0, stalled: 0 }
  let rounds = 0, downed = 0, sumMs = 0, nMs = 0, mx = 0, fb = 0, esc = 0
  for (let g = 0; g < games; g++) {
    const seed = firstSeed + g
    const r = play(p, seed, g)
    out[r.outcome] = (out[r.outcome] ?? 0) + 1
    rounds += r.rounds; downed += r.downed; fb += r.fallbacks; if (r.escaped) esc++
    for (const m of r.ms) { sumMs += m; nMs++; if (m > mx) mx = m }
    if (p.ai && g < detGames) {
      const again = play(p, seed, g)
      if (again.log !== r.log || again.outcome !== r.outcome) { detFail++; console.log(`  NON-DETERMINISTIC: ${p.name} seed ${seed}`) }
    }
  }
  loss[p.name] = (100 * (out.loss as number)) / games
  totalFallbacks += fb
  if (mx > maxMs) maxMs = mx
  rows.push(`${p.name.padEnd(14)} ${pct(out.win as number, games)} ${pct(out.partial as number, games)} ${pct(out.loss as number, games)} ${pct(out.stalled as number, games)}  ${pct(esc, games)}    ${(rounds / games).toFixed(1).padStart(6)}   ${(downed / games).toFixed(2).padStart(6)}   ${p.ai ? `${(sumMs / Math.max(1, nMs)).toFixed(2)} / ${mx.toFixed(1)}`.padStart(13) : '          n/a'}   ${p.ai ? String(fb).padStart(5) : '  n/a'}`)
}
console.log(`ai-bench: ${games} games per pairing, seeds ${firstSeed}..${firstSeed + games - 1}, squads of ${squadSize} (every fifth game 6), ${((Date.now() - t0) / 1000).toFixed(0)} s`)
console.log('pairing        win  part  loss stall  bagEsc  rounds  downed   AI ms mean/max  fallbacks')
for (const r of rows) console.log(r)
const gr = loss['greedy-random'], ga = loss['greedy-ai']
if (gr !== undefined && ga !== undefined) console.log(`greedy squad loss rate: random syndicate ${gr.toFixed(0)}% -> AI syndicate ${ga.toFixed(0)}% (${ga - gr >= 0 ? '+' : ''}${(ga - gr).toFixed(0)} points; target >= +20)`)
console.log(`gate: fallbacks=${totalFallbacks} (must be 0), determinism failures=${detFail} (must be 0), max decision ${maxMs.toFixed(1)} ms (must be <= 50)`)
if (totalFallbacks > 0 || detFail > 0 || maxMs > 50) process.exit(1)
