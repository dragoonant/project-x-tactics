// Spec 20 sections 8-12: the mission bridge, auto-resolve, after-action, campaign end and invariants.
import { describe, expect, it } from 'vitest'
import {
  campaignQuery, checkCampaignInvariants, incidentSetup, resultFromTactical, stepCampaign, variantFor,
} from '../../src/campaign'
import type { CampaignState, Incident } from '../../src/campaign'
import { createGame, step as tstep } from '../../src/engine'
import type { State } from '../../src/engine'
import { syndicatePolicy } from '../../src/ai'
import { squadBot } from '../../src/ai/squad-bot'
import { CAMPAIGN, MAPS } from '../../src/data'
import { ALWAYS_LOSE, ALWAYS_WIN, deployFirst, find, fresh, go, ids, kinds, refused, result } from './helpers'

const inc = (s: CampaignState, p: Partial<Incident>): Incident => {
  const i = { ...s.incidents[0]!, ...p }
  s.incidents[0] = i
  return i
}
const units = (m: { groups: { units: { type: string }[] }[] }, type: string): number => m.groups.reduce((a, g) => a + g.units.filter((u) => u.type === type).length, 0)

function playOut(setup: ReturnType<typeof incidentSetup>): State {
  let t = createGame(setup)
  let guard = 0
  while (!t.outcome && guard++ < 4000) {
    const r = tstep(t, t.phase === 'syndicate' ? syndicatePolicy(t) : squadBot(t))
    t = r.ok ? r.state : (tstep(t, { type: 'endPhase' }) as { ok: true; state: State }).state
  }
  return t
}

describe('missions and the bridge (OPS)', () => {
  it('OPS-1 deploy moves to the deployed phase and stores incident, squad and tactical setup', () => {
    const s = fresh(81)
    const r = go(s, { type: 'deploy', incident: s.incidents[0]!.id, squad: ['t3', 't1'] })
    expect(r.s.phase).toBe('deployed')
    expect(r.s.deployment).toMatchObject({ incident: s.incidents[0]!.id, squad: ['t3', 't1'] })
    expect(find(r.ev, 'deployed')).toMatchObject({ seed: s.incidents[0]!.seed })
    expect(refused(r.s, { type: 'deploy', incident: s.incidents[1]!.id, squad: ['t2'] })).toMatch(/already running/)
  })

  it('OPS-2 the setup is the Night Market with the squad classes, the incident seed, objective, variant map and tuning; it starts a tactical game', () => {
    const s = fresh(82)
    s.roster[1]!.cls = 'recon'
    const i = inc(s, { kind: 'raid', district: 'spire', difficulty: 2 })
    const setup = incidentSetup(s, i, [s.roster[0]!, s.roster[1]!])
    expect(setup).toMatchObject({ mapId: 'bust-01', squad: ['recruit', 'recon'], seed: i.seed, objective: 'raid', tuning: { alarm: { t1: 3 } } })
    expect(setup.cache).toBeTruthy()
    const t = createGame(setup)
    expect(t.raid?.cache).toEqual(setup.cache)
    expect(t.tuning.alarm.t1).toBe(3)
    expect(t.units.filter((u) => u.side === 'squad').map((u) => u.id)).toEqual(['s1', 's2'])
  })

  it('OPS-3 / R-5 variants: difficulty rows swap and add units and wake groups; a raid swaps the Bagman for a guard and picks a cache by seed; a fallen district adds turf', () => {
    const s = fresh(83)
    const base = MAPS['bust-01']!
    const d1 = variantFor(s, inc(s, { kind: 'bust', district: 'market', difficulty: 1 })).mapData
    expect(units(d1, 'heavy')).toBe(units(base, 'heavy') - 1)
    const d5 = variantFor(s, inc(s, { kind: 'bust', district: 'market', difficulty: 5 })).mapData
    expect(units(d5, 'gunman')).toBe(units(base, 'gunman') + 2)
    expect(units(d5, 'heavy')).toBe(units(base, 'heavy') + 1)
    expect(d5.groups.find((g) => g.id === 'patrol')!.aware).toBe(true)
    const r = variantFor(s, inc(s, { kind: 'raid', district: 'market', difficulty: 2, seed: 4 }))
    expect(units(r.mapData, 'bagman')).toBe(0)
    expect(units(r.mapData, CAMPAIGN.raid.guard)).toBe(units(base, CAMPAIGN.raid.guard) + 1)
    expect(r.cache).toEqual(CAMPAIGN.raid.caches[4 % CAMPAIGN.raid.caches.length])
    s.districts[3]!.fallen = true; s.districts[3]!.order = 0
    const t = variantFor(s, inc(s, { kind: 'bust', district: 'market', difficulty: 2 }))
    expect(units(t.mapData, 'gunman')).toBe(units(base, 'gunman') + 1)
    expect(t.notes.map((n) => n.label)).toContain('Syndicate turf')
    // every combination builds a legal tactical game (no unit on a wall, object or another unit)
    for (const dd of s.districts) for (let k = 1; k <= 5; k++) for (const kind of ['bust', 'raid'] as const) {
      const g = createGame(incidentSetup(s, inc(s, { kind, district: dd.id, difficulty: k, role: 'retake' }), s.roster.slice(0, 4)))
      const tiles = new Set<string>()
      for (const u of g.units) { const key = `${u.x},${u.y}`; expect(tiles.has(key)).toBe(false); tiles.add(key) }
    }
  })

  it('OPS-4 district modifiers: rain, furnace crew, corporate alarms, crowded stalls, failing grid, blackout', () => {
    const s = fresh(84)
    const base = MAPS['bust-01']!
    const v = (district: string) => variantFor(s, inc(s, { kind: 'bust', district, difficulty: 2, role: 'regular' }))
    expect(v('docks').tuning).toEqual({ light: { darkSightRange: 1 } })
    expect(units(v('foundry').mapData, 'heavy')).toBe(units(base, 'heavy') + 1)
    expect(v('spire').tuning).toEqual({ alarm: { t1: 3 } })
    expect(v('market').mapData.civilians.length).toBe(base.civilians.length + 3)
    expect(v('stacks').mapData.lamps).toEqual(base.lamps.slice(0, base.lamps.length - 2))
    expect(v('undercity').mapData.lamps).toEqual(base.lamps.slice(0, base.lamps.length - 3))
    expect(campaignQuery.incident(s, s.incidents[0]!.id)!.notes[1]!.label).toBe('Blackout')
  })

  it('OPS-5 / R-8 report returns to the week phase with the result applied; abort is a loss with no harm', () => {
    let s = fresh(85)
    s = deployFirst(s).s
    const r = go(s, { type: 'report', result: result(s, 'win', { intel: 2 }) })
    expect(r.s).toMatchObject({ phase: 'week', deployment: null, intel: 2, missionsThisWeek: 1 })
    expect(r.s.report).toMatchObject({ mode: 'deployed', outcome: 'win' })
    let a = deployFirst(fresh(85)).s
    a = go(a, { type: 'abort' }).s
    expect(a.report).toMatchObject({ mode: 'aborted', outcome: 'loss' })
    expect(a.roster.every((t) => t.status === 'ready')).toBe(true)
    expect(a.missionsThisWeek).toBe(1)
  })

  it('OPS-6 a finished tactical game becomes a mission result: outcome, intel, evidence, arrests from Cuff actions, dead / downed / Health', () => {
    let s = fresh(86)
    const d = go(s, { type: 'deploy', incident: s.incidents[0]!.id, squad: ['t1', 't2', 't3', 't4'] }).s
    const t = playOut(d.deployment!.setup)
    expect(t.outcome).not.toBeNull()
    const res = resultFromTactical(t, d.deployment!.squad)
    expect(res.outcome).toBe(t.outcome)
    expect(res.troopers.map((x) => x.id)).toEqual(['t1', 't2', 't3', 't4'])
    const cuffs = t.log.filter((a) => a.type === 'ability' && a.ability === 'cuff').length
    expect(res.troopers.reduce((a, x) => a + x.arrests, 0)).toBe(cuffs)
    for (const [i, x] of res.troopers.entries()) {
      const u = t.units.find((q) => q.id === `s${i + 1}`)!
      expect(x.dead).toBe(u.status === 'dead')
      expect(x.downed).toBe(u.status !== 'dead' && u.wasDowned)
      expect(x.hp).toBe(u.hp)
    }
    s = go(d, { type: 'report', result: res }).s
    expect(checkCampaignInvariants(s)).toEqual([])
    // an unfinished game counts as a loss
    expect(resultFromTactical(createGame(d.deployment!.setup), d.deployment!.squad).outcome).toBe('loss')
  })

  it('OPS-7 a reported result must match the deployment', () => {
    const d = deployFirst(fresh(87)).s
    const ok = result(d, 'win')
    expect(refused(d, { type: 'report', result: { ...ok, outcome: 'draw' } })).toMatch(/outcome/)
    expect(refused(d, { type: 'report', result: { ...ok, intel: -1 } })).toMatch(/intel/)
    expect(refused(d, { type: 'report', result: { ...ok, troopers: ok.troopers.slice(1) } })).toMatch(/every deployed/)
    expect(refused(d, { type: 'report', result: { ...ok, troopers: ok.troopers.map((t, i) => (i === 0 ? { ...t, id: 't9' } : t)) } })).toMatch(/match/)
    expect(refused(d, { type: 'report', result: { ...ok, troopers: ok.troopers.map((t, i) => (i === 0 ? { ...t, dead: true, downed: true } : t)) } })).toMatch(/both/)
    expect(refused(d, { type: 'report', result: { ...ok, troopers: ok.troopers.map((t, i) => (i === 0 ? { ...t, hp: 9 } : t)) } })).toMatch(/hp/)
    expect(refused(fresh(87), { type: 'report', result: ok })).toMatch(/no mission/)
  })
})

describe('auto-resolve (AUTO)', () => {
  it('AUTO-1 auto-resolve has the deploy preconditions and resolves at once', () => {
    const s = fresh(91)
    const r = go(s, { type: 'autoResolve', incident: s.incidents[0]!.id, squad: ids(s) })
    expect(r.s.phase).toBe('week')
    expect(r.s.incidents[0]!.result).not.toBeNull()
    expect(refused(r.s, { type: 'autoResolve', incident: s.incidents[0]!.id, squad: ids(s) })).toMatch(/already gone out|closed/)
  })

  it('AUTO-2 / AUTO-3 strength from base, rank and specialty against a difficulty threshold; the chance is clamped', () => {
    const s = fresh(92)
    s.roster[0]!.rank = 3; s.roster[0]!.xp = 9; s.roster[0]!.cls = 'enforcer'
    const i = inc(s, { difficulty: 3, kind: 'bust' })
    const b = campaignQuery.autoOdds(s, i.id, ['t1', 't2'])!
    const T = s.tuning.auto
    expect(b.members[0]).toEqual({ id: 't1', base: T.base, rank: 3 * T.perRank, specialty: T.specialty, total: T.base + 3 * T.perRank + T.specialty })
    expect(b.strength).toBe(2 * T.base + 3 * T.perRank + T.specialty)
    expect(b.threshold).toBe(T.diffBase + 3 * T.perDiff)
    expect(b.raw).toBe(T.center + (b.strength - b.threshold) * T.scale)
    expect(b.win).toBe(Math.min(T.max, Math.max(T.min, b.raw)))
    expect(b.win + b.partial + b.loss).toBe(100)
    // the roll decides the outcome bands
    for (let seed = 1; seed < 30; seed++) {
      const x = fresh(seed)
      const r = go(x, { type: 'autoResolve', incident: x.incidents[0]!.id, squad: ids(x) })
      const e = find(r.ev, 'autoResolve')!
      const want = e.roll < e.breakdown.win ? 'win' : e.roll < e.breakdown.win + e.breakdown.partial ? 'partial' : 'loss'
      expect(e.outcome).toBe(want)
    }
  })

  it('AUTO-4 each trooper rolls death, then injury, by outcome', () => {
    const s = fresh(93, { auto: { min: 0, max: 0, partialBand: 0, death: { loss: 100 } } })
    const r = go(s, { type: 'autoResolve', incident: s.incidents[0]!.id, squad: ids(s, 2) })
    expect(r.s.roster.filter((t) => t.status === 'dead').length).toBe(2)
    const s2 = fresh(93, { auto: { min: 0, max: 0, partialBand: 0, death: { loss: 0 }, injury: { loss: 100 } } })
    const r2 = go(s2, { type: 'autoResolve', incident: s2.incidents[0]!.id, squad: ids(s2, 3) })
    expect(r2.s.roster.filter((t) => t.status === 'injured' && t.injuryWeeks === s2.tuning.injury.downed).length).toBe(3)
    expect(kinds(r2.ev).filter((k) => k === 'autoCasualty').length).toBe(3)
  })

  it('AUTO-5 rewards: arrests credited in squad order, bust Intel, raid Evidence and Intel from arrests, a possible civilian casualty', () => {
    const s = fresh(94, { ...ALWAYS_WIN, auto: { ...ALWAYS_WIN.auto, casualty: { win: 100 } } })
    const bust = inc(s, { kind: 'bust', role: 'regular' })
    const r = go(s, { type: 'autoResolve', incident: bust.id, squad: ['t1', 't2'] }).s
    expect(r.intel).toBe(s.tuning.auto.intel.win)
    expect(r.report!.troopers.map((t) => t.arrests)).toEqual([2, 1])
    expect(r.report!.civilianCasualties).toBe(1)
    const s2 = fresh(94, ALWAYS_WIN)
    const raid = inc(s2, { kind: 'raid', role: 'regular' })
    const r2 = go(s2, { type: 'autoResolve', incident: raid.id, squad: ids(s2) }).s
    expect(r2.evidence).toBe(s2.tuning.auto.evidence.win)
    expect(r2.intel).toBe(s2.tuning.auto.arrests.win)
  })
})

describe('after-action (AAR)', () => {
  it('AAR-1 / AAR-2 / AAR-3 a result applies Order, Takeover, Intel, troopers; closes the incident; the report lists it all', () => {
    let s = fresh(101)
    const i = s.incidents.find((x) => x.role === 'regular')!
    s = go(s, { type: 'deploy', incident: i.id, squad: ['t1', 't2'] }).s
    const r = go(s, { type: 'report', result: result(s, 'loss', { intel: 1, civilianCasualties: 1 }, { t2: { downed: true, hp: 0 } }) }).s
    expect(r.incidents.find((x) => x.id === i.id)!.result).toBe('loss')
    expect(r.missionsThisWeek).toBe(1)
    const rep = campaignQuery.report(r)!
    expect(rep).toMatchObject({ mode: 'deployed', outcome: 'loss', orderFrom: 3, orderTo: 1, takeoverFrom: 0, takeoverTo: 0, intel: 1, civilianCasualties: 1, week: 1 })
    expect(rep.troopers.find((t) => t.id === 't2')).toMatchObject({ injuryWeeks: 3, dead: false, xp: 1 })
    expect(rep.incident.id).toBe(i.id)
    expect(r.stats).toMatchObject({ losses: 1, missionsDeployed: 1 })
  })
})

describe('campaign end (END)', () => {
  it('END-1 / END-2 / R-2 the Kingpin unlocks on the Intel threshold and spawns every week until won', () => {
    let s = fresh(111)
    expect(s.outcome).toBeNull()
    s.intel = s.tuning.kingpin.intel - 2
    s = deployFirst(s).s
    const r = go(s, { type: 'report', result: result(s, 'win', { intel: 2 }) })
    expect(r.s.kingpinUnlocked).toBe(true)
    expect(kinds(r.ev)).toContain('kingpinUnlocked')
    s = go(r.s, { type: 'endWeek' }).s
    expect(s.incidents.filter((i) => i.role === 'kingpin').length).toBe(1)
    s = go(s, { type: 'endWeek' }).s
    expect(s.incidents.filter((i) => i.role === 'kingpin').length).toBe(1)
  })

  it('END-4 a won Kingpin mission wins the campaign; a partial does not; nothing is legal afterwards', () => {
    let s = fresh(112)
    s.kingpinUnlocked = true
    s = go(s, { type: 'endWeek' }).s
    const kp = s.incidents.find((i) => i.role === 'kingpin')!
    const d = go(s, { type: 'deploy', incident: kp.id, squad: ids(s) }).s
    const p = go(d, { type: 'report', result: result(d, 'partial') }).s
    expect(p.outcome).toBeNull()
    expect(p.takeover).toBe(s.takeover + s.tuning.takeover.kingpinFail)
    const w = go(d, { type: 'report', result: result(d, 'win') })
    expect(w.s).toMatchObject({ outcome: 'won', phase: 'over', endReason: 'kingpin' })
    expect(find(w.ev, 'campaignEnd')).toMatchObject({ outcome: 'won' })
    expect(refused(w.s, { type: 'endWeek' })).toMatch(/over/)
    const a = fresh(112, ALWAYS_WIN)
    a.kingpinUnlocked = true
    const a2 = go(a, { type: 'endWeek' }).s
    expect(go(a2, { type: 'autoResolve', incident: a2.incidents.find((i) => i.role === 'kingpin')!.id, squad: ids(a2) }).s.outcome).toBe('won')
  })

  it('END-5 the summary counts weeks, the Takeover, missions, falls, losses, promotions, Intel and Evidence', () => {
    let s = fresh(113, ALWAYS_LOSE)
    s.roster[0]!.xp = 5; s.roster[0]!.rank = 2
    s = go(s, { type: 'promote', trooper: 't1', cls: 'chem' }).s
    s = go(s, { type: 'autoResolve', incident: s.incidents[0]!.id, squad: ids(s) }).s
    s = go(s, { type: 'endWeek' }).s
    const sum = campaignQuery.summary(s)
    expect(sum).toMatchObject({ outcome: null, weeks: 2, missions: 1, missionsAuto: 1, losses: 1, promotions: 1, takeoverMax: 12, districtsStanding: 6 })
    expect(sum.takeoverPct).toBe(Math.round((s.takeover / 12) * 100))
  })
})

describe('invariants (CINV)', () => {
  it('CINV-2 / CINV-3 / CINV-4 / CINV-5 the checker flags broken states and passes good ones', () => {
    const s = fresh(121)
    expect(checkCampaignInvariants(s)).toEqual([])
    const bad = (f: (x: CampaignState) => void, id: string): void => {
      const x = JSON.parse(JSON.stringify(s)) as CampaignState
      f(x)
      expect(checkCampaignInvariants(x).some((m) => m.startsWith(id))).toBe(true)
    }
    bad((x) => { x.districts[0]!.order = 6 }, 'CINV-2')
    bad((x) => { x.districts[0]!.fallen = true }, 'CINV-2')
    bad((x) => { x.takeover = 13 }, 'CINV-3')
    bad((x) => { x.funding = -1 }, 'CINV-3')
    bad((x) => { x.countdown = 9 }, 'CINV-3')
    bad((x) => { x.roster[1]!.id = 't1' }, 'CINV-4')
    bad((x) => { x.roster[0]!.status = 'injured' }, 'CINV-4')
    bad((x) => { x.roster[0]!.xp = 20 }, 'CINV-4')
    bad((x) => { x.week = 99 }, 'CINV-5')
    bad((x) => { x.phase = 'deployed' }, 'CINV-5')
    bad((x) => { x.missionsThisWeek = 2 }, 'CINV-5')
    expect(stepCampaign(s, { type: 'endWeek' }).ok).toBe(true)
  })
})
