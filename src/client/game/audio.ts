// Optional audio wiring. If public/assets/audio/manifest.json exists it is read; every sound is looked up by id and missing
// files are skipped silently. Music follows the game state (calm / tense / combat / victory / defeat). Unlocked on the first
// touchend / pointerup / click (iOS). The settings panel shows "audio not found" when there is no manifest.
import type { GameEvent, State } from '../../engine'

type Found = 'unknown' | 'yes' | 'no'
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

class AudioDirector {
  found: Found = 'unknown'
  muted = false
  volume = 0.6
  private sfx = new Map<string, string>()
  private music = new Map<string, string>()
  private ctx: AudioContext | null = null
  private buffers = new Map<string, AudioBuffer | null>()
  private bgm: HTMLAudioElement | null = null
  private bgmKey = ''
  private lastCombat = -1e9
  private unlocked = false
  onFound: (f: Found) => void = () => { /* set by the store */ }

  async init(): Promise<void> {
    try {
      if (typeof __PX_MANIFESTS__ !== 'undefined' && !__PX_MANIFESTS__.audio) throw new Error('this build ships no audio manifest')
      const url = new URL('assets/audio/manifest.json', document.baseURI).toString()
      const r = await fetch(url, { cache: 'no-cache' })
      const ct = r.headers.get('content-type') ?? ''
      if (!r.ok || /text\/html/.test(ct)) throw new Error('no manifest')
      const json = (await r.json()) as unknown
      this.read(json, url)
      this.found = this.sfx.size + this.music.size > 0 ? 'yes' : 'no'
    } catch { this.found = 'no' }
    this.onFound(this.found)
    const unlock = (): void => { this.unlock() }
    for (const ev of ['touchend', 'pointerup', 'click']) window.addEventListener(ev, unlock, { passive: true })
  }

  private read(json: unknown, manifestUrl: string): void {
    const resolve = (f: string): string => (/^(https?:)?\/\//.test(f) ? f : f.startsWith('assets/') ? new URL(f, document.baseURI).toString() : new URL(f, new URL('./', manifestUrl)).toString())
    const put = (m: Map<string, string>, key: string, v: unknown): void => {
      const f = typeof v === 'string' ? v : v && typeof v === 'object' ? ((v as Record<string, unknown>).file ?? (v as Record<string, unknown>).path ?? (v as Record<string, unknown>).url) : undefined
      if (typeof f === 'string' && /\.(mp3|ogg|wav|m4a|webm|flac)$/i.test(f)) m.set(norm(key), resolve(f))
    }
    const walk = (node: unknown, kind: 'sfx' | 'music' | null): void => {
      if (Array.isArray(node)) { for (const it of node) if (it && typeof it === 'object') { const o = it as Record<string, unknown>; const id = o.id ?? o.name ?? o.key; if (typeof id === 'string') put(kind === 'music' || /music/i.test(String(o.type ?? o.kind ?? '')) ? this.music : this.sfx, id, o) } return }
      if (!node || typeof node !== 'object') return
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (/^music$|^bgm$|^tracks$/i.test(k)) walk(v, 'music')
        else if (/^sfx$|^sounds?$|^effects?$/i.test(k)) walk(v, 'sfx')
        else if (v && typeof v === 'object' && !('file' in (v as object)) && !('path' in (v as object)) && !('url' in (v as object))) walk(v, kind)
        else put(kind === 'music' ? this.music : this.sfx, k, v)
      }
    }
    walk(json, null)
  }

  setSettings(mute: boolean, volume: number): void {
    this.muted = mute
    this.volume = volume
    if (this.bgm) this.bgm.volume = mute ? 0 : Math.min(1, volume * 0.55)
  }

  private unlock(): void {
    if (this.unlocked || this.found !== 'yes') return
    this.unlocked = true
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (AC) { this.ctx = new AC(); void this.ctx.resume() }
    } catch { /* no WebAudio */ }
    if (this.bgmKey) this.playMusic(this.bgmKey, true)
  }

  private lookup(map: Map<string, string>, ...ids: string[]): string | null {
    for (const id of ids) { const k = norm(id); const hit = map.get(k); if (hit) return hit }
    for (const id of ids) { const k = norm(id); for (const [mk, v] of map) if (mk.includes(k) || k.includes(mk)) return v }
    return null
  }

  private async buffer(url: string): Promise<AudioBuffer | null> {
    if (this.buffers.has(url)) return this.buffers.get(url) ?? null
    this.buffers.set(url, null)
    try {
      const r = await fetch(url)
      if (!r.ok) return null
      const ab = await r.arrayBuffer()
      const b = await this.ctx!.decodeAudioData(ab)
      this.buffers.set(url, b)
      return b
    } catch { return null }
  }

  play(...ids: string[]): void {
    if (this.found !== 'yes' || this.muted || !this.unlocked || !this.ctx) return
    const url = this.lookup(this.sfx, ...ids)
    if (!url) return
    void this.buffer(url).then((b) => {
      if (!b || !this.ctx) return
      const src = this.ctx.createBufferSource()
      const g = this.ctx.createGain()
      g.gain.value = this.volume
      src.buffer = b
      src.connect(g).connect(this.ctx.destination)
      src.start()
    })
  }

  private playMusic(key: string, force = false): void {
    if (this.found !== 'yes') return
    if (key === this.bgmKey && !force) return
    this.bgmKey = key
    if (!this.unlocked) return
    const url = this.lookup(this.music, key, `music-${key}`)
    if (!url) { this.bgm?.pause(); return }
    try {
      this.bgm?.pause()
      const a = new Audio(url)
      a.loop = key !== 'victory' && key !== 'defeat'
      a.volume = this.muted ? 0 : Math.min(1, this.volume * 0.55)
      this.bgm = a
      void a.play().catch(() => { /* autoplay refused until a gesture */ })
    } catch { /* skip */ }
  }

  onEvents(events: GameEvent[]): void {
    for (const e of events) {
      switch (e.kind) {
        case 'attack':
          this.lastCombat = performance.now()
          this.play(`weapon-${String(e.weapon)}`, String(e.weapon))
          if (e.outcome === 'miss') this.play('ricochet')
          break
        case 'lampShot': this.play(`weapon-${String(e.weapon)}`, String(e.weapon)); break
        case 'cuffed': this.play('cuff', 'cuffs'); break
        case 'explosion': this.lastCombat = performance.now(); this.play('explosion'); break
        case 'gasCloud': this.play('gas'); break
        case 'doorOpened': this.play('breach', 'door'); break
        default: break
      }
    }
  }

  ui(kind: 'select' | 'confirm'): void { this.play(kind === 'select' ? 'ui-select' : 'ui-confirm', kind) }

  syncMusic(s: State | null): void {
    if (!s) { this.playMusic('calm'); return }
    if (s.outcome) { this.playMusic(s.outcome === 'loss' ? 'defeat' : 'victory'); return }
    const aware = s.groups.some((g) => g.aware)
    const combat = performance.now() - this.lastCombat < 14000
    this.playMusic(combat ? 'combat' : aware ? 'tense' : 'calm')
  }

  stopMusic(): void { this.bgm?.pause(); this.bgm = null; this.bgmKey = '' }
}

export const audio = new AudioDirector()
