// The asset contract of docs/spec/30-figures-anim.md, as pure code: canonical clip names, the fallback chain (a missing clip
// never leaves a T-pose), the item-swap rules, and a tolerant reader for public/assets/anim/manifest.json. No three.js, no DOM:
// everything here is unit-tested table-driven.

export const CLIPS = ['idle', 'cover', 'coverHigh', 'walk', 'run', 'aim', 'fire', 'melee', 'bash', 'throw', 'point', 'hit', 'downed', 'surrender', 'cuffed', 'death', 'panic', 'cower'] as const
export type ClipName = (typeof CLIPS)[number]

/** Clips that loop; every other clip plays once (aim and death then hold their last frame). */
export const LOOPING: ReadonlySet<ClipName> = new Set<ClipName>(['idle', 'cover', 'coverHigh', 'walk', 'run', 'downed', 'surrender', 'cuffed', 'panic', 'cower'])
/** Clips whose last frame stays on screen until the next state change. */
export const HOLDS_LAST: ReadonlySet<ClipName> = new Set<ClipName>(['aim', 'death'])

/** What to try, in order, when a clip is missing. Spec 30 section 2: idle always; run -> walk, cover -> idle, coverHigh -> cover, panic -> run, cower -> idle. */
export const FALLBACK: Record<ClipName, readonly ClipName[]> = {
  idle: [],
  cover: ['idle'],
  coverHigh: ['cover', 'idle'],
  walk: ['idle'],
  run: ['walk', 'idle'],
  aim: ['idle'],
  fire: ['aim', 'idle'],
  melee: ['fire', 'idle'],
  bash: ['melee', 'fire', 'idle'],
  throw: ['idle'],
  point: ['idle'],
  hit: ['idle'],
  downed: ['idle'],
  surrender: ['idle'],
  cuffed: ['surrender', 'idle'],
  death: ['downed', 'idle'],
  panic: ['run', 'walk', 'idle'],
  cower: ['idle'],
}

/** The clip to actually play for `want`, or null when not even `idle` exists (the figure then keeps its bind pose and the caller uses the static model). */
export function resolveClip(want: ClipName, has: (c: string) => boolean): ClipName | null {
  if (has(want)) return want
  for (const f of FALLBACK[want]) if (has(f)) return f
  return has('idle') ? 'idle' : null
}

/** A figure whose `death` / `downed` clip is missing is laid on its back by the client (as the static figures are); `surrender` / `cuffed` kneel. */
export function poseFallback(want: ClipName, resolved: ClipName | null): 'none' | 'lying' | 'kneel' {
  if (resolved === want) return 'none'
  if (want === 'death' || want === 'downed') return 'lying'
  if (want === 'surrender' || want === 'cuffed') return 'kneel'
  return 'none'
}

// ---- attachments (spec 30 section 3)
export const MELEE_ITEMS: ReadonlySet<string> = new Set(['maul'])
export const POINT_ITEMS: ReadonlySet<string> = new Set(['handset'])
/** Clips posed with empty hands (hands up, behind the back, on the ground, over the head): every held item is hidden. */
export const EMPTY_HAND_CLIPS: ReadonlySet<string> = new Set(['surrender', 'cuffed', 'downed', 'cower'])

/**
 * Which attachments are visible while `clip` plays. `maul` replaces the right-hand weapon during melee and bash, `handset` shows only during
 * point; every other attachment (weapon, shield, case, injector, baton) is always shown.
 */
export function visibleAttachments(atts: readonly { id: string; bone: string }[], clip: ClipName | null): boolean[] {
  if (clip && EMPTY_HAND_CLIPS.has(clip)) return atts.map(() => false)
  const melee = clip === 'melee' || clip === 'bash'
  const hasMaul = atts.some((a) => MELEE_ITEMS.has(a.id))
  const maulBone = atts.find((a) => MELEE_ITEMS.has(a.id))?.bone
  return atts.map((a) => {
    if (MELEE_ITEMS.has(a.id)) return melee
    if (POINT_ITEMS.has(a.id)) return clip === 'point'
    if (melee && hasMaul && a.bone === maulBone) return false
    return true
  })
}

// ---- manifest
export interface ClipDef { duration: number; loop: boolean; speed?: number }
export interface AttachmentDef { id: string; bone: string; matrix: number[]; muzzle?: [number, number, number] }
export interface FigureDef { kind: string; url: string; height: number; clips: Record<string, ClipDef>; attachments: AttachmentDef[] }
export interface AnimManifest { figures: Map<string, FigureDef>; items: Map<string, string> }

const ALIAS: Record<string, string> = { 'vox-operator': 'vox', voxoperator: 'vox', vox_operator: 'vox', 'chem-trooper': 'chem', chemtrooper: 'chem', chem_trooper: 'chem', 'the-bagman': 'bagman', thebagman: 'bagman' }
export function kindKey(k: string): string {
  const t = k.trim().toLowerCase()
  return ALIAS[t] ?? t
}

const GLB = /\.(glb|gltf|gltf\.json)(\?.*)?$/i
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

/** Tolerant reader: skips anything malformed instead of throwing. `base` is the manifest's own URL (files are relative to it). */
export function parseAnimManifest(json: unknown, base: string): AnimManifest {
  const out: AnimManifest = { figures: new Map(), items: new Map() }
  if (!json || typeof json !== 'object') return out
  const root = json as Record<string, unknown>
  const url = (f: string): string => new URL(f, base).toString()
  const figs = root.figures
  if (figs && typeof figs === 'object') {
    for (const [kind, v] of Object.entries(figs as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue
      const o = v as Record<string, unknown>
      if (typeof o.file !== 'string' || !GLB.test(o.file)) continue
      const clips: Record<string, ClipDef> = {}
      if (o.clips && typeof o.clips === 'object') {
        for (const [name, c] of Object.entries(o.clips as Record<string, unknown>)) {
          if (!c || typeof c !== 'object') continue
          const cc = c as Record<string, unknown>
          if (!isNum(cc.duration) || cc.duration <= 0) continue
          clips[name] = { duration: cc.duration, loop: cc.loop === true, ...(isNum(cc.speed) && cc.speed > 0 ? { speed: cc.speed } : {}) }
        }
      }
      const attachments: AttachmentDef[] = []
      if (Array.isArray(o.attachments)) {
        for (const a of o.attachments) {
          if (!a || typeof a !== 'object') continue
          const aa = a as Record<string, unknown>
          if (typeof aa.id !== 'string' || typeof aa.bone !== 'string' || !Array.isArray(aa.matrix) || aa.matrix.length !== 16 || !aa.matrix.every(isNum)) continue
          const mz = Array.isArray(aa.muzzle) && aa.muzzle.length === 3 && aa.muzzle.every(isNum) ? (aa.muzzle as [number, number, number]) : undefined
          attachments.push({ id: aa.id, bone: aa.bone, matrix: aa.matrix as number[], ...(mz ? { muzzle: mz } : {}) })
        }
      }
      out.figures.set(kindKey(kind), { kind: kindKey(kind), url: url(o.file), height: isNum(o.height) && o.height > 0 ? o.height : 1.8, clips, attachments })
    }
  }
  const items = root.items
  if (items && typeof items === 'object') {
    for (const [id, v] of Object.entries(items as Record<string, unknown>)) {
      const f = v && typeof v === 'object' ? (v as Record<string, unknown>).file : typeof v === 'string' ? v : undefined
      if (typeof f === 'string' && GLB.test(f)) out.items.set(id, url(f))
    }
  }
  return out
}
