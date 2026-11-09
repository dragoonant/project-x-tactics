// Terrain v2 assets (spike T0), behind the `?terrain=v2` flag. Rule 26: everything preloads at startup (the start button waits for it
// through controller.boot) and the board draws the terrain under a null Suspense fallback; nothing is drawn as a stand-in while
// loading. If the manifest or a texture is missing, `preloadTerrain` resolves to null and the board keeps today's procedural look;
// a missing prop only keeps the procedural box for its object kind.
//
// public/assets/terrain/manifest.json:
//   { textures: { <surface>: { color, normal, rough, tileSize (world units per repeat), metalness, normalScale } },
//     props:    { <slug>: { file, replaces: <map object kind>, footprint: [x, z] (tiles), height (tiles), fit: "footprint" | "height" } } }
// 1 world unit = 1 tile. The Artifact build (tools/pack-artifact.mjs) repoints prop files to `.gltf.json` and inlines the textures.
import { Box3, Matrix4, Mesh, SRGBColorSpace, TextureLoader, Vector3, RepeatWrapping, LinearMipmapLinearFilter, LinearFilter } from 'three'
import type { BufferGeometry, Material, MeshStandardMaterial, Texture } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

export const TERRAIN_V2: boolean = (() => {
  try { return new URLSearchParams(window.location.search).get('terrain') === 'v2' } catch { return false }
})()

export interface TexSet { color: Texture; normal: Texture; rough: Texture; tileSize: number; metalness: number; normalScale: number }
export interface PropPart { geometry: BufferGeometry; material: Material; matrix: Matrix4 }
export interface PropDef { slug: string; object: string; parts: PropPart[]; height: number; footprint: [number, number] }
export interface TerrainAssets { textures: Record<string, TexSet>; propsByObject: Record<string, PropDef> }

interface ManifestTexture { color: string; normal: string; rough: string; tileSize?: number; metalness?: number; normalScale?: number }
interface ManifestProp { file: string; replaces: string; footprint: [number, number]; height: number; fit?: 'footprint' | 'height'; stretchY?: number }
interface Manifest { textures: Record<string, ManifestTexture>; props: Record<string, ManifestProp> }

const here = (p: string): string => {
  if (/^(data:|https?:)/.test(p)) return p
  try { return new URL(`assets/terrain/${p}`, document.baseURI).toString() } catch { return `./assets/terrain/${p}` }
}

function loadTex(url: string, srgb: boolean, loader: TextureLoader): Promise<Texture> {
  return new Promise((ok, fail) => {
    loader.load(url, (t) => {
      t.wrapS = t.wrapT = RepeatWrapping
      t.colorSpace = srgb ? SRGBColorSpace : t.colorSpace
      t.minFilter = LinearMipmapLinearFilter
      t.magFilter = LinearFilter
      t.anisotropy = 4
      ok(t)
    }, undefined, () => fail(new Error(`texture ${url.slice(0, 80)}`)))
  })
}

/** Scale a loaded prop to its tile footprint, stand it on y = 0 centred on the tile; returns one matrix per mesh. */
function fitProp(slug: string, mp: ManifestProp, root: import('three').Object3D): PropDef {
  root.updateMatrixWorld(true)
  const box = new Box3().setFromObject(root)
  const size = box.getSize(new Vector3()), c = box.getCenter(new Vector3())
  const [fx, fz] = mp.footprint
  const byFoot = Math.min(fx / Math.max(size.x, 1e-6), fz / Math.max(size.z, 1e-6))
  const byHeight = mp.height / Math.max(size.y * (mp.stretchY ?? 1), 1e-6)
  // thin props (the lamp post) fit by height and may overhang the tile with their arm; boxy props fit the footprint exactly,
  // then never exceed the height
  const s = mp.fit === 'height' ? byHeight : Math.min(byFoot, byHeight)
  const sy = mp.stretchY ?? 1 // optional vertical stretch: a full-cover dumpster has to read taller than a half-cover stall
  const lift = new Matrix4().makeScale(s, s * sy, s).multiply(new Matrix4().makeTranslation(-c.x, -box.min.y, -c.z))
  const parts: PropPart[] = []
  root.traverse((o) => {
    const m = o as Mesh
    if (!m.isMesh) return
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as MeshStandardMaterial
    const own = mat.clone()
    own.metalness = 0
    own.roughness = Math.max(own.roughness ?? 0.8, 0.7)
    own.color.multiplyScalar(0.62) // the lamp pools over-expose the painted colours a little
    parts.push({ geometry: m.geometry, material: own, matrix: lift.clone().multiply(m.matrixWorld) })
  })
  return { slug, object: mp.replaces, parts, height: size.y * s * sy, footprint: [size.x * s, size.z * s] }
}

let started: Promise<TerrainAssets | null> | null = null
let ready: TerrainAssets | null = null
export function terrainReady(): TerrainAssets | null { return ready }

/** Start once. Resolves to null when the flag is off or the textures are not available (the board then keeps the procedural look). */
export function preloadTerrain(): Promise<TerrainAssets | null> {
  if (started) return started
  started = (async () => {
    if (!TERRAIN_V2) return null
    try {
      const r = await fetch(here('manifest.json'), { cache: 'no-cache' })
      const ct = r.headers.get('content-type') ?? ''
      if (!r.ok || /text\/html/.test(ct)) throw new Error('no terrain manifest')
      const man = (await r.json()) as Manifest
      const tl = new TextureLoader()
      const textures: Record<string, TexSet> = {}
      await Promise.all(Object.entries(man.textures).map(async ([name, t]) => {
        const [color, normal, rough] = await Promise.all([loadTex(here(t.color), true, tl), loadTex(here(t.normal), false, tl), loadTex(here(t.rough), false, tl)])
        textures[name] = { color, normal, rough, tileSize: t.tileSize ?? 2, metalness: t.metalness ?? 0, normalScale: t.normalScale ?? 1 }
      }))
      const propsByObject: Record<string, PropDef> = {}
      const gl = new GLTFLoader()
      gl.setMeshoptDecoder(MeshoptDecoder)
      await Promise.all(Object.entries(man.props ?? {}).map(async ([slug, p]) => {
        try {
          const g = await gl.loadAsync(here(p.file))
          propsByObject[p.replaces] = fitProp(slug, p, g.scene)
        } catch (err) {
          console.warn(`terrain prop ${slug}: could not load (${(err as Error).message}); keeping the procedural box`)
        }
      }))
      ready = { textures, propsByObject }
      return ready
    } catch (err) {
      console.warn(`terrain v2 unavailable (${(err as Error).message}); keeping the procedural terrain`)
      return null
    }
  })()
  return started
}
