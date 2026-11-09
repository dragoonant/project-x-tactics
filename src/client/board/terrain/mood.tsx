// Mood for terrain v2 (T1): a cheap wet-street environment reflection, steam from vents and the noodle cart, optional rain.
// Cost model: one GPU draw call each for rain and steam, animated in the vertex shader from one time uniform (no per-frame CPU work
// beyond the uniform). Rain and steam are set dressing / mood: on the Low tier (phone or Lite) they are dropped first. Browser
// automation (navigator.webdriver) never starts the self-driven ~15 fps redraw, so e2e runs and screenshots stay deterministic and cheap
// (the frame still shows the streaks and puffs at their time-zero positions); add `?mood=on` to force it.
// Nothing here emits light: the dark / lit rules stay the engine's lamps.
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, CanvasTexture, Color, EquirectangularReflectionMapping, LineSegments, Points, PMREMGenerator, ShaderMaterial, SRGBColorSpace, type Texture, type WebGLRenderer } from 'three'
import type { State } from '../../../engine'
import { hash2, tx, tz } from '../layout'

/** A tiny equirect sky: cool dusk above, dark horizon, a few bodycam-palette neon streaks near it. Reflected only where the street is glossy. */
export function wetEnv(gl: WebGLRenderer): Texture | null {
  try {
    const c = document.createElement('canvas')
    c.width = 256; c.height = 128
    const g = c.getContext('2d')!
    const grad = g.createLinearGradient(0, 0, 0, 128)
    grad.addColorStop(0, '#34456e'); grad.addColorStop(0.5, '#1c2438'); grad.addColorStop(1, '#0a0d14')
    g.fillStyle = grad; g.fillRect(0, 0, 256, 128)
    const blobs: [number, number, number, number, string][] = [[30, 70, 34, 7, '#ffb000'], [95, 66, 22, 6, '#ff8a2a'], [150, 72, 40, 6, '#43e08a'], [205, 68, 26, 8, '#ff8a2a'], [245, 74, 14, 5, '#ffb000']]
    for (const [x, y, w, hh, col] of blobs) { g.fillStyle = col; g.globalAlpha = 0.85; g.fillRect(x - w / 2, y, w, hh) }
    const t = new CanvasTexture(c)
    t.colorSpace = SRGBColorSpace
    t.mapping = EquirectangularReflectionMapping
    const pm = new PMREMGenerator(gl)
    const env = pm.fromEquirectangular(t).texture
    t.dispose(); pm.dispose()
    return env
  } catch { return null }
}

export function useWetEnv(enabled: boolean): Texture | null {
  const gl = useThree((s) => s.gl)
  const env = useMemo(() => (enabled ? wetEnv(gl) : null), [gl, enabled])
  useEffect(() => () => { env?.dispose() }, [env])
  return env
}

const automated = ((): boolean => { try { return navigator.webdriver && !/[?&]mood=on\b/.test(window.location.search) } catch { return false } })()

/** Self-driven redraw (the canvas is in demand mode): about 15 fps while the mood layer animates and the tab is visible. */
export function useAmbientLoop(active: boolean): void {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    if (!active || automated) return
    const id = window.setInterval(() => { if (!document.hidden) invalidate() }, 66)
    return () => window.clearInterval(id)
  }, [active, invalidate])
}

const timeNow = (): number => (typeof performance !== 'undefined' ? performance.now() / 1000 : 0)

export function Rain({ w, h }: { w: number; h: number }): React.JSX.Element {
  const { geo, mat } = useMemo(() => {
    const N = 420, H = 9
    const pos = new Float32Array(N * 2 * 3), ph = new Float32Array(N * 2), end = new Float32Array(N * 2)
    for (let i = 0; i < N; i++) {
      const x = (hash2(i, 1, 300) - 0.5) * (w + 4), z = (hash2(i, 2, 300) - 0.5) * (h + 4)
      for (let e = 0; e < 2; e++) { pos.set([x, 0, z], (i * 2 + e) * 3); ph[i * 2 + e] = hash2(i, 3, 300); end[i * 2 + e] = e }
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(pos, 3))
    geo.setAttribute('ph', new BufferAttribute(ph, 1))
    geo.setAttribute('end', new BufferAttribute(end, 1))
    const mat = new ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { t: { value: 0 }, col: { value: new Color('#a9bdd8') } },
      vertexShader: /* glsl */`
        attribute float ph; attribute float end; uniform float t;
        void main() {
          float y = fract( ph - t * 0.9 ) * ${H.toFixed(1)};
          vec3 p = position + vec3( ( ${H.toFixed(1)} - y ) * 0.07, y, 0.0 );
          p += vec3( 0.04, 0.55, 0.0 ) * end;
          gl_Position = projectionMatrix * viewMatrix * vec4( p, 1.0 );
        }`,
      fragmentShader: /* glsl */`uniform vec3 col; void main() { gl_FragColor = vec4( col, 0.13 ); }`,
    })
    return { geo, mat }
  }, [w, h])
  useEffect(() => () => { geo.dispose(); mat.dispose() }, [geo, mat])
  useFrame(() => { mat.uniforms.t!.value = timeNow() })
  useAmbientLoop(true)
  return <lineSegments args={[geo, mat] as unknown as ConstructorParameters<typeof LineSegments>} frustumCulled={false} raycast={() => null} />
}

export interface SteamSpot { x: number; y: number; z: number }

export function Steam({ spots }: { spots: SteamSpot[] }): React.JSX.Element | null {
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)
  const { geo, mat } = useMemo(() => {
    const per = 5
    const a = new Float32Array(spots.length * per * 4)
    spots.forEach((s, i) => { for (let k = 0; k < per; k++) a.set([s.x, s.y, s.z, (k + hash2(i, k, 310) * 0.6) / per], (i * per + k) * 4) })
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array(spots.length * per * 3), 3))
    geo.setAttribute('a', new BufferAttribute(a, 4))
    const mat = new ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { t: { value: 0 }, scale: { value: 600 } },
      vertexShader: /* glsl */`
        attribute vec4 a; uniform float t; uniform float scale; varying float vA;
        void main() {
          float life = fract( a.w + t * 0.16 );
          vec3 p = vec3( a.x + life * 0.32 + sin( a.w * 40.0 + t ) * 0.05, a.y + life * 1.05, a.z + life * 0.08 );
          vec4 mv = viewMatrix * vec4( p, 1.0 );
          gl_Position = projectionMatrix * mv;
          gl_PointSize = ( 0.22 + life * 0.5 ) * scale / -mv.z;
          vA = ( 1.0 - life ) * smoothstep( 0.0, 0.12, life ) * 0.34;
        }`,
      fragmentShader: /* glsl */`varying float vA; void main() { float d = length( gl_PointCoord - 0.5 ); gl_FragColor = vec4( 0.82, 0.86, 0.92, vA * smoothstep( 0.5, 0.05, d ) ); }`,
    })
    return { geo, mat }
  }, [spots])
  useEffect(() => { mat.uniforms.scale!.value = size.height * dpr * 0.9 }, [mat, size.height, dpr])
  useEffect(() => () => { geo.dispose(); mat.dispose() }, [geo, mat])
  useFrame(() => { mat.uniforms.t!.value = timeNow() })
  useAmbientLoop(spots.length > 0)
  if (!spots.length) return null
  return <points args={[geo, mat] as unknown as ConstructorParameters<typeof Points>} frustumCulled={false} raycast={() => null} />
}

/** Vent stacks stand on the boundary hoarding (a non-walkable edge); a few of them, chosen by hash, never next to an exit. */
export function ventSpots(w: number, h: number, isExitNear: (x: number, y: number) => boolean): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!(x === 0 || y === 0 || x === w - 1 || y === h - 1)) continue
    if ((x === 0 || x === w - 1) && (y === 0 || y === h - 1)) continue
    if (isExitNear(x, y)) continue
    if (hash2(x, y, 320) < 0.16) out.push({ x, y })
  }
  return out
}

export const steamWorld = (p: { x: number; y: number }, w: number, h: number, up: number): SteamSpot => ({ x: tx(p.x, w), y: up, z: tz(p.y, h) })

/** True when an exit tile is within one tile of (x, y). */
export function exitNear(state: State, x: number, y: number): boolean {
  const { w, h } = state.map
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx = x + dx, ny = y + dy
    if (nx >= 0 && ny >= 0 && nx < w && ny < h && state.map.tiles[ny * w + nx]!.k === 'exit') return true
  }
  return false
}
