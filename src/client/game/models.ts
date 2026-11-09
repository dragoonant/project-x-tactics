// Figure models (rule 26: load before show). Reads public/assets/models/manifest.json if it exists, preloads every listed GLB
// with the meshopt decoder configured on the loader, and exposes a ready-to-clone scene per unit kind. Units without a model use
// the procedural stand-in. The manifest may be missing or grow later: nothing here fails when it is absent.
import { Box3, Group, Object3D, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

export const FIGURE_HEIGHT = 1.0

export interface ModelEntry { url: string; yaw: number; height: number }
export interface LoadedModel { scene: Object3D; yaw: number }

const ALIAS: Record<string, string> = {
  'vox-operator': 'vox', voxoperator: 'vox', 'vox_operator': 'vox', 'chem-trooper': 'chem', chemtrooper: 'chem', 'chem_trooper': 'chem',
  'the-bagman': 'bagman', thebagman: 'bagman',
}
export function normalizeKind(k: string): string {
  const t = k.trim().toLowerCase()
  return ALIAS[t] ?? t
}

const loaded = new Map<string, LoadedModel>()
/** A model for a unit kind; a loadout variant (thug-club, thug-pistol) wins over the plain kind. */
export function modelFor(kind: string, variant?: string | null): LoadedModel | null {
  return (variant ? loaded.get(`${kind}-${variant}`) : undefined) ?? loaded.get(kind) ?? null
}
export function loadedKinds(): string[] { return [...loaded.keys()] }

function baseUrl(): string {
  try { return new URL('assets/models/', document.baseURI).toString() } catch { return './assets/models/' }
}

/** Tolerant manifest reader: accepts { kind: "file.glb" }, { models | units | figures: {...} } and arrays of { id | kind | unit, file | path | url }. */
export function parseManifest(json: unknown): Map<string, ModelEntry> {
  const out = new Map<string, ModelEntry>()
  const base = baseUrl()
  const add = (kind: string, v: unknown): void => {
    let file: string | undefined, yaw = 0, height = FIGURE_HEIGHT
    if (typeof v === 'string') file = v
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      const f = o.file ?? o.path ?? o.glb ?? o.url ?? o.src ?? o.model
      if (typeof f === 'string') file = f
      if (typeof o.yaw === 'number') yaw = o.yaw
      if (typeof o.height === 'number' && o.height > 0) height = o.height
    }
    // `.gltf.json` is the Artifact build's packing (tools/pack-artifact.mjs): the host serves .json but not .glb.
    if (!file || !/\.(glb|gltf|gltf\.json)(\?.*)?$/i.test(file)) return
    const url = /^(https?:)?\/\//.test(file) ? file : file.startsWith('assets/') ? new URL(file, document.baseURI).toString() : new URL(file, base).toString()
    out.set(normalizeKind(kind), { url, yaw, height })
  }
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const it of node) {
        if (it && typeof it === 'object') {
          const o = it as Record<string, unknown>
          const id = o.id ?? o.kind ?? o.unit ?? o.name ?? o.type
          if (typeof id === 'string') add(id, o)
        }
      }
    } else if (node && typeof node === 'object') {
      const o = node as Record<string, unknown>
      for (const [k, v] of Object.entries(o)) {
        if (['models', 'units', 'figures', 'entries', 'items', 'files'].includes(k) && v && typeof v === 'object') walk(v)
        else if (typeof v === 'string' || (v && typeof v === 'object' && !Array.isArray(v))) add(k, v)
      }
    }
  }
  walk(json)
  return out
}

function normalizeScene(root: Object3D, height: number): Object3D {
  const box = new Box3().setFromObject(root)
  const size = box.getSize(new Vector3())
  const c = box.getCenter(new Vector3())
  const wrap = new Group()
  const s = size.y > 1e-4 ? height / size.y : 1
  root.scale.multiplyScalar(s)
  root.position.set(-c.x * s, -box.min.y * s, -c.z * s)
  wrap.add(root)
  root.traverse((o) => { o.matrixAutoUpdate = true })
  return wrap
}

export interface Progress { done: number; total: number }

let started: Promise<Progress> | null = null
/** Start once; `onProgress` fires after every model. Resolves when every listed model has loaded or failed. */
export function preloadModels(onProgress: (p: Progress) => void): Promise<Progress> {
  if (started) return started
  started = (async () => {
    let manifest: Map<string, ModelEntry>
    try {
      if (typeof __PX_MANIFESTS__ !== 'undefined' && !__PX_MANIFESTS__.models) throw new Error('this build ships no model manifest')
      const r = await fetch(new URL('assets/models/manifest.json', document.baseURI).toString(), { cache: 'no-cache' })
      const ct = r.headers.get('content-type') ?? ''
      if (!r.ok || /text\/html/.test(ct)) manifest = new Map()
      else manifest = parseManifest(await r.json())
    } catch { manifest = new Map() }
    const total = manifest.size
    let done = 0
    onProgress({ done, total })
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    await Promise.all([...manifest.entries()].map(async ([kind, e]) => {
      try {
        const g = await loader.loadAsync(e.url)
        loaded.set(kind, { scene: normalizeScene(g.scene, e.height), yaw: e.yaw })
      } catch (err) {
        console.warn(`model ${kind}: could not load (${(err as Error).message}); using the stand-in`)
      }
      done++
      onProgress({ done, total })
    }))
    return { done, total }
  })()
  return started
}
