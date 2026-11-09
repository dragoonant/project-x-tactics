// Terrain v2 assets (T0 spike, default since T1; `?terrain=v1` restores the old procedural look). Rule 26: everything preloads at
// startup (the start button waits for it through controller.boot) and the board draws the terrain under a null Suspense fallback;
// nothing is drawn as a stand-in while loading. If the manifest or a texture is missing, `preloadTerrain` resolves to null and the
// board keeps the old procedural look; a missing prop only keeps the procedural box for its object kind.
//
// public/assets/terrain/manifest.json (spec 30 section 4; T1 only added keys):
//   { textures: { <surface>: { color, normal, rough, tileSize (world units per repeat), metalness, normalScale } },
//     props:    { <slug>: { file, replaces, footprint: [x, z] (tiles), height (tiles), fit: "footprint" | "height", stretchY?,
//                           where?: "indoor" | "outdoor" | "any", weight?, sat?, mul?, tints?: [r, g, b][], scale?: [x, y, z], tris? } } }
// `replaces` is a map object kind (halfCover, fullCover, lamp, rubble) or a pseudo-kind: "@escape" (the escape van tile),
// "@debris" (a half-cover tile whose cover is gone), "@wallbox" (set dressing mounted on a wall face).
// 1 world unit = 1 tile. The Artifact build (tools/pack-artifact.mjs) repoints prop files to `.gltf.json` and inlines the textures.
import { Box3, Matrix4, Mesh, SRGBColorSpace, TextureLoader, Vector3, RepeatWrapping, LinearMipmapLinearFilter, LinearFilter } from 'three'
import type { BufferGeometry, Material, MeshStandardMaterial, Texture } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { assetManager } from '../../assetLoading'

/** Default on. `?terrain=v1` keeps the old look for comparison (`?terrain=v2` is accepted and means the default). */
export const TERRAIN_V2: boolean = (() => {
  try { return new URLSearchParams(window.location.search).get('terrain') !== 'v1' } catch { return true }
})()

export interface TexSet { color: Texture; normal: Texture; rough: Texture; tileSize: number; metalness: number; normalScale: number }
export interface PropPart { geometry: BufferGeometry; material: Material; matrix: Matrix4 }
export type Where = 'indoor' | 'outdoor' | 'any'
export interface PropDef {
  slug: string; object: string; parts: PropPart[]; height: number; footprint: [number, number]
  where: Where; weight: number; tints: [number, number, number][]; scale: [number, number, number]
}
export interface TerrainAssets { textures: Record<string, TexSet>; propsByObject: Record<string, PropDef[]> }

interface ManifestTexture { color: string; normal: string; rough: string; tileSize?: number; metalness?: number; normalScale?: number }
interface ManifestProp {
  file: string; replaces: string; footprint: [number, number]; height: number; fit?: 'footprint' | 'height'; stretchY?: number
  where?: Where; weight?: number; sat?: number; mul?: number; tints?: [number, number, number][]; scale?: [number, number, number]; orient?: 'long-z' | 'long-x'
}
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

/** Painted props are tamed in the shader: desaturate (the generated paint runs hot under the lamps) before the instance tint applies. */
function tame(mat: MeshStandardMaterial, sat: number): void {
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', /* glsl */`
#include <map_fragment>
{
  float pxL = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
  diffuseColor.rgb = mix( vec3( pxL ), diffuseColor.rgb, ${sat.toFixed(3)} );
}`)
  }
  mat.customProgramCacheKey = () => `tame-${sat.toFixed(3)}`
}

/** Scale a loaded prop to its tile footprint, stand it on y = 0 centred on the tile; returns one matrix per mesh. */
function fitProp(slug: string, mp: ManifestProp, root: import('three').Object3D): PropDef {
  root.updateMatrixWorld(true)
  let box = new Box3().setFromObject(root)
  let size = box.getSize(new Vector3())
  // orient: turn the prop a quarter turn when its long side is on the wrong axis (a van is long, its tile footprint is read along z)
  let turn = 0
  if ((mp.orient === 'long-z' && size.x > size.z * 1.05) || (mp.orient === 'long-x' && size.z > size.x * 1.05)) turn = Math.PI / 2
  const pre = new Matrix4().makeRotationY(turn)
  if (turn) { root.applyMatrix4(pre); root.updateMatrixWorld(true); box = new Box3().setFromObject(root); size = box.getSize(new Vector3()) }
  const c = box.getCenter(new Vector3())
  const [fx, fz] = mp.footprint
  const byFoot = Math.min(fx / Math.max(size.x, 1e-6), fz / Math.max(size.z, 1e-6))
  const byHeight = mp.height / Math.max(size.y * (mp.stretchY ?? 1), 1e-6)
  // thin props (the lamp post) fit by height and may overhang the tile with their arm; boxy props fit the footprint exactly,
  // then never exceed the height
  const s = mp.fit === 'height' ? byHeight : Math.min(byFoot, byHeight)
  const sy = mp.stretchY ?? 1 // optional vertical stretch: a full-cover dumpster has to read taller than a half-cover stall
  const lift = new Matrix4().makeScale(s, s * sy, s).multiply(new Matrix4().makeTranslation(-c.x, -box.min.y, -c.z))
  const parts: PropPart[] = []
  const sat = mp.sat ?? 0.85
  const mul = mp.mul ?? 0.62 // the lamp pools over-expose the painted colours a little
  root.traverse((o) => {
    const m = o as Mesh
    if (!m.isMesh) return
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as MeshStandardMaterial
    const own = mat.clone()
    own.metalness = 0
    own.roughness = Math.max(own.roughness ?? 0.8, 0.7)
    own.color.multiplyScalar(mul)
    tame(own, sat)
    parts.push({ geometry: m.geometry, material: own, matrix: lift.clone().multiply(m.matrixWorld) })
  })
  return {
    slug, object: mp.replaces, parts, height: size.y * s * sy, footprint: [size.x * s, size.z * s],
    where: mp.where ?? 'any', weight: mp.weight ?? 1, tints: mp.tints?.length ? mp.tints : [[1, 1, 1]], scale: mp.scale ?? [1, 1, 1],
  }
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
      const propsByObject: Record<string, PropDef[]> = {}
      const gl = new GLTFLoader(assetManager())
      gl.setMeshoptDecoder(MeshoptDecoder)
      const loaded: [string, PropDef][] = []
      await Promise.all(Object.entries(man.props ?? {}).map(async ([slug, p]) => {
        try {
          const g = await gl.loadAsync(here(p.file))
          loaded.push([slug, fitProp(slug, p, g.scene)])
        } catch (err) {
          console.warn(`terrain prop ${slug}: could not load (${(err as Error).message}); keeping the procedural stand-in for it`)
        }
      }))
      // manifest order, so the variant choice does not depend on which GLB finished loading first
      for (const slug of Object.keys(man.props ?? {})) {
        const hit = loaded.find(([s]) => s === slug)
        if (hit) (propsByObject[hit[1].object] ??= []).push(hit[1])
      }
      ready = { textures, propsByObject }
      return ready
    } catch (err) {
      console.warn(`terrain v2 unavailable (${(err as Error).message}); keeping the procedural terrain`)
      return null
    }
  })()
  return started
}
