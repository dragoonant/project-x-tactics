// Terrain v2 pieces (spike T0, `?terrain=v2`): world-space UV patch for the PBR surfaces, the material set, the indoor / street
// split of the floor, and the instanced Hunyuan props. No pointer handlers anywhere in here (rule 25).
import { useLayoutEffect, useMemo, useRef } from 'react'
import { Color, InstancedMesh, Matrix4, MeshStandardMaterial, Vector2 } from 'three'
import type { State } from '../../engine'
import type { PropDef, TerrainAssets, TexSet } from '../game/terrainAssets'
import { wake } from '../game/presentation'
import { hash2, tx, tz } from './layout'

const noRay = (): null => null

/**
 * UVs from world position, so a texture runs on across tiles instead of repeating per tile. Top faces use (x, -z); side faces use
 * the horizontal axis along the face and world y, so bricks stay level whatever the wall's height. Works on instanced boxes.
 */
export function worldUv(mat: MeshStandardMaterial, tileSize: number): MeshStandardMaterial {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', /* glsl */`
#include <uv_vertex>
{
  vec4 pxW = modelMatrix * vec4( position, 1.0 );
  vec3 pxN = normalize( mat3( modelMatrix ) * normal );
  #ifdef USE_INSTANCING
    pxW = modelMatrix * instanceMatrix * vec4( position, 1.0 );
    pxN = normalize( mat3( modelMatrix ) * mat3( instanceMatrix ) * normal );
  #endif
  vec2 pxUv;
  if ( pxN.y > 0.5 ) pxUv = vec2( pxW.x, -pxW.z );
  else if ( pxN.y < -0.5 ) pxUv = vec2( pxW.x, pxW.z );
  else pxUv = vec2( dot( cross( vec3( 0.0, 1.0, 0.0 ), pxN ), pxW.xyz ), pxW.y );
  pxUv /= ${tileSize.toFixed(3)};
  #ifdef USE_MAP
    vMapUv = pxUv;
  #endif
  #ifdef USE_NORMALMAP
    vNormalMapUv = pxUv;
  #endif
  #ifdef USE_ROUGHNESSMAP
    vRoughnessMapUv = pxUv;
  #endif
}`)
  }
  mat.customProgramCacheKey = () => `worlduv-${tileSize}`
  return mat
}

function pbr(t: TexSet, roughness = 1): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ map: t.color, normalMap: t.normal, roughnessMap: t.rough, roughness, metalness: t.metalness })
  m.normalScale = new Vector2(t.normalScale, t.normalScale)
  return m
}

export interface V2Mats { street: MeshStandardMaterial; floor: MeshStandardMaterial; brick: MeshStandardMaterial; fence: MeshStandardMaterial; door: MeshStandardMaterial; kerb: MeshStandardMaterial }

export function makeV2Mats(a: TerrainAssets): V2Mats {
  const T = a.textures
  const door = pbr(T.steeldoor!) // one panel per box face: the geometry's own 0..1 UVs
  door.color.setRGB(1.7, 1.5, 1.3)
  return {
    street: worldUv(pbr(T.asphalt!), T.asphalt!.tileSize),
    floor: worldUv(pbr(T.tilefloor!), T.tilefloor!.tileSize),
    brick: worldUv(pbr(T.brick!), T.brick!.tileSize),
    fence: worldUv(pbr(T.corrugated!), T.corrugated!.tileSize),
    door,
    kerb: worldUv(pbr(T.asphalt!), T.asphalt!.tileSize),
  }
}

/** Tint multipliers: the generated textures are dark, so the instance colours lift them. */
export const V2C = {
  street: new Color(0.62, 0.62, 0.66), floor: new Color(0.8, 0.72, 0.68), exit: new Color('#4fb07a'), escape: new Color('#c05a5a'), zone: new Color('#58c28f'),
  brick: new Color(1.5, 1.4, 1.35), boundary: new Color(1.1, 1.1, 1.15), kerb: new Color(1.1, 1.1, 1.2),
  door: new Color(1.5, 1.45, 1.4),
}

/**
 * Floor tiles enclosed by walls and doors are "inside" (tiled bar floor); the rest is street. Flood fill from the map edge over
 * floor tiles; doors always block, so a room behind a door stays inside whether or not the door is open.
 */
export function indoorMask(state: State): Uint8Array {
  const { w, h } = state.map
  const outside = new Uint8Array(w * h)
  const stack: number[] = []
  const free = (i: number): boolean => { const k = state.map.tiles[i]!.k; return k !== 'wall' && k !== 'door' }
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { const i = y * w + x; if (free(i) && !outside[i]) { outside[i] = 1; stack.push(i) } }
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) { const i = y * w + x; if (free(i) && !outside[i]) { outside[i] = 1; stack.push(i) } }
  while (stack.length) {
    const i = stack.pop()!
    const x = i % w, y = (i - x) / w
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const j = ny * w + nx
      if (!outside[j] && free(j)) { outside[j] = 1; stack.push(j) }
    }
  }
  const out = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const k = state.map.tiles[i]!.k
    if (k === 'wall') continue
    if (k === 'door') { out[i] = 1; continue }
    out[i] = outside[i] ? 0 : 1
  }
  return out
}

const tmpM = new Matrix4(), rotM = new Matrix4(), posM = new Matrix4(), tmpC = new Color()

/** Hunyuan props as instanced meshes (one InstancedMesh per sub-mesh of each prop). `sig` changes when cover is destroyed. */
export function PropField({ state, assets, seen, sig }: { state: State; assets: TerrainAssets; seen: Uint8Array; sig: string }): React.JSX.Element {
  const { w, h } = state.map
  const defs = useMemo(() => Object.values(assets.propsByObject), [assets])
  const refs = useRef<(InstancedMesh | null)[]>([])
  const flat = useMemo(() => defs.flatMap((d) => d.parts.map((p) => ({ def: d, part: p }))), [defs])
  useLayoutEffect(() => {
    flat.forEach(({ def, part }, k) => {
      const m = refs.current[k]
      if (!m) return
      let n = 0
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const t = state.map.tiles[y * w + x]!
        if (t.o !== def.object) continue
        const flip = def.object !== 'lamp' && hash2(x, y, 61) > 0.5 ? Math.PI : 0
        posM.makeTranslation(tx(x, w), 0, tz(y, h))
        rotM.makeRotationY(flip)
        tmpM.copy(posM).multiply(rotM).multiply(part.matrix)
        m.setMatrixAt(n, tmpM)
        m.setColorAt(n, tmpC.setScalar(seen[y * w + x] ? 1 : 0.55))
        n++
      }
      m.count = n
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    })
    wake(120)
  }, [flat, sig, seen, w, h, state.map.tiles])
  return (
    <group>
      {flat.map(({ def, part }, k) => (
        <instancedMesh key={`${def.slug}-${k}`} ref={(el) => { refs.current[k] = el }} args={[part.geometry, part.material, w * h]} frustumCulled={false} raycast={noRay} />
      ))}
    </group>
  )
}

export type { PropDef }
