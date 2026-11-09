// Throws random legal AND malformed/illegal actions at step(). Usage: npm run fuzz -- --steps 20000 [--seed 1]
// Asserts: step never throws and never reports an internal error; rejected actions leave the input state untouched;
// every action from legalActions is accepted; known-illegal actions are rejected; invariants hold after accepted actions.
import { createGame, step, legalActions, randomAction, checkInvariants } from '../src/engine'
import type { Action, State } from '../src/engine'
import { CLASSES, TUNING } from '../src/data'

function flag(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? Number(process.argv[i + 1]) : def
}
const totalSteps = flag('steps', 20000)
const firstSeed = flag('seed', 1)
const classIds = Object.keys(CLASSES)

let st = (firstSeed * 2654435761) >>> 0
function rnd(): number {
  st = (Math.imul(st, 1664525) + 1013904223) >>> 0
  return st / 4294967296
}
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)] as T
const junk: unknown[] = [null, undefined, NaN, Infinity, -1, 1e9, 0.5, '', 'zzz', 'e1', 's1', 'c1', true, [], {}, { x: 'a', y: 1 }, { x: 99, y: 99 }, { x: -3, y: 2 }, { x: 1.5, y: 1 }]

function mutate(a: Action, s: State): { action: unknown; surelyIllegal: boolean } {
  const o: any = JSON.parse(JSON.stringify(a))
  const kind = Math.floor(rnd() * 8)
  switch (kind) {
    case 0: o.unit = pick(junk.filter((j) => j !== 'e1' && j !== 's1' && j !== 'c1')); return { action: o, surelyIllegal: o.type !== 'endPhase' }
    case 1: o.type = pick([...junk, 'teleport', 'move ', 'ENDPHASE']); return { action: o, surelyIllegal: true }
    case 2: if (o.to !== undefined) { o.to = pick(junk); return { action: o, surelyIllegal: true } } o.target = pick(junk); return { action: o, surelyIllegal: false }
    case 3: o.at = pick(junk); return { action: o, surelyIllegal: false }
    case 4: o.ability = pick(junk); return { action: o, surelyIllegal: false }
    case 5: { // a unit from the other side acting out of phase
      if (o.type === 'endPhase') return { action: o, surelyIllegal: false }
      const other = s.units.filter((u) => u.side !== s.phase && u.side !== 'civilians')
      if (other.length && o.unit !== undefined) { o.unit = pick(other).id; return { action: o, surelyIllegal: true } }
      return { action: { type: 'move', unit: 'nobody', to: { x: 1, y: 1 } }, surelyIllegal: true }
    }
    case 6: return { action: pick([null, undefined, 5, 'move', [], { }, { type: 'move' }, { type: 'attack', unit: 's1' }, { type: 'ability' }]), surelyIllegal: true }
    default: o.option = pick(junk); return { action: o, surelyIllegal: false }
  }
}

let steps = 0, accepted = 0, rejectedCount = 0, mutatedAccepted = 0, games = 0
const problems: string[] = []
const t0 = Date.now()
let seed = firstSeed
while (steps < totalSteps && problems.length < 20) {
  const squad = [pick(classIds), pick(classIds), pick(classIds), pick(classIds), ...(rnd() < 0.3 ? [pick(classIds), pick(classIds)] : [])]
  let s: State = createGame({ mapId: 'bust-01', squad, seed })
  games++
  seed++
  while (!s.outcome && s.round <= TUNING.sim.maxRounds && steps < totalSteps) {
    const legal = legalActions(s)
    const base = randomAction(s, steps, legal, 0.08)
    const before = JSON.stringify(s)
    let action: unknown = base
    let surelyIllegal = false
    let isMutated = false
    if (rnd() < 0.5) { const m = mutate(base, s); action = m.action; surelyIllegal = m.surelyIllegal; isMutated = true }
    steps++
    let r: ReturnType<typeof step>
    try {
      r = step(s, action as Action)
    } catch (e) {
      problems.push(`seed ${seed - 1} step ${steps}: step threw ${(e as Error).message} for ${JSON.stringify(action)}`)
      break
    }
    if (!r.ok) {
      rejectedCount++
      if (r.reason.startsWith('internal error')) problems.push(`seed ${seed - 1} step ${steps}: ${r.reason} for ${JSON.stringify(action)}`)
      if (JSON.stringify(s) !== before) problems.push(`seed ${seed - 1} step ${steps}: rejected action mutated the input state`)
      if (!isMutated) problems.push(`seed ${seed - 1} step ${steps}: legal action rejected (${r.reason}) ${JSON.stringify(action)}`)
      continue
    }
    accepted++
    if (isMutated) mutatedAccepted++
    if (surelyIllegal) problems.push(`seed ${seed - 1} step ${steps}: surely-illegal action was accepted: ${JSON.stringify(action)}`)
    if (JSON.stringify(s) !== before) problems.push(`seed ${seed - 1} step ${steps}: accepted action mutated the input state`)
    const bad = checkInvariants(r.state, s.alarm)
    for (const b of bad) problems.push(`seed ${seed - 1} step ${steps}: ${b}`)
    s = r.state
  }
}
console.log(`fuzz: steps=${steps} games=${games} accepted=${accepted} (of which mutated-but-legal=${mutatedAccepted}) rejected=${rejectedCount} time=${((Date.now() - t0) / 1000).toFixed(1)}s`)
console.log(`throws / internal errors / violations: ${problems.length}`)
for (const p of problems) console.log('  ' + p)
if (problems.length) process.exit(1)
