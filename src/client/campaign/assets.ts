// Optional strategy art and audio (spec 40): reads public/assets/strategy/manifest.json once. Everything is optional: a missing
// manifest or file leaves plain geometry, text and silence. Images are preloaded before the city shows them (rule 26).
import { create } from 'zustand'

export interface StrategyAssets {
  status: 'loading' | 'ready' | 'none'
  emblems: Record<string, string>
  skylines: Record<string, string>
  table: string | null
  music: string | null
  sfx: Record<string, string>
}

export const useStrategyAssets = create<StrategyAssets>(() => ({ status: 'loading', emblems: {}, skylines: {}, table: null, music: null, sfx: {} }))

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

/** Resolves a manifest path; never throws. */
function resolver(manifestUrl: string): (p: unknown) => string | null {
  return (p) => { const s = str(p); if (!s) return null; try { return new URL(s, new URL('./', manifestUrl)).toString() } catch { return null } }
}

function preloadImage(url: string): Promise<boolean> {
  return new Promise((res) => {
    const img = new Image()
    img.onload = () => res(true)
    img.onerror = () => res(false)
    img.src = url
  })
}

let started: Promise<void> | null = null
export function loadStrategyAssets(): Promise<void> {
  if (started) return started
  started = (async () => {
    try {
      if (typeof __PX_MANIFESTS__ !== 'undefined' && !__PX_MANIFESTS__.strategy) throw new Error('this build ships no strategy manifest')
      const url = new URL('assets/strategy/manifest.json', document.baseURI).toString()
      const r = await fetch(url, { cache: 'no-cache' })
      if (!r.ok || /text\/html/.test(r.headers.get('content-type') ?? '')) throw new Error('no manifest')
      const j = (await r.json()) as Record<string, any>
      const at = resolver(url)
      const emblems: Record<string, string> = {}
      const skylines: Record<string, string> = {}
      for (const [id, d] of Object.entries<any>(j.districts ?? {})) {
        const e = at(d?.emblem); if (e) emblems[id] = e
        const k = at(d?.skyline); if (k) skylines[id] = k
      }
      const sfx: Record<string, string> = {}
      for (const [id, p] of Object.entries<unknown>(j.audio?.sfx ?? {})) { const u = at(p); if (u) sfx[id] = u }
      const table = at(j.textures?.table)
      // rule 26: images are loaded before they are shown; a failed one is dropped (plain geometry or text instead)
      const check = async (m: Record<string, string>): Promise<void> => { for (const [k, u] of Object.entries(m)) if (!(await preloadImage(u))) delete m[k] }
      await Promise.all([check(emblems), check(skylines)])
      const tableOk = table ? await preloadImage(table) : false
      useStrategyAssets.setState({ status: 'ready', emblems, skylines, table: tableOk ? table : null, music: at(j.audio?.music?.strategy), sfx })
    } catch {
      useStrategyAssets.setState({ status: 'none' })
    }
  })()
  return started
}
