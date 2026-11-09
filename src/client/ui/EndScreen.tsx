// Incident report: an evidence-log export of the feed. Numbers come from `summarize` (query.summary).
import { useState } from 'react'
import { query } from '../../engine'
import { ENEMIES } from '../../data'
import { buildReport, replaySameSeed, toStart } from '../game/controller'
import { useStore } from '../game/store'
import { ReturnToCity } from '../campaign/CampaignUI'

const RAID_HEADLINE = { win: 'RAID SUCCESSFUL: EVIDENCE SEIZED', partial: 'EVIDENCE LOST: THE CACHE BURNED', loss: 'RAID FAILED' } as const
const HEADLINE = {
  win: 'OPERATION SUCCESSFUL: SUSPECT IN CUSTODY',
  partial: 'CASE SETBACK: TARGET KILLED, NO INTEL',
  loss: 'OPERATION FAILED',
} as const

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch { return false }
}

export function EndScreen(): React.JSX.Element | null {
  const state = useStore((s) => s.state)
  const campaignMode = useStore((s) => s.mode === 'campaign')
  const [copied, setCopied] = useState<'' | 'ok' | 'fail'>('')
  if (!state) return null
  const sum = query.summary(state)
  const o = sum.outcome ?? 'loss'
  const cls = o === 'win' ? 'win' : o === 'partial' ? 'partial' : 'loss'
  return (
    <div className="screen" data-testid="end-screen">
      <div className="report">
        <div className="kick"><span>INCIDENT REPORT / EVIDENCE LOG</span><span>SEED {sum.seed}</span></div>
        <h2 className={cls} data-testid="outcome">{sum.objective === 'raid' ? RAID_HEADLINE[o] : HEADLINE[o]}</h2>
        <table>
          <tbody>
            <tr><td>Rounds</td><td>{sum.rounds}</td></tr>
            <tr><td>Peak Alarm</td><td>{sum.peakAlarm} / {state.tuning.alarm.max}</td></tr>
            {Object.entries(sum.enemies).map(([k, t]) => (
              <tr key={k}><td>{ENEMIES[k]?.name ?? k}: arrested / killed{t.escapes ? ' / escaped' : ''}</td><td>{t.arrests} / {t.kills}{t.escapes ? ` / ${t.escapes}` : ''}</td></tr>
            ))}
            <tr><td>Intel gathered</td><td>{sum.intel}</td></tr>
            {sum.objective === 'raid' && <tr><td>Evidence seized</td><td>{sum.evidence}</td></tr>}
            <tr><td>Civilian casualties (Order cost)</td><td>{sum.civilianCasualties}</td></tr>
            <tr><td>Civilians safe</td><td>{sum.civiliansSafe}</td></tr>
            <tr><td>Troopers downed / dead</td><td>{sum.troopersDowned} / {sum.troopersDead}</td></tr>
            <tr><td>Squad</td><td>{state.setup.squad.join(', ')}</td></tr>
          </tbody>
        </table>
        <div className="btnrow">
          <button onClick={async () => setCopied((await copy(buildReport(state))) ? 'ok' : 'fail')} data-testid="copy-report">COPY REPORT</button>
          {campaignMode ? <ReturnToCity /> : <button className="primary" onClick={() => replaySameSeed()} data-testid="replay">REPLAY SAME SEED</button>}
          {!campaignMode && <button onClick={() => toStart()} data-testid="new-operation">NEW OPERATION</button>}
        </div>
        {copied === 'ok' && <div className="warn">Report copied to the clipboard.</div>}
        {copied === 'fail' && <div className="err">The browser refused clipboard access.</div>}
      </div>
    </div>
  )
}
