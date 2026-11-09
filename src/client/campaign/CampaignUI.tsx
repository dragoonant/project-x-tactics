// The strategy layer's screens over the holo-table: dispatch bar, Takeover track, incident list and brief, roster, after-action
// report, end-of-week confirm and the campaign end. Every number comes from campaignQuery (CMP-4); this file only formats.
import { campaignQuery, incidentTitle } from '../../campaign'
import type { CampaignState, Incident, Report } from '../../campaign'
import { CLASSES } from '../../data'
import { useStore } from '../game/store'
import { SettingsButton } from '../ui/Hud'
import { useStrategyAssets } from './assets'
import {
  autoResolve, currentSquad, deploy, endWeek, newCampaign, promote, recruit, returnToCity, selectIncident, setPanel, toStandby, toggleTrooper, treat,
} from './controller'
import { incidentColor, orderColor } from './City'
import './city.css'

const pad = (n: number): string => String(n).padStart(2, '0')
const OUTCOME: Record<string, string> = { win: 'INCIDENT CLOSED', partial: 'PARTIAL RESULT', loss: 'INCIDENT FAILED' }
const className = (cls: string): string => CLASSES[cls]?.name ?? cls

function TakeoverTrack({ s }: { s: CampaignState }): React.JSX.Element {
  const t = campaignQuery.takeover(s)
  return (
    <div className="takeover panel" data-testid="takeover" data-value={t.value}>
      <div className="lab"><span>THE TAKEOVER</span><span><b>{t.value}</b> / {t.max}</span></div>
      <div className="segs">{Array.from({ length: t.max }, (_, i) => <i key={i} className={i < t.value ? (t.full ? 'on full' : 'on') : ''} />)}</div>
      <div className="sub">
        {t.countdown !== null
          ? <b className="count" data-testid="countdown">FINAL COUNTDOWN: {t.countdown} WEEK{t.countdown === 1 ? '' : 'S'} LEFT</b>
          : <span>+{t.scheduled} at the end of {t.nextAdvanceIn === 0 ? 'this week' : `week ${t.nextAdvanceWeek}`}</span>}
      </div>
    </div>
  )
}

function DispatchBar({ s }: { s: CampaignState }): React.JSX.Element {
  const w = campaignQuery.week(s)
  const f = campaignQuery.funding(s)
  const k = campaignQuery.kingpin(s)
  const ready = s.roster.filter((t) => t.status === 'ready').length
  return (
    <div className="dispatch panel pa">
      <div className="row"><span className="rec-dot" /><span className="cam">PRECINCT DISPATCH</span><span className="round" data-testid="week">WEEK {pad(w.week)}</span></div>
      <div className="stats">
        <span data-testid="funding">FUNDING <b>{f.funding}</b><small>+{f.nextIncome} end of {f.weeksToIncome === 0 ? 'this week' : `week ${f.incomeWeek}`}</small></span>
        <span data-testid="intel">INTEL <b>{k.intel}</b><small>{k.unlocked ? 'KINGPIN FOUND' : `kingpin at ${k.need}`}</small></span>
        <span>EVIDENCE <b>{s.evidence}</b></span>
        <span>READY <b>{ready}</b><small>of {s.roster.filter((t) => t.status !== 'dead').length}</small></span>
      </div>
    </div>
  )
}

function Diff({ n }: { n: number }): React.JSX.Element { return <span className="diff">{Array.from({ length: 5 }, (_, i) => <i key={i} className={i < n ? 'on' : ''} />)}</span> }

function IncidentList({ s }: { s: CampaignState }): React.JSX.Element {
  const sel = useStore((x) => x.cincident)
  const w = campaignQuery.week(s)
  return (
    <div className="incidents panel pa" data-testid="incidents">
      <h4>INCIDENTS / WEEK {pad(s.week)} {w.missionsLeft > 0 ? `/ ${w.missionsLeft} SQUAD AVAILABLE` : '/ SQUAD USED THIS WEEK'}</h4>
      <div className="list">
        {s.incidents.map((i) => {
          const d = s.districts.find((x) => x.id === i.district)!
          const done = i.result !== null
          return (
            <button key={i.id} className={`icard${sel === i.id ? ' sel' : ''}${done ? ' done' : ''}`} onClick={() => selectIncident(sel === i.id ? null : i.id)} data-testid="incident-card" data-incident={i.id} disabled={done}>
              <span className="dot" style={{ background: incidentColor(i) }} />
              <span className="t"><b>{incidentTitle(i)}</b><small>{d.name}{done ? ` / ${String(i.result).toUpperCase()}` : ''}</small></span>
              <Diff n={i.difficulty} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Brief({ s, id }: { s: CampaignState; id: string }): React.JSX.Element | null {
  const csquad = useStore((x) => x.csquad)
  const skyline = useStrategyAssets((a) => a.skylines)
  const squad = csquad ?? currentSquad(s)
  const b = campaignQuery.incident(s, id, squad)
  if (!b) return null
  const problem = campaignQuery.missionProblem(s, id, squad)
  const o = b.odds
  const roster = campaignQuery.roster(s).filter((t) => t.trooper.status !== 'dead')
  const sky = skyline[b.incident.district]
  return (
    <div className="brief panel pa" data-testid="brief">
      {sky && <div className="sky" style={{ backgroundImage: `url(${sky})` }} />}
      <h4>BRIEF / {b.districtName.toUpperCase()}</h4>
      <div className="body">
        <div className="ttl" style={{ color: incidentColor(b.incident) }}>{b.title}</div>
        <ul className="notes">{b.notes.map((n) => <li key={n.label}><b>{n.label}:</b> {n.text}</li>)}</ul>
        <div className="sq">
          <div className="lab">SQUAD ({squad.length}) / tap to change</div>
          <div className="picks">
            {roster.map(({ trooper: t, className: cn }) => (
              <button key={t.id} className={`pick${squad.includes(t.id) ? ' on' : ''}`} disabled={t.status !== 'ready'} onClick={() => toggleTrooper(t.id)} data-testid="squad-pick" data-trooper={t.id}>
                <b>{t.name}</b><small>{cn} R{t.rank}{t.status === 'injured' ? ` / hurt ${t.injuryWeeks}w` : ''}</small>
              </button>
            ))}
          </div>
        </div>
        <div className="odds">
          <div className="bar"><i className="w" style={{ width: `${o.win}%` }} /><i className="p" style={{ width: `${o.partial}%` }} /><i className="l" style={{ width: `${o.loss}%` }} /></div>
          <div className="kv"><span>AUTO-RESOLVE</span><b data-testid="win-chance">{o.win}% win</b><span>{o.partial}% partial / {o.loss}% loss</span></div>
          <div className="kv dim"><span>Squad strength {o.strength} vs threshold {o.threshold}</span></div>
        </div>
        {problem && <div className="err" data-testid="brief-problem">{problem.charAt(0).toUpperCase() + problem.slice(1)}</div>}
        <div className="btnrow">
          <button className="primary" onClick={() => deploy()} disabled={!!problem} data-testid="deploy">DEPLOY TO THE NIGHT MARKET</button>
          <button onClick={() => autoResolve()} disabled={!!problem} data-testid="auto-resolve">AUTO-RESOLVE</button>
        </div>
      </div>
    </div>
  )
}

function ReportView({ r }: { r: Report }): React.JSX.Element {
  return (
    <>
      <h2 className={r.outcome} data-testid="aar-outcome">{OUTCOME[r.outcome]}</h2>
      <div className="meta">{incidentTitle(r.incident)} / {r.districtName} / week {r.week} / {r.mode === 'auto' ? 'auto-resolved' : r.mode === 'aborted' ? 'withdrawn' : 'deployed'}</div>
      <table>
        <tbody>
          {r.breakdown && r.roll !== null && <tr><td>Auto-resolve roll</td><td>{r.roll} against {r.breakdown.win}% win / {r.breakdown.partial}% partial</td></tr>}
          <tr><td>District Order</td><td>{r.orderFrom} &rarr; {r.orderTo}{r.fell ? ' (FELL)' : ''}{r.retaken ? ' (RETAKEN)' : ''}</td></tr>
          <tr><td>The Takeover</td><td>{r.takeoverFrom} &rarr; {r.takeoverTo}</td></tr>
          <tr><td>Arrests / Intel / Evidence</td><td>{r.arrests} / +{r.intel} / +{r.evidence}</td></tr>
          <tr><td>Civilian casualties</td><td>{r.civilianCasualties}</td></tr>
        </tbody>
      </table>
      <table className="troopers">
        <tbody>
          {r.troopers.map((t) => (
            <tr key={t.id} className={t.dead ? 'kia' : ''}>
              <td>{t.name}<small> {className(t.cls)}</small></td>
              <td>{t.dead ? 'KILLED IN ACTION' : `+${t.xp} XP${t.rankTo > t.rankFrom ? `, RANK ${t.rankTo}` : ''}${t.injuryWeeks ? `, injured ${t.injuryWeeks} wk` : ''}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function AfterAction({ s }: { s: CampaignState }): React.JSX.Element | null {
  const r = campaignQuery.report(s)
  if (!r) return null
  return (
    <div className="modal pa" data-testid="aar">
      <div className="report">
        <div className="kick"><span>AFTER-ACTION REPORT</span><span>SEED {r.incident.seed}</span></div>
        <ReportView r={r} />
        <div className="btnrow">
          <button className="primary" onClick={() => setPanel('none')} data-testid="aar-close">BACK TO THE CITY</button>
          <button onClick={() => setPanel('roster')}>ROSTER</button>
        </div>
      </div>
    </div>
  )
}

function Roster({ s }: { s: CampaignState }): React.JSX.Element {
  const costs = campaignQuery.costs(s)
  const err = useStore((x) => x.cerror)
  return (
    <div className="modal pa" data-testid="roster">
      <div className="report roster">
        <div className="kick"><span>ROSTER / BARRACKS {costs.rosterLiving} OF {costs.rosterMax}</span><span>FUNDING {s.funding}</span></div>
        <div className="rlist">
          {campaignQuery.roster(s).map(({ trooper: t, className: cn, nextXp, canPromote }) => (
            <div key={t.id} className={`rrow ${t.status}`} data-testid="roster-row" data-trooper={t.id}>
              <div className="nm"><b>{t.name}</b><small>{cn} / RANK {t.rank}</small></div>
              <div className="xp">XP {t.xp}{nextXp !== null ? ` / ${nextXp}` : ' (max)'}<small>{t.missions} missions, {t.arrests} arrests</small></div>
              <div className="st">{t.status === 'ready' ? 'READY' : t.status === 'injured' ? `INJURED ${t.injuryWeeks} WK` : 'KILLED IN ACTION'}</div>
              <div className="act">
                {canPromote && (
                  <select defaultValue="" onChange={(e) => { if (e.target.value) promote(t.id, e.target.value) }} data-testid={`promote-${t.id}`}>
                    <option value="" disabled>PROMOTE TO...</option>
                    {costs.specialties.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
                {t.status === 'injured' && <button onClick={() => treat(t.id)} disabled={s.funding < costs.treat} data-testid={`treat-${t.id}`}>TREAT ({costs.treat})</button>}
              </div>
            </div>
          ))}
        </div>
        {err && <div className="err">{err}</div>}
        <div className="btnrow">
          <button onClick={() => recruit()} disabled={!!costs.recruitProblem} data-testid="recruit">RECRUIT ({costs.recruit}){costs.recruitProblem ? `: ${costs.recruitProblem}` : ''}</button>
          <button className="primary" onClick={() => setPanel('none')} data-testid="roster-close">CLOSE</button>
        </div>
      </div>
    </div>
  )
}

function ConfirmEnd({ s }: { s: CampaignState }): React.JSX.Element {
  const open = s.incidents.filter((i: Incident) => i.result === null && i.role === 'regular')
  return (
    <div className="modal pa" data-testid="confirm-end">
      <div className="report">
        <div className="kick"><span>END THE WEEK?</span></div>
        <div className="warn">The squad has not gone out this week. {open.length} incident{open.length === 1 ? '' : 's'} will be ignored, and each ignored incident costs its district Order:</div>
        <ul className="notes">{open.map((i) => { const d = s.districts.find((x) => x.id === i.district)!; return <li key={i.id}>{d.name}: Order {d.order}</li> })}</ul>
        <div className="btnrow">
          <button className="danger" onClick={() => endWeek(true)} data-testid="confirm-end-week">END THE WEEK ANYWAY</button>
          <button className="primary" onClick={() => setPanel('none')}>BACK</button>
        </div>
      </div>
    </div>
  )
}

export function CityHud(): React.JSX.Element | null {
  const s = useStore((x) => x.campaign)
  const sel = useStore((x) => x.cincident)
  const panel = useStore((x) => x.cpanel)
  const err = useStore((x) => x.cerror)
  if (!s) return null
  const w = campaignQuery.week(s)
  const showBrief = !!sel && s.incidents.some((i) => i.id === sel && i.result === null) && w.missionsLeft > 0
  return (
    <div className="hud city-hud" data-testid="city-hud">
      <DispatchBar s={s} />
      <div className="topright"><TakeoverTrack s={s} /></div>
      <SettingsButton shifted />
      <div className="sheet">
        {showBrief ? <Brief s={s} id={sel} /> : <IncidentList s={s} />}
        {showBrief && <button className="back pa" onClick={() => selectIncident(null)} data-testid="brief-back">&larr; ALL INCIDENTS</button>}
        {err && panel === 'none' && <div className="err pa">{err}</div>}
        <div className="cbtns pa">
          <button onClick={() => setPanel('roster')} data-testid="open-roster">ROSTER</button>
          {s.report && <button onClick={() => setPanel('aar')} data-testid="open-aar">LAST REPORT</button>}
          <button onClick={() => toStandby()} data-testid="to-standby">STANDBY</button>
          <button className="primary" onClick={() => endWeek(false)} data-testid="end-week">END WEEK {pad(s.week)}</button>
        </div>
      </div>
      <div className="legend pa">
        <span><i style={{ background: incidentColor({ kind: 'bust', role: 'regular' }) }} />BUST</span>
        <span><i style={{ background: incidentColor({ kind: 'raid', role: 'regular' }) }} />RAID</span>
        <span><i style={{ background: incidentColor({ kind: 'raid', role: 'retake' }) }} />RETAKE</span>
        <span><i style={{ background: incidentColor({ kind: 'bust', role: 'kingpin' }) }} />KINGPIN</span>
        <span><i style={{ background: orderColor({ order: 1, fallen: false }) }} />LOW ORDER</span>
      </div>
      {panel === 'aar' && <AfterAction s={s} />}
      {panel === 'roster' && <Roster s={s} />}
      {panel === 'confirmEnd' && <ConfirmEnd s={s} />}
    </div>
  )
}

export function CampaignEnd(): React.JSX.Element | null {
  const s = useStore((x) => x.campaign)
  if (!s) return null
  const sum = campaignQuery.summary(s)
  const won = sum.outcome === 'won'
  const r = campaignQuery.report(s)
  return (
    <div className="screen" data-testid="campaign-end">
      <div className="report">
        <div className="kick"><span>CASE FILE / CLOSED</span><span>SEED {s.setup.seed}</span></div>
        <h2 className={won ? 'win' : 'loss'} data-testid="campaign-outcome">{won ? 'CASE CLOSED: THE KINGPIN IS IN CUSTODY' : sum.reason === 'stall' ? 'THE CASE WENT COLD' : 'CITY LOST: THE TAKEOVER IS COMPLETE'}</h2>
        <table>
          <tbody>
            <tr><td>Weeks</td><td>{sum.weeks}</td></tr>
            <tr><td>The Takeover</td><td>{sum.takeover} / {sum.takeoverMax} ({sum.takeoverPct}%)</td></tr>
            <tr><td>Missions (auto / deployed)</td><td>{sum.missions} ({sum.missionsAuto} / {sum.missionsDeployed})</td></tr>
            <tr><td>Won / partial / lost</td><td>{sum.wins} / {sum.partials} / {sum.losses}</td></tr>
            <tr><td>Incidents ignored</td><td>{sum.ignored}</td></tr>
            <tr><td>Districts standing / fallen</td><td>{sum.districtsStanding} / {sum.districtsFallen}</td></tr>
            <tr><td>Troopers lost</td><td>{sum.troopersLost}</td></tr>
            <tr><td>Promotions / recruits</td><td>{sum.promotions} / {sum.recruits}</td></tr>
            <tr><td>Intel / Evidence / Funding</td><td>{sum.intel} / {sum.evidence} / {sum.funding}</td></tr>
          </tbody>
        </table>
        {r && <details><summary>Last after-action report</summary><ReportView r={r} /></details>}
        <div className="btnrow">
          <button className="primary" onClick={() => newCampaign(Math.floor(Math.random() * 1_000_000) + 1)} data-testid="new-campaign-again">NEW CAMPAIGN</button>
          <button onClick={() => toStandby()} data-testid="end-standby">STANDBY</button>
        </div>
      </div>
    </div>
  )
}

/** End screen of a campaign mission: the way back to the city. */
export function ReturnToCity(): React.JSX.Element {
  return <button className="primary" onClick={() => returnToCity()} data-testid="return-city">RETURN TO THE CITY</button>
}
