// The campaign rules (spec 20): incidents, Order, the Takeover, Funding, injuries, XP, auto-resolve and after-action.
import { CAMPAIGN } from '../data'
import type { AutoBreakdown, CampaignState, CCtx, District, Incident, IncidentKind, IncidentRole, MissionResult, MOutcome, Report, Trooper, TrooperChange } from './types'
import { clamp, ctn, d100, emit, rankFor, rollInt } from './util'

export function districtOf(s: CampaignState, id: string): District | undefined { return s.districts.find((d) => d.id === id) }
export function trooperOf(s: CampaignState, id: string): Trooper | undefined { return s.roster.find((t) => t.id === id) }
export const isSpecialist = (t: Trooper): boolean => t.cls !== 'recruit'

// ------------------------------------------------------------------------------------------------ Takeover and Order
/** TAKE-1: clamp and emit. */
export function addTakeover(c: CCtx, delta: number, reason: string): void {
  const s = c.s
  const from = s.takeover
  const to = clamp(from + delta, 0, ctn(s, 'takeover.segments'))
  if (to === from && delta !== 0) { emit(c, 'takeover', { from, to, delta, reason, clamped: true }); return }
  s.takeover = to
  emit(c, 'takeover', { from, to, delta, reason })
}

/** DIST-2 / DIST-4: set a standing district's Order; reaching 0 makes it fall at once. */
export function setOrder(c: CCtx, d: District, value: number, reason: string): void {
  const s = c.s
  if (d.fallen) return // DIST-3
  const from = d.order
  const to = clamp(value, 0, ctn(s, 'order.max'))
  d.order = to
  if (to !== from) emit(c, 'order', { district: d.id, from, to, reason })
  if (to === 0) {
    d.fallen = true
    s.stats.fallen++
    emit(c, 'districtFell', { district: d.id })
    addTakeover(c, ctn(s, 'takeover.fall'), `${d.id} fell`)
  }
}

// ------------------------------------------------------------------------------------------------ incidents (INC)
/** INC-4. */
function difficultyFor(c: CCtx, role: IncidentRole): { value: number; breakdown: Record<string, number> } {
  const s = c.s
  const max = ctn(s, 'difficulty.max')
  if (role === 'kingpin') return { value: clamp(ctn(s, 'difficulty.kingpin'), 1, max), breakdown: { kingpin: ctn(s, 'difficulty.kingpin') } }
  const base = ctn(s, 'difficulty.base')
  const fromTakeover = Math.floor(s.takeover / Math.max(1, ctn(s, 'difficulty.perTakeover')))
  const roll = rollInt(s, 0, ctn(s, 'difficulty.spread'))
  const retake = role === 'retake' ? ctn(s, 'difficulty.retake') : 0
  return { value: clamp(base + fromTakeover + roll + retake, 1, max), breakdown: { base, fromTakeover, roll, retake } }
}

function makeIncident(c: CCtx, district: string, kind: IncidentKind, role: IncidentRole): Incident {
  const s = c.s
  const diff = difficultyFor(c, role)
  const inc: Incident = { id: `i${++s.nextId}`, district, kind, role, difficulty: diff.value, seed: rollInt(s, 1, 999_999), result: null }
  emit(c, 'incident', { incident: inc.id, district, incidentKind: kind, role, difficulty: inc.difficulty, difficultyBreakdown: diff.breakdown, seed: inc.seed })
  return inc
}

/** INC-1..3 and INC-6: the week's incidents. */
export function spawnIncidents(c: CCtx): void {
  const s = c.s
  s.incidents = []
  const standing = s.districts.filter((d) => !d.fallen)
  const thirdRoll = d100(s)
  const thirdChance = ctn(s, 'incidents.thirdChance')
  let n = ctn(s, 'incidents.base') + (thirdRoll < thirdChance ? 1 : 0)
  emit(c, 'incidentCount', { roll: thirdRoll, chance: thirdChance, base: ctn(s, 'incidents.base'), count: n, standing: standing.length })
  n = Math.min(n, standing.length)
  const pool = [...standing]
  for (let i = 0; i < n; i++) {
    const d = pool.splice(rollInt(s, 0, pool.length - 1), 1)[0]!
    const kr = d100(s)
    const kind: IncidentKind = kr < ctn(s, 'incidents.raidChance') ? 'raid' : 'bust'
    s.incidents.push(makeIncident(c, d.id, kind, 'regular'))
  }
  const fallen = s.districts.find((d) => d.fallen)
  if (fallen) s.incidents.push(makeIncident(c, fallen.id, 'raid', 'retake'))
  if (s.kingpinUnlocked) {
    const d = s.districts[rollInt(s, 0, s.districts.length - 1)]!
    s.incidents.push(makeIncident(c, d.id, 'bust', 'kingpin'))
  }
}

// ------------------------------------------------------------------------------------------------ auto-resolve (AUTO)
/** AUTO-2 / AUTO-3: the odds, with their breakdown (also query.autoOdds). */
export function autoBreakdown(s: CampaignState, inc: Incident, squad: Trooper[]): AutoBreakdown {
  const members = squad.map((t) => {
    const base = ctn(s, 'auto.base')
    const rank = ctn(s, 'auto.perRank') * t.rank
    const specialty = isSpecialist(t) ? ctn(s, 'auto.specialty') : 0
    return { id: t.id, base, rank, specialty, total: base + rank + specialty }
  })
  const strength = members.reduce((a, m) => a + m.total, 0)
  const raid = inc.kind === 'raid' ? ctn(s, 'auto.raid') : 0
  const difficulty = ctn(s, 'auto.perDiff') * inc.difficulty
  const threshold = ctn(s, 'auto.diffBase') + difficulty + raid
  const raw = ctn(s, 'auto.center') + (strength - threshold) * ctn(s, 'auto.scale')
  const win = clamp(raw, ctn(s, 'auto.min'), ctn(s, 'auto.max'))
  const partial = Math.min(100 - win, ctn(s, 'auto.partialBand'))
  return { strength, members, threshold, difficulty, raid, raw, win, partial, loss: 100 - win - partial }
}

/** AUTO-3..5: roll an incident's result. */
export function autoResult(c: CCtx, inc: Incident, squad: Trooper[]): { result: MissionResult; roll: number; breakdown: AutoBreakdown } {
  const s = c.s
  const b = autoBreakdown(s, inc, squad)
  const roll = d100(s)
  const outcome: MOutcome = roll < b.win ? 'win' : roll < b.win + b.partial ? 'partial' : 'loss'
  emit(c, 'autoResolve', { incident: inc.id, roll, outcome, breakdown: b })
  const deathChance = ctn(s, `auto.death.${outcome}`)
  const injuryChance = ctn(s, `auto.injury.${outcome}`)
  const troopers = squad.map((t) => {
    const dr = d100(s)
    const dead = dr < deathChance
    const ir = dead ? null : d100(s)
    const downed = ir !== null && ir < injuryChance
    emit(c, 'autoCasualty', { trooper: t.id, deathRoll: dr, deathChance, injuryRoll: ir, injuryChance, dead, downed })
    return { id: t.id, dead, downed, hp: 1, maxHp: 1, arrests: 0 }
  })
  const arrests = ctn(s, `auto.arrests.${outcome}`)
  const alive = troopers.filter((t) => !t.dead)
  for (let i = 0; i < arrests && alive.length; i++) alive[i % alive.length]!.arrests++
  const cr = d100(s)
  const casualtyChance = ctn(s, `auto.casualty.${outcome}`)
  const civilianCasualties = cr < casualtyChance ? 1 : 0
  emit(c, 'autoCivilians', { roll: cr, chance: casualtyChance, casualties: civilianCasualties })
  const intel = inc.kind === 'bust' ? ctn(s, `auto.intel.${outcome}`) : arrests
  const evidence = inc.kind === 'raid' ? ctn(s, `auto.evidence.${outcome}`) : 0
  return { result: { outcome, intel, evidence, civilianCasualties, troopers }, roll, breakdown: b }
}

// ------------------------------------------------------------------------------------------------ after-action (AAR)
/** AAR-1..3: apply a mission result. */
export function applyResult(c: CCtx, inc: Incident, res: MissionResult, mode: Report['mode'], roll: number | null, breakdown: AutoBreakdown | null): void {
  const s = c.s
  const d = districtOf(s, inc.district)!
  const orderFrom = d.order
  const takeoverFrom = s.takeover
  const o = res.outcome
  // DIST-2 (not in a fallen district, DIST-3)
  let fell = false
  if (!d.fallen) {
    let delta = o === 'win' ? ctn(s, 'order.win') : o === 'partial' ? ctn(s, 'order.partial') : -ctn(s, 'order.loss')
    if (res.civilianCasualties > 0) delta -= ctn(s, 'order.casualty')
    setOrder(c, d, d.order + delta, `mission ${o}`)
    fell = d.fallen
  }
  // DIST-5 retake, TAKE-4 raid, END-2/4 kingpin
  let retaken = false
  if (o === 'win' && inc.kind === 'raid') addTakeover(c, -ctn(s, 'takeover.raid'), 'raid won')
  if (o === 'win' && inc.role === 'retake' && d.fallen) {
    d.fallen = false
    d.order = clamp(ctn(s, 'order.retake'), 0, ctn(s, 'order.max'))
    retaken = true
    emit(c, 'districtRetaken', { district: d.id, order: d.order })
    addTakeover(c, -ctn(s, 'takeover.retake'), `${d.id} retaken`)
  }
  if (inc.role === 'kingpin') {
    if (o === 'win') { s.outcome = 'won'; s.endReason = 'kingpin'; emit(c, 'campaignEnd', { outcome: 'won', reason: 'the Kingpin is in custody' }) }
    else addTakeover(c, ctn(s, 'takeover.kingpinFail'), 'the Kingpin got away')
  }
  // FUND-4
  if (res.intel > 0) { s.intel += res.intel; emit(c, 'intel', { gained: res.intel, total: s.intel }) }
  if (res.evidence > 0) { s.evidence += res.evidence; emit(c, 'evidence', { gained: res.evidence, total: s.evidence }) }
  if (!s.kingpinUnlocked && s.intel >= ctn(s, 'kingpin.intel')) { s.kingpinUnlocked = true; emit(c, 'kingpinUnlocked', { intel: s.intel }) }
  // ROST-4, PROM-1, PROM-2
  const changes: TrooperChange[] = []
  for (const tr of res.troopers) {
    const t = trooperOf(s, tr.id)!
    t.missions++
    t.arrests += tr.arrests
    const rankFrom = t.rank
    if (tr.dead) {
      t.status = 'dead'; t.injuryWeeks = 0
      s.stats.troopersLost++
      emit(c, 'trooperDied', { trooper: t.id })
      changes.push({ id: t.id, name: t.name, cls: t.cls, xp: 0, rankFrom, rankTo: rankFrom, injuryWeeks: 0, dead: true, arrests: tr.arrests })
      continue
    }
    const xp = ctn(s, 'xp.mission') + (o === 'win' ? ctn(s, 'xp.win') : 0) + ctn(s, 'xp.arrest') * tr.arrests
    t.xp += xp
    t.rank = rankFor(s, t.xp)
    emit(c, 'xp', { trooper: t.id, gained: xp, total: t.xp })
    if (t.rank > rankFrom) emit(c, 'rankUp', { trooper: t.id, from: rankFrom, to: t.rank })
    let weeks = 0
    if (tr.downed) weeks = ctn(s, 'injury.downed')
    else if (tr.hp * 100 <= tr.maxHp * ctn(s, 'injury.woundedPct')) weeks = ctn(s, 'injury.wounded')
    if (weeks > 0) { t.status = 'injured'; t.injuryWeeks = Math.max(t.injuryWeeks, weeks); emit(c, 'injured', { trooper: t.id, weeks: t.injuryWeeks, downed: tr.downed }) }
    changes.push({ id: t.id, name: t.name, cls: t.cls, xp, rankFrom, rankTo: t.rank, injuryWeeks: weeks, dead: false, arrests: tr.arrests })
  }
  // AAR-2
  inc.result = o
  s.missionsThisWeek++
  if (mode === 'auto') s.stats.missionsAuto++
  else s.stats.missionsDeployed++
  if (o === 'win') s.stats.wins++
  else if (o === 'partial') s.stats.partials++
  else s.stats.losses++
  // AAR-3
  s.report = {
    week: s.week, incident: { ...inc }, districtName: d.name, mode, outcome: o, roll, breakdown,
    orderFrom, orderTo: d.order, fell, retaken, takeoverFrom, takeoverTo: s.takeover,
    intel: res.intel, evidence: res.evidence, arrests: res.troopers.reduce((a, t) => a + t.arrests, 0), civilianCasualties: res.civilianCasualties,
    troopers: changes,
  }
  emit(c, 'missionReport', { incident: inc.id, outcome: o, mode })
}

// ------------------------------------------------------------------------------------------------ end of week (WEEK-4)
export function endWeek(c: CCtx): void {
  const s = c.s
  // (1) INC-5
  for (const inc of s.incidents) {
    if (inc.result !== null || inc.role !== 'regular') continue
    const d = districtOf(s, inc.district)!
    s.stats.ignored++
    emit(c, 'ignored', { incident: inc.id, district: d.id })
    setOrder(c, d, d.order - ctn(s, 'order.ignored'), 'incident ignored')
  }
  // (2) ROST-4
  for (const t of s.roster) {
    if (t.status !== 'injured') continue
    t.injuryWeeks = Math.max(0, t.injuryWeeks - 1)
    if (t.injuryWeeks === 0) { t.status = 'ready'; emit(c, 'healed', { trooper: t.id }) }
  }
  // (3) TAKE-2
  if (s.week % ctn(s, 'takeover.everyWeeks') === 0) addTakeover(c, ctn(s, 'takeover.scheduled'), 'scheduled')
  // (4) TAKE-5
  if (!s.outcome) {
    if (s.countdown !== null) {
      s.countdown -= 1
      emit(c, 'countdown', { weeksLeft: s.countdown })
      if (s.countdown <= 0) { s.countdown = 0; s.outcome = 'lost'; s.endReason = 'takeover'; emit(c, 'campaignEnd', { outcome: 'lost', reason: 'the Takeover is complete' }) }
    } else if (s.takeover >= ctn(s, 'takeover.segments')) {
      s.countdown = ctn(s, 'takeover.countdown')
      emit(c, 'countdownStarted', { weeksLeft: s.countdown })
    }
  }
  // (5) DIST-6 patrol recovery, then FUND-2 (both monthly)
  if (s.week % ctn(s, 'funding.periodWeeks') === 0) {
    for (const d of s.districts) if (!d.fallen && d.order < ctn(s, 'order.recoverTo')) setOrder(c, d, Math.min(ctn(s, 'order.recoverTo'), d.order + ctn(s, 'order.recover')), 'patrols')
  }
  if (s.week % ctn(s, 'funding.periodWeeks') === 0) {
    const shares = s.districts.map((d) => ({ district: d.id, order: d.fallen ? 0 : d.order, share: d.fallen ? 0 : d.order * ctn(s, 'funding.perOrder') }))
    const income = ctn(s, 'funding.base') + shares.reduce((a, x) => a + x.share, 0)
    s.funding += income
    emit(c, 'funding', { income, base: ctn(s, 'funding.base'), perOrder: ctn(s, 'funding.perOrder'), shares, total: s.funding })
  }
  // (6) next week, WEEK-5
  if (!s.outcome) {
    if (s.week + 1 > ctn(s, 'week.max')) { s.outcome = 'lost'; s.endReason = 'stall'; emit(c, 'campaignEnd', { outcome: 'lost', reason: 'the case went cold' }); return }
    s.week++
    s.missionsThisWeek = 0
    emit(c, 'weekStart', { week: s.week })
    spawnIncidents(c)
  }
}

export function newTrooper(s: CampaignState): Trooper {
  const n = s.nextId
  const names = CAMPAIGN.names
  const k = s.roster.length
  const name = `${names[k % names.length]}${k >= names.length ? ` ${Math.floor(k / names.length) + 1}` : ''}`
  s.nextId = n + 1
  return { id: `t${n + 1}`, name, cls: 'recruit', rank: 0, xp: 0, status: 'ready', injuryWeeks: 0, missions: 0, arrests: 0 }
}
