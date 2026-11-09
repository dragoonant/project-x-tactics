// Bodycam "standby" screen: Continue (names the squad, round, phase, Alarm and when it was saved), New Operation with the squad
// picker and a seed field, and the credit line.
import { useState } from 'react'
import { CLASSES, WEAPONS } from '../../data'
import { campaignQuery } from '../../campaign'
import { continueCampaign, discardCampaign, newCampaign } from '../campaign/controller'
import { MAP_ID, continueGame, discardSave, startGame } from '../game/controller'
import { useStore, set } from '../game/store'
import { SettingsButton } from './Hud'

const CLASS_IDS = Object.keys(CLASSES)

function when(ts: number): string {
  if (!ts) return 'at an unknown time'
  const d = new Date(ts)
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000))
  const ago = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} d ago`
  return `${d.toLocaleString()} (${ago})`
}

/** Campaign entry (spec 20; rule 22): Continue names the week, the Takeover, Funding and the roster; New asks before replacing. */
function CampaignSection(): React.JSX.Element {
  const cs = useStore((s) => s.campaignSave)
  const confirm = useStore((s) => s.confirmNewCampaign)
  const err = useStore((s) => s.cerror)
  const seed = useStore((s) => s.picker.seed)
  const models = useStore((s) => s.models)
  const [discardAsk, setDiscardAsk] = useState(false)
  const start = (): void => {
    if (cs.kind === 'ok' && !confirm) { set({ confirmNewCampaign: true }); return }
    newCampaign(seed)
  }
  const s = cs.kind === 'ok' ? cs.state : null
  const t = s ? campaignQuery.takeover(s) : null
  return (
    <div className="sect" data-testid="campaign-sect">
      <h3>CAMPAIGN / THE CITY</h3>
      {s && t && (
        <div className="meta" data-testid="campaign-continue-card">
          Week <b>{s.week}</b>{s.phase === 'deployed' ? ' (squad deployed)' : ''}, Takeover <b>{t.value} / {t.max}</b>{t.countdown !== null ? `, countdown ${t.countdown} wk` : ''}<br />
          Funding <b>{s.funding}</b>, Intel <b>{s.intel}</b>, roster <b>{s.roster.filter((x) => x.status !== 'dead').length}</b>, seed {s.setup.seed}<br />
          Saved {when(cs.kind === 'ok' ? cs.savedAt : 0)}
        </div>
      )}
      {cs.kind === 'bad' && <div className="err" data-testid="campaign-bad-save">The saved campaign cannot be opened: {cs.reason}.</div>}
      <div className="btnrow">
        {s && <button className="primary" onClick={() => continueCampaign()} disabled={!models.ready} data-testid="continue-campaign">CONTINUE CAMPAIGN</button>}
        <button className={s ? '' : 'primary'} onClick={start} disabled={!models.ready} data-testid="new-campaign">{confirm ? 'CONFIRM: REPLACE THE SAVED CAMPAIGN' : 'NEW CAMPAIGN'}</button>
        {confirm && <button onClick={() => set({ confirmNewCampaign: false })}>CANCEL</button>}
        {cs.kind !== 'none' && !discardAsk && <button className="danger" onClick={() => setDiscardAsk(true)} data-testid="discard-campaign">DISCARD</button>}
        {discardAsk && <button className="danger" onClick={() => { discardCampaign(); setDiscardAsk(false) }} data-testid="confirm-discard-campaign">CONFIRM DISCARD</button>}
      </div>
      {confirm && <div className="warn">A new campaign overwrites the saved one.</div>}
      {discardAsk && <div className="warn">Discarding deletes the saved campaign for good.</div>}
      {err && <div className="err">{err}</div>}
    </div>
  )
}

export function StartScreen(): React.JSX.Element {
  const picker = useStore((s) => s.picker)
  const save = useStore((s) => s.save)
  const models = useStore((s) => s.models)
  const confirmNew = useStore((s) => s.confirmNew)
  const hint = useStore((s) => s.hint)

  const setSlot = (i: number, v: string): void => set({ picker: { ...picker, squad: picker.squad.map((c, k) => (k === i ? v : c)) }, confirmNew: false })
  const randomize = (): void => set({ picker: { ...picker, seed: Math.floor(Math.random() * 1_000_000) + 1 } })
  const ready = models.ready
  const start = (): void => {
    if (save.kind === 'ok' && !confirmNew) { set({ confirmNew: true }); return }
    startGame({ mapId: MAP_ID, squad: [...picker.squad], seed: picker.seed })
  }

  return (
    <div className="screen" data-testid="start-screen">
      <div className="start-card">
        <div className="kick">BODYCAM FEED / STANDBY</div>
        <h1>PROJECT-X<small>OPERATION NIGHT MARKET</small></h1>

        {save.kind === 'ok' && (
          <div className="sect" data-testid="continue-card">
            <h3>SAVED OPERATION</h3>
            <div className="meta">
              Squad <b>{save.meta.squad.map((k) => CLASSES[k]?.name ?? k).join(', ')}</b><br />
              Round <b>{save.meta.round}</b>, {save.meta.phase} phase, Alarm <b>{save.meta.alarm}</b>, seed {save.meta.seed}<br />
              Saved {when(save.meta.savedAt)}
            </div>
            <div className="btnrow"><button className="primary" onClick={() => continueGame()} data-testid="continue">CONTINUE</button></div>
          </div>
        )}
        {save.kind === 'bad' && (
          <div className="sect" data-testid="bad-save">
            <h3>SAVED OPERATION</h3>
            <div className="err">The saved operation cannot be opened: {save.reason}.</div>
            <div className="btnrow"><button className="danger" onClick={() => discardSave()} data-testid="discard">DISCARD SAVE</button></div>
          </div>
        )}

        <CampaignSection />

        <div className="sect">
          <h3>SINGLE OPERATION / SQUAD OF FOUR</h3>
          <div className="slots">
            {picker.squad.map((c, i) => {
              const d = CLASSES[c]
              return (
                <div className="slot" key={i}>
                  <select value={c} onChange={(e) => setSlot(i, e.target.value)} data-testid={`slot-${i}`}>
                    {CLASS_IDS.map((id) => <option key={id} value={id}>{CLASSES[id]!.name}</option>)}
                  </select>
                  <small>{d ? `HP ${d.hp} / MOVE ${d.mobility} / AIM ${d.aim} / ${WEAPONS[d.weapon]?.name ?? d.weapon}` : ''}</small>
                </div>
              )
            })}
          </div>
          <div className="seedrow">
            <label htmlFor="seed">SEED</label>
            <input id="seed" inputMode="numeric" value={String(picker.seed)} data-testid="seed" onChange={(e) => { const n = Number(e.target.value.replace(/[^0-9]/g, '')); set({ picker: { ...picker, seed: Number.isFinite(n) ? n : 1 } }) }} />
            <button onClick={randomize} data-testid="randomize">RANDOMIZE</button>
          </div>
          <div className="btnrow">
            <button className="primary" onClick={start} disabled={!ready} data-testid="new-op">
              {!ready ? `Loading models ${models.done}/${models.total}` : confirmNew ? 'CONFIRM: REPLACE THE SAVED OPERATION' : 'NEW OPERATION'}
            </button>
            {confirmNew && <button onClick={() => set({ confirmNew: false })}>CANCEL</button>}
          </div>
          {confirmNew && <div className="warn">Starting a new operation overwrites the saved one.</div>}
          {hint && <div className="err">{hint}</div>}
        </div>
        <div className="credit">Unofficial prototype &mdash; credit: evilgouki</div>
      </div>
      <SettingsButton />
    </div>
  )
}
