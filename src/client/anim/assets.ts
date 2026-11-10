// Rigged figure assets (spec 30): reads public/assets/anim/manifest.json, loads every figure and item GLB with ONE GLTFLoader (meshopt
// decoder set), and hands out the loaded skinned scene, its clips and its items. Nothing here throws: a missing manifest or a failed file
// just means the kind has no rig, and the board falls back to the static figure (rule 26 applies to both: preload, stand-in on a failed load).
import type { AnimationClip, Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { assetManager } from '../assetLoading'
import { kindKey, parseAnimManifest, type AnimManifest, type FigureDef } from './contract'
import { fixIdlePose } from './posefix'

/** Board height of a figure in tiles: the same 1.0 the static models are normalised to (src/client/game/models.ts FIGURE_HEIGHT). */
export const BOARD_FIGURE_HEIGHT = 1.0

export interface RigAsset { def: FigureDef; scene: Object3D; clips: Map<string, AnimationClip>; scale: number }

let loader: GLTFLoader | null = null
/** The one loader shared by the static and the rigged figures. */
export function sharedLoader(): GLTFLoader {
  if (!loader) { loader = new GLTFLoader(assetManager()); loader.setMeshoptDecoder(MeshoptDecoder) }
  return loader
}

const rigs = new Map<string, RigAsset>()
const items = new Map<string, Object3D>()

/** The rig for a unit kind; a loadout variant (thug-club, thug-pistol) wins over the plain kind. */
export function rigFor(kind: string, variant?: string | null): RigAsset | null {
  const k = kindKey(kind)
  return (variant ? rigs.get(`${k}-${variant}`) : undefined) ?? rigs.get(k) ?? null
}
export function itemScene(id: string): Object3D | null { return items.get(id) ?? null }
export function rigKinds(): string[] { return [...rigs.keys()] }
/** Seconds of a clip for a kind, from the manifest (falls back to the GLB's own clip length), or null when the figure has no such clip. */
export function clipSeconds(kind: string, variant: string | null | undefined, clip: string): number | null {
  const r = rigFor(kind, variant)
  if (!r) return null
  return r.def.clips[clip]?.duration ?? r.clips.get(clip)?.duration ?? null
}

function manifestUrl(): string {
  try { return new URL('assets/anim/manifest.json', document.baseURI).toString() } catch { return './assets/anim/manifest.json' }
}

/** The manifest, or an empty one when it is absent (a dev server answers a missing file with index.html: detected by content type). */
export async function fetchAnimManifest(): Promise<AnimManifest> {
  const empty: AnimManifest = { figures: new Map(), items: new Map() }
  try {
    // Builds know whether they ship the manifest (vite `define`); the dev server always asks. An undefined flag means "ask".
    const flags = (typeof __PX_MANIFESTS__ !== 'undefined' ? __PX_MANIFESTS__ : undefined) as { anim?: boolean } | undefined
    if (flags && flags.anim === false) return empty
    const url = manifestUrl()
    const r = await fetch(url, { cache: 'no-cache' })
    const ct = r.headers.get('content-type') ?? ''
    if (!r.ok || /text\/html/.test(ct)) return empty
    return parseAnimManifest(await r.json(), url)
  } catch { return empty }
}

/** Loads every figure and item of the manifest. `step` fires once per file (done or failed). Returns the number of files. */
export async function loadAnim(man: AnimManifest, step: () => void): Promise<void> {
  const l = sharedLoader()
  const jobs: Promise<void>[] = []
  for (const [kind, def] of man.figures) {
    jobs.push((async () => {
      try {
        const g = await l.loadAsync(def.url)
        fixIdlePose(kind, g.scene, g.animations) // stand the gun figures up in idle, walk and run (posefix.ts)
        const clips = new Map<string, AnimationClip>()
        for (const a of g.animations) clips.set(a.name, a)
        if (!clips.has('idle')) throw new Error('no idle clip')
        rigs.set(kind, { def, scene: g.scene, clips, scale: BOARD_FIGURE_HEIGHT / def.height })
      } catch (err) {
        console.warn(`rig ${kind}: could not load (${(err as Error).message}); using the static figure`)
      }
      step()
    })())
  }
  for (const [id, url] of man.items) {
    jobs.push((async () => {
      try { items.set(id, (await l.loadAsync(url)).scene) } catch (err) { console.warn(`item ${id}: could not load (${(err as Error).message})`) }
      step()
    })())
  }
  await Promise.all(jobs)
}

export const animFileCount = (m: AnimManifest): number => m.figures.size + m.items.size
