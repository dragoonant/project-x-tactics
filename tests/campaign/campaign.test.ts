// Spec 20: the campaign engine, named by rule id.
import { describe, expect, it } from 'vitest'
import {
  campaignQuery, checkCampaignInvariants, createCampaign, defaultSquad, deserializeCampaign, legalCampaignActions, replayCampaign, serializeCampaign, stepCampaign,
} from '../../src/campaign'
import type { CampaignState } from '../../src/campaign'
import { CAMPAIGN } from '../../src/data'
import { ALWAYS_LOSE, ALWAYS_WIN, all, deployFirst, dist, find, fresh, go, ids, kinds, refused, result, toWeek } from './helpers'

describe('contract (CMP)', () => {
  it('CMP-1 / DIST-1 / ROST-1 / TAKE-1 / FUND-1 / FUND-4 / WEEK-1 createCampaign: six districts at the starting Order, six Recruits, week 1 incidents', () => {
    const s = fresh(7)
    expect(s.districts.map((d) => d.id)).toEqual(['docks', 'foundry', 'spire', 'market', 'stacks', 'undercity'])
    expect(s.districts.every((d) => d.order === s.tuning.order.start && !d.fallen)).toBe(true)
    expect(s.roster.length).toBe(s.tuning.roster.start)
    expect(s.roster.every((t) => t.cls === 'recruit' && t.rank === 0 && t.xp === 0 && t.status === 'ready')).toBe(true)
    expect(s.roster.map((t) => t.name)).toEqual(CAMPAIGN.names.slice(0, 6))
    expect(s).toMatchObject({ week: 1, phase: 'week', takeover: 0, countdown: null, funding: s.tuning.start.funding, intel: 0, evidence: 0, outcome: null })
    expect(s.incidents.length).toBeGreaterThanOrEqual(2)
    expect(() => createCampaign({ seed: Number.NaN })).toThrow()
  })

  it('CMP-2 stepCampaign never mutates its input and refuses bad actions with a reason', () => {
    const s = fresh(2)
    const before = JSON.stringify(s)
    for (const bad of [null, 5, 'endWeek', {}, { type: 'fly' }, { type: 'deploy' }, { type: 'deploy', incident: 'nope', squad: ['t1'] }, { type: 'promote', trooper: 't1', cls: 'enforcer' }, { type: 'treat', trooper: 't1' }, { type: 'report', result: {} }, { type: 'abort' }]) {
      expect(refused(s, bad).length).toBeGreaterThan(3)
    }
    go(s, { type: 'endWeek' })
    go(s, { type: 'autoResolve', incident: s.incidents[0]!.id, squad: ids(s) })
    expect(JSON.stringify(s)).toBe(before)
  })

  it('CMP-3 / CINV-1 legal actions: never empty while running; endWeek in the week phase, abort when deployed, none once over', () => {
    let s = fresh(3)
    const l = legalCampaignActions(s)
    expect(l.some((a) => a.type === 'endWeek')).toBe(true)
    expect(l.some((a) => a.type === 'autoResolve' && JSON.stringify(a.squad) === JSON.stringify(defaultSquad(s)))).toBe(true)
    for (const a of l) expect(stepCampaign(s, a).ok).toBe(true)
    const d = deployFirst(s).s
    expect(legalCampaignActions(d)).toEqual([{ type: 'abort' }])
    s = { ...s, outcome: 'lost', phase: 'over' }
    expect(legalCampaignActions(s)).toEqual([])
  })

  it('CMP-4 campaignQuery: Takeover track, next Funding, district info, odds and trooper progress come from the engine', () => {
    const s = fresh(4)
    expect(campaignQuery.takeover(s)).toMatchObject({ value: 0, max: 12, pct: 0, countdown: null, nextAdvanceIn: 1 })
    const f = campaignQuery.funding(s)
    expect(f.nextIncome).toBe(s.tuning.funding.base + 6 * 3 * s.tuning.funding.perOrder)
    expect(f.weeksToIncome).toBe(3)
    expect(campaignQuery.districts(s)[0]).toMatchObject({ id: 'docks', order: 3, max: 5, modifier: { label: 'Rain and fog' } })
    const inc = s.incidents[0]!
    const brief = campaignQuery.incident(s, inc.id)!
    expect(brief.odds).toEqual(campaignQuery.autoOdds(s, inc.id))
    expect(brief.notes.length).toBeGreaterThanOrEqual(2)
    expect(campaignQuery.trooper(s, 't1')).toMatchObject({ className: 'Recruit', nextXp: s.tuning.rank.r1, canPromote: false })
    expect(campaignQuery.week(s)).toMatchObject({ week: 1, missionsLeft: 1 })
    expect(campaignQuery.kingpin(s)).toEqual({ unlocked: false, intel: 0, need: s.tuning.kingpin.intel })
  })

  it('CMP-5 / CMP-9 / CINV-6 plain JSON; serialize / deserialize round trip; replay reproduces; bad saves are refused with a reason', () => {
    let s = fresh(5)
    s = go(s, { type: 'autoResolve', incident: s.incidents[0]!.id, squad: ids(s) }).s
    s = go(s, { type: 'endWeek' }).s
    s = deployFirst(s).s
    s = go(s, { type: 'report', result: result(s, 'win', { intel: 3 }) }).s
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
    const env = serializeCampaign(s)
    expect(env).toMatchObject({ v: 1, kind: 'px-campaign', seed: 5 })
    const d = deserializeCampaign(JSON.stringify(env))
    expect(d.ok && d.state).toEqual(s)
    const r = replayCampaign(env.setup, env.actions)
    expect(r.ok && r.state).toEqual(s)
    for (const bad of [null, '{', { v: 2 }, { v: 1, kind: 'px-save' }, { ...env, state: { week: 1 } }, { ...env, actions: 3 }]) {
      const x = deserializeCampaign(bad)
      expect(x.ok).toBe(false)
    }
  })

  it('CMP-6 same seed and actions give the same campaign; incident seeds come from the campaign RNG', () => {
    const run = (seed: number): CampaignState => {
      let s = fresh(seed)
      for (let i = 0; i < 6; i++) {
        s = go(s, { type: 'autoResolve', incident: s.incidents[0]!.id, squad: defaultSquad(s) }).s
        s = go(s, { type: 'endWeek' }).s
      }
      return s
    }
    expect(run(9)).toEqual(run(9))
    expect(run(9).rng).not.toEqual(run(10).rng)
    expect(fresh(9).incidents.map((i) => i.seed)).not.toEqual(fresh(10).incidents.map((i) => i.seed))
  })

  it('CMP-7 rolls carry their breakdown; Order, Takeover, Funding, Intel and roster changes emit events', () => {
    const s = fresh(6, ALWAYS_WIN)
    const inc = s.incidents.find((i) => i.kind === 'bust') ?? s.incidents[0]!
    const r = go(s, { type: 'autoResolve', incident: inc.id, squad: ids(s) })
    const roll = find(r.ev, 'autoResolve')!
    expect(roll.breakdown).toMatchObject({ strength: 40, win: 100 })
    expect(typeof roll.roll).toBe('number')
    expect(kinds(r.ev)).toEqual(expect.arrayContaining(['autoCasualty', 'autoCivilians', 'order', 'xp', 'missionReport']))
    expect(find(r.ev, 'incident')).toBeUndefined()
    const w = toWeek(r.s, 2)
    const e = go(w, { type: 'endWeek' }).ev
    expect(find(e, 'takeover')).toMatchObject({ from: 0, to: 1, reason: 'scheduled' })
    expect(find(e, 'incidentCount')).toHaveProperty('roll')
  })

  it('CMP-8 the log keeps accepted actions only', () => {
    let s = fresh(8)
    stepCampaign(s, { type: 'treat', trooper: 't1' })
    s = go(s, { type: 'endWeek' }).s
    s = go(s, { type: 'recruit' }).s
    expect(s.log).toEqual([{ type: 'endWeek' }, { type: 'recruit' }])
  })
})

describe('the week (WEEK)', () => {
  it('WEEK-2 / R-9 one mission per week, any incident kind', () => {
    let s = fresh(11)
    s = go(s, { type: 'autoResolve', incident: s.incidents[0]!.id, squad: ids(s) }).s
    expect(refused(s, { type: 'autoResolve', incident: s.incidents[1]!.id, squad: ids(s) })).toMatch(/already gone out/)
    expect(refused(s, { type: 'deploy', incident: s.incidents[1]!.id, squad: ids(s) })).toMatch(/already gone out/)
    s = go(s, { type: 'endWeek' }).s
    expect(stepCampaign(s, { type: 'autoResolve', incident: s.incidents[0]!.id, squad: ids(s) }).ok).toBe(true)
  })

  it('WEEK-3 management works before and after the mission but not while deployed', () => {
    let s = fresh(12)
    s = go(s, { type: 'recruit' }).s
    s = go(s, { type: 'autoResolve', incident: s.incidents[0]!.id, squad: ids(s) }).s
    s = go(s, { type: 'recruit' }).s
    const d = deployFirst(go(s, { type: 'endWeek' }).s).s
    expect(refused(d, { type: 'recruit' })).toMatch(/mission is running/)
    expect(refused(d, { type: 'endWeek' })).toMatch(/abort/)
  })

  it('WEEK-4 endWeek resolves ignored incidents, injuries, the scheduled advance, the countdown, Funding, then the new week', () => {
    let s = fresh(13, { order: { start: 5 } })
    s = toWeek(s, 4)
    s.roster[0]!.status = 'injured'; s.roster[0]!.injuryWeeks = 1
    s.takeover = 11
    const r = go(s, { type: 'endWeek' })
    const order = ['ignored', 'healed', 'takeover', 'countdownStarted', 'funding', 'weekStart', 'incident']
    const seen = kinds(r.ev).filter((k) => order.includes(k))
    const firsts = order.map((k) => seen.indexOf(k))
    expect(firsts.every((i) => i >= 0)).toBe(true)
    expect([...firsts].sort((a, b) => a - b)).toEqual(firsts)
    expect(r.s.week).toBe(5)
    expect(r.s.missionsThisWeek).toBe(0)
  })

  it('WEEK-5 / END-3 the stall cap loses the campaign', () => {
    let s = fresh(14, { week: { max: 3 }, order: { ignored: 0 } })
    s = toWeek(s, 3)
    const r = go(s, { type: 'endWeek' })
    expect(r.s).toMatchObject({ outcome: 'lost', endReason: 'stall', phase: 'over', week: 3 })
    expect(find(r.ev, 'campaignEnd')).toMatchObject({ outcome: 'lost' })
  })
})

describe('districts and Order (DIST)', () => {
  it('DIST-2 Order moves by mission outcome and civilian casualties, clamped to 0-max', () => {
    const run = (o: 'win' | 'partial' | 'loss', cas = 0, start = 3): number => {
      const s = fresh(21)
      const inc = s.incidents.find((i) => i.role === 'regular')!
      dist(s, inc.district).order = start
      const d = go(s, { type: 'deploy', incident: inc.id, squad: ids(s) }).s
      return dist(go(d, { type: 'report', result: result(d, o, { civilianCasualties: cas }) }).s, inc.district).order
    }
    expect(run('win')).toBe(4)
    expect(run('partial')).toBe(3)
    expect(run('loss')).toBe(2)
    expect(run('win', 1)).toBe(3)
    expect(run('loss', 2)).toBe(1)
    expect(run('win', 0, 5)).toBe(5)
  })

  it('DIST-3 / DIST-4 / TAKE-3 / R-4 a district at Order 0 falls at once: Takeover +2, no Funding, Order frozen', () => {
    const s = fresh(22)
    const inc = s.incidents.find((i) => i.role === 'regular')!
    dist(s, inc.district).order = 1
    const d = go(s, { type: 'deploy', incident: inc.id, squad: ids(s) }).s
    const r = go(d, { type: 'report', result: result(d, 'loss') })
    expect(dist(r.s, inc.district)).toMatchObject({ order: 0, fallen: true })
    expect(r.s.takeover).toBe(2)
    expect(kinds(r.ev)).toContain('districtFell')
    expect(r.s.report).toMatchObject({ fell: true, takeoverFrom: 0, takeoverTo: 2 })
    expect(campaignQuery.funding(r.s).shares.find((x) => x.district === inc.district)!.share).toBe(0)
    const w = go(r.s, { type: 'endWeek' }).s
    expect(dist(w, inc.district).order).toBe(0)
  })

  it('DIST-5 / TAKE-4 / INC-3 a fallen district gets a Retake raid each week; winning it restores Order and pushes the Takeover back twice', () => {
    let s = fresh(23, ALWAYS_WIN)
    s.districts[1]!.order = 0; s.districts[1]!.fallen = true
    s.districts[4]!.order = 0; s.districts[4]!.fallen = true
    s.takeover = 6
    s = go(s, { type: 'endWeek' }).s
    const rt = s.incidents.filter((i) => i.role === 'retake')
    expect(rt.length).toBe(1)
    expect(rt[0]).toMatchObject({ district: 'foundry', kind: 'raid' })
    expect(s.incidents.filter((i) => i.role === 'regular').every((i) => i.district !== 'foundry' && i.district !== 'stacks')).toBe(true)
    const before = s.takeover
    const r = go(s, { type: 'autoResolve', incident: rt[0]!.id, squad: ids(s) })
    expect(dist(r.s, 'foundry')).toMatchObject({ fallen: false, order: s.tuning.order.retake })
    expect(r.s.takeover).toBe(before - s.tuning.takeover.raid - s.tuning.takeover.retake)
    expect(r.s.report?.retaken).toBe(true)
  })

  it('DIST-6 / R-11 monthly patrols lift standing districts below the recovery Order by 1, up to it', () => {
    let s = fresh(24, { order: { ignored: 0 } })
    s = toWeek(s, 4)
    s.districts[0]!.order = 1
    s.districts[1]!.order = 2
    s.districts[2]!.order = 4
    s.districts[3]!.order = 0; s.districts[3]!.fallen = true
    const r = go(s, { type: 'endWeek' }).s
    expect(r.districts.map((d) => d.order).slice(0, 4)).toEqual([2, 3, 4, 0])
    const r2 = go(toWeek(r, 6), { type: 'endWeek' }).s
    expect(r2.districts[0]!.order).toBe(2) // only in Funding weeks
  })
})

describe('incidents (INC)', () => {
  it('INC-1 / INC-2 / INC-6 2-3 incidents a week in distinct standing districts; busts and raids; each with a seed', () => {
    const counts = new Set<number>()
    let raids = 0, total = 0
    for (let seed = 1; seed <= 80; seed++) {
      const s = fresh(seed)
      const reg = s.incidents.filter((i) => i.role === 'regular')
      counts.add(reg.length)
      expect(new Set(reg.map((i) => i.district)).size).toBe(reg.length)
      for (const i of reg) { total++; if (i.kind === 'raid') raids++; expect(i.seed).toBeGreaterThan(0) }
    }
    expect([...counts].sort()).toEqual([2, 3])
    expect(raids / total).toBeGreaterThan(0.05)
    expect(raids / total).toBeLessThan(0.3)
    const s = fresh(1)
    for (let k = 0; k < 4; k++) { s.districts[k]!.fallen = true; s.districts[k]!.order = 0 }
    s.districts[5]!.fallen = true; s.districts[5]!.order = 0
    const w = go(s, { type: 'endWeek' }).s
    expect(w.incidents.filter((i) => i.role === 'regular').map((i) => i.district)).toEqual(['stacks'])
  })

  it('INC-4 difficulty = base + floor(Takeover / perTakeover) + spread roll (+1 retake), clamped; the Kingpin is fixed', () => {
    let s = fresh(31)
    s.takeover = 7
    const r = go(s, { type: 'endWeek' })
    expect(all(r.ev, 'incident').length).toBeGreaterThanOrEqual(2)
    for (const e of all(r.ev, 'incident')) {
      const b = e.difficultyBreakdown
      if (e.role === 'kingpin') continue
      expect(b.fromTakeover).toBe(Math.floor(r.s.takeover / s.tuning.difficulty.perTakeover))
      expect(e.difficulty).toBe(Math.min(5, Math.max(1, b.base + b.fromTakeover + b.roll + b.retake)))
      expect(b.roll).toBeGreaterThanOrEqual(0)
      expect(b.roll).toBeLessThanOrEqual(s.tuning.difficulty.spread)
    }
    s = fresh(31)
    s.intel = 999; s.kingpinUnlocked = true
    const k = go(s, { type: 'endWeek' }).s.incidents.find((i) => i.role === 'kingpin')!
    expect(k.difficulty).toBe(s.tuning.difficulty.kingpin)
  })

  it('INC-5 ignored regular incidents cost their district Order; Retake and Kingpin incidents cost nothing', () => {
    const s = fresh(32)
    s.districts[5]!.fallen = true; s.districts[5]!.order = 0
    s.kingpinUnlocked = true
    const w = go(s, { type: 'endWeek' }).s
    const before = w.districts.map((d) => d.order)
    const r = go(w, { type: 'endWeek' })
    const ign = all(r.ev, 'ignored')
    expect(ign.length).toBe(w.incidents.filter((i) => i.role === 'regular').length)
    for (const i of w.incidents.filter((x) => x.role === 'regular')) {
      const k = w.districts.findIndex((d) => d.id === i.district)
      expect(r.s.districts[k]!.order).toBe(Math.max(0, before[k]! - 1))
    }
    expect(r.s.stats.ignored).toBe(w.stats.ignored + ign.length)
  })
})

describe('the Takeover (TAKE)', () => {
  it('TAKE-1 / TAKE-2 +1 at the end of every second week, never above the track', () => {
    let s = fresh(41, { order: { ignored: 0 } })
    s = go(s, { type: 'endWeek' }).s
    expect(s.takeover).toBe(0)
    s = go(s, { type: 'endWeek' }).s
    expect(s.takeover).toBe(1)
    s.takeover = 12; s.countdown = 3
    s = toWeek(s, 4)
    expect(s.takeover).toBe(12)
  })

  it('TAKE-3 a Kingpin mission that is not won adds +1', () => {
    const s = fresh(42, ALWAYS_LOSE)
    s.kingpinUnlocked = true
    const w = go(s, { type: 'endWeek' }).s
    const kp = w.incidents.find((i) => i.role === 'kingpin')!
    const r = go(w, { type: 'autoResolve', incident: kp.id, squad: ids(w) })
    expect(r.s.takeover).toBe(w.takeover + w.tuning.takeover.kingpinFail)
    expect(r.s.outcome).toBeNull()
  })

  it('TAKE-4 a won raid pushes the Takeover back 1', () => {
    for (let seed = 1; seed < 60; seed++) {
      const s = fresh(seed, ALWAYS_WIN)
      const raid = s.incidents.find((i) => i.kind === 'raid' && i.role === 'regular')
      if (!raid) continue
      s.takeover = 5
      const r = go(s, { type: 'autoResolve', incident: raid.id, squad: ids(s) })
      expect(r.s.takeover).toBe(4)
      expect(find(r.ev, 'takeover')).toMatchObject({ reason: 'raid won', from: 5, to: 4 })
      return
    }
    throw new Error('no raid found')
  })

  it('TAKE-5 / END-3 / R-3 a full track starts a 3-week countdown that a raid does not stop; at 0 the city is lost', () => {
    let s = fresh(43, { order: { ignored: 0 } })
    s.takeover = 12
    s = go(s, { type: 'endWeek' }).s
    expect(s.countdown).toBe(3)
    s.takeover = 8
    s = go(s, { type: 'endWeek' }).s
    expect(s.countdown).toBe(2)
    s = go(s, { type: 'endWeek' }).s
    expect(s.countdown).toBe(1)
    const r = go(s, { type: 'endWeek' })
    expect(r.s).toMatchObject({ outcome: 'lost', endReason: 'takeover', phase: 'over' })
    expect(campaignQuery.takeover(r.s).countdown).toBe(0)
  })
})

describe('Funding (FUND)', () => {
  it('FUND-1 / FUND-3 spending can never take Funding below zero', () => {
    const s = fresh(51, { start: { funding: 50 } })
    const r = go(s, { type: 'recruit' }).s
    expect(r.funding).toBe(10)
    expect(refused(r, { type: 'recruit' })).toMatch(/Funding/)
    expect(campaignQuery.costs(r).recruitProblem).toMatch(/Funding/)
  })

  it('FUND-2 / R-10 monthly income = base + perOrder x summed Order of standing districts', () => {
    let s = fresh(52, { order: { ignored: 0, recoverTo: 0 } })
    s = toWeek(s, 4)
    s.districts[0]!.order = 5
    s.districts[1]!.order = 0; s.districts[1]!.fallen = true
    const before = s.funding
    const r = go(s, { type: 'endWeek' })
    const ev = find(r.ev, 'funding')!
    const expected = s.tuning.funding.base + s.tuning.funding.perOrder * (5 + 0 + 3 + 3 + 3 + 3)
    expect(ev.income).toBe(expected)
    expect(ev.shares[1]).toEqual({ district: 'foundry', order: 0, share: 0 })
    expect(r.s.funding).toBe(before + expected)
    expect(find(go(r.s, { type: 'endWeek' }).ev, 'funding')).toBeUndefined()
  })

  it('FUND-4 Intel and Evidence only grow and nothing spends them', () => {
    let s = fresh(53)
    s = deployFirst(s).s
    s = go(s, { type: 'report', result: result(s, 'win', { intel: 4, evidence: 3 }) }).s
    expect([s.intel, s.evidence]).toEqual([4, 3])
    expect(legalCampaignActions(s).every((a) => !('intel' in a))).toBe(true)
  })
})

describe('roster (ROST)', () => {
  it('ROST-2 / ROST-3 squads: 1-4 distinct ready troopers', () => {
    const s = fresh(61)
    const inc = s.incidents[0]!.id
    s.roster[1]!.status = 'injured'; s.roster[1]!.injuryWeeks = 2
    s.roster[2]!.status = 'dead'
    expect(refused(s, { type: 'deploy', incident: inc, squad: [] })).toMatch(/at least one/)
    expect(refused(s, { type: 'deploy', incident: inc, squad: ['t1', 't4', 't5', 't6', 't1'] })).toMatch(/at most 4/)
    expect(refused(s, { type: 'deploy', incident: inc, squad: ['t1', 't1'] })).toMatch(/twice/)
    expect(refused(s, { type: 'deploy', incident: inc, squad: ['t2'] })).toMatch(/injured/)
    expect(refused(s, { type: 'deploy', incident: inc, squad: ['t3'] })).toMatch(/dead/)
    expect(refused(s, { type: 'deploy', incident: inc, squad: ['t99'] })).toMatch(/no trooper/)
    expect(go(s, { type: 'deploy', incident: inc, squad: ['t4'] }).s.deployment!.setup.squad).toEqual(['recruit'])
    expect(defaultSquad(s)).toEqual(['t1', 't4', 't5', 't6'])
  })

  it('ROST-4 deaths are permanent; downed = 3 weeks, wounded = 1 week; injuries heal one week per end of week', () => {
    let s = fresh(62)
    s = deployFirst(s).s
    const [a, b, c, d] = s.deployment!.squad as [string, string, string, string]
    s = go(s, { type: 'report', result: result(s, 'partial', {}, { [a]: { dead: true, hp: 0 }, [b]: { downed: true, hp: 0 }, [c]: { hp: 3 }, [d]: { hp: 4 } }) }).s
    const T = (id: string) => s.roster.find((t) => t.id === id)!
    expect(T(a)).toMatchObject({ status: 'dead' })
    expect(T(b)).toMatchObject({ status: 'injured', injuryWeeks: 3 })
    expect(T(c)).toMatchObject({ status: 'injured', injuryWeeks: 1 })
    expect(T(d)).toMatchObject({ status: 'ready', injuryWeeks: 0 })
    s = go(s, { type: 'endWeek' }).s
    expect(T(c).status).toBe('ready')
    expect(T(b)).toMatchObject({ status: 'injured', injuryWeeks: 2 })
    s = toWeek(s, 4)
    expect(T(b).status).toBe('ready')
    expect(T(a).status).toBe('dead')
  })

  it('ROST-5 recruiting costs Funding and adds a rank-0 Recruit, up to the barracks size', () => {
    let s = fresh(63, { start: { funding: 1000 } })
    for (let i = 0; i < 4; i++) s = go(s, { type: 'recruit' }).s
    expect(s.roster.length).toBe(10)
    expect(s.roster[9]).toMatchObject({ cls: 'recruit', rank: 0, status: 'ready', name: CAMPAIGN.names[9] })
    expect(s.funding).toBe(1000 - 4 * s.tuning.recruit.cost)
    expect(refused(s, { type: 'recruit' })).toMatch(/full/)
    s.roster[0]!.status = 'dead'
    expect(go(s, { type: 'recruit' }).s.roster.length).toBe(11)
  })

  it('ROST-6 treatment readies an injured trooper at once for its cost', () => {
    const s = fresh(64)
    s.roster[0]!.status = 'injured'; s.roster[0]!.injuryWeeks = 3
    const r = go(s, { type: 'treat', trooper: 't1' }).s
    expect(r.roster[0]).toMatchObject({ status: 'ready', injuryWeeks: 0 })
    expect(r.funding).toBe(s.funding - s.tuning.treat.cost)
    expect(refused(r, { type: 'treat', trooper: 't1' })).toMatch(/not injured/)
  })
})

describe('XP, ranks and promotion (PROM)', () => {
  it('PROM-1 / PROM-2 survivors gain mission + win + arrest XP; ranks follow the thresholds and emit rank-ups', () => {
    let s = fresh(71)
    s = deployFirst(s).s
    const [a, b] = s.deployment!.squad as [string, string]
    const r = go(s, { type: 'report', result: result(s, 'win', {}, { [a]: { arrests: 3 }, [b]: { dead: true, hp: 0 } }) })
    s = r.s
    const A = s.roster.find((t) => t.id === a)!
    expect(A.xp).toBe(1 + 1 + 3)
    expect(A.rank).toBe(2)
    expect(s.roster.find((t) => t.id === b)!.xp).toBe(0)
    expect(find(r.ev, 'rankUp')).toMatchObject({ trooper: a, from: 0, to: 2 })
    expect(s.report!.troopers.find((t) => t.id === a)).toMatchObject({ xp: 5, rankFrom: 0, rankTo: 2, arrests: 3 })
    expect(campaignQuery.trooper(s, a)!.nextXp).toBe(s.tuning.rank.r3)
  })

  it('PROM-3 a Recruit of rank 2 promotes, free, into one of the six specialties; specialists do not promote again', () => {
    const s = fresh(72)
    s.roster[0]!.xp = 5; s.roster[0]!.rank = 2
    expect(refused(s, { type: 'promote', trooper: 't2', cls: 'enforcer' })).toMatch(/rank 2/)
    expect(refused(s, { type: 'promote', trooper: 't1', cls: 'recruit' })).toMatch(/specialty/)
    expect(refused(s, { type: 'promote', trooper: 't1', cls: 'arbiter' })).toMatch(/specialty/)
    expect(legalCampaignActions(s).filter((a) => a.type === 'promote').length).toBe(6)
    const r = go(s, { type: 'promote', trooper: 't1', cls: 'marksman' })
    expect(r.s.roster[0]).toMatchObject({ cls: 'marksman', rank: 2, xp: 5 })
    expect(r.s.funding).toBe(s.funding)
    expect(refused(r.s, { type: 'promote', trooper: 't1', cls: 'recon' })).toMatch(/already a specialist/)
    expect(campaignQuery.trooper(r.s, 't1')!.className).toBe('Marksman')
  })

  it('PROM-4 / R-6 the class deploys as the tactical class; rank does not change tactical stats', () => {
    const s = fresh(73)
    s.roster[0]!.xp = 14; s.roster[0]!.rank = 4; s.roster[0]!.cls = 'bulwark'
    const d = go(s, { type: 'deploy', incident: s.incidents[0]!.id, squad: ['t2', 't1'] }).s
    expect(d.deployment!.setup.squad).toEqual(['recruit', 'bulwark'])
  })
})
