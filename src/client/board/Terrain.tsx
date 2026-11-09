// Terrain: ground, walls with height (they drop low when they would hide the focus), doors, cover props, lamps with real light
// pools, rubble, exit / extraction / escape markings. Instanced meshes, no shadows: a phone budget.
import { useFrame, useThree } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { AdditiveBlending, BoxGeometry, Color, CylinderGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Object3D, SphereGeometry, type PointLight, type PerspectiveCamera } from 'three'
import { query } from '../../engine'
import type { State, Tile } from '../../engine'
import { visibleMask } from '../game/vision'
import { focus, wake } from '../game/presentation'
import { boardApi } from './CameraRig'
import { hash2, tx, tz } from './layout'
import { glowTexture, groundTexture, wallTexture } from './textures'
import type { TerrainAssets } from '../game/terrainAssets'
import { PropField, V2C, indoorMask, makeV2Mats } from './terrainV2'

const WALL_H = 1.5
const LOW_H = 0.22
const BOUNDARY_H = 0.5
const dummy = new Object3D()
const ZERO = new Matrix4().makeScale(0, 0, 0)
const tmpColor = new Color()

const C = {
  floor: new Color('#59606e'), exit: new Color('#2f7a52'), escape: new Color('#8a3636'), zone: new Color('#2f8a5f'),
  wall: new Color('#8b6a5a'), boundary: new Color('#4b4f5c'),
  litTint: new Color(1.3, 1.04, 0.72), darkTint: new Color(0.46, 0.52, 0.7),
}

function tileSig(tiles: Tile[]): string {
  let s = ''
  for (const t of tiles) s += `${t.k[0]}${t.open ? 1 : 0}${t.o ? t.o.slice(0, 2) : ''};`
  return s
}

function isWallAt(s: State, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < s.map.w && y < s.map.h && s.map.tiles[y * s.map.w + x]!.k === 'wall'
}

/** Per-tile light and fog classification from the engine (query.isLit) and the squad's sight. */
export function useTileLight(state: State, fogOn: boolean): { lit: Uint8Array; seen: Uint8Array } {
  return useMemo(() => {
    const n = state.map.w * state.map.h
    const lit = new Uint8Array(n)
    for (let y = 0; y < state.map.h; y++) for (let x = 0; x < state.map.w; x++) lit[y * state.map.w + x] = query.isLit(state, x, y) ? 1 : 0
    const seen = fogOn ? visibleMask(state) : new Uint8Array(n).fill(1)
    return { lit, seen }
  }, [state, fogOn])
}

export function Terrain({ state, fogOn, lamps, lights, assets = null }: { state: State; fogOn: boolean; lamps: { x: number; y: number }[]; lights: React.MutableRefObject<(PointLight | null)[]>; assets?: TerrainAssets | null }): React.JSX.Element {
  const { w, h } = state.map
  const sig = useMemo(() => tileSig(state.map.tiles), [state.map.tiles])
  const { lit, seen } = useTileLight(state, fogOn)
  const { invalidate } = useThree()

  const geo = useMemo(() => ({
    box: new BoxGeometry(1, 1, 1),
    pole: new CylinderGeometry(0.05, 0.07, 1, 8),
    head: new SphereGeometry(0.17, 12, 8),
  }), [])
  const mats = useMemo(() => ({
    ground: new MeshStandardMaterial({ map: groundTexture(), roughness: 0.42, metalness: 0.18 }),
    wall: new MeshStandardMaterial({ map: wallTexture(), roughness: 0.85, metalness: 0 }),
    plain: new MeshStandardMaterial({ roughness: 0.7, metalness: 0.05 }),
    metal: new MeshStandardMaterial({ roughness: 0.5, metalness: 0.5 }),
    door: new MeshStandardMaterial({ roughness: 0.6, metalness: 0.1 }),
    lampHead: new MeshStandardMaterial({ color: '#ffd9a0', emissive: '#ff9a3a', emissiveIntensity: 2.2, roughness: 0.4 }),
    lampDead: new MeshStandardMaterial({ color: '#40342a', roughness: 0.8 }),
    mark: new MeshStandardMaterial({ color: '#43e08a', emissive: '#27d070', emissiveIntensity: 1.4, roughness: 0.6 }),
    red: new MeshStandardMaterial({ color: '#ff3b2f', emissive: '#ff2a1e', emissiveIntensity: 1.6 }),
  }), [])

  // terrain v2 (?terrain=v2): PBR surfaces with world-space UVs, Hunyuan props for the kinds the manifest replaces
  const v2 = useMemo(() => (assets ? makeV2Mats(assets) : null), [assets])
  const indoor = useMemo(() => (assets ? indoorMask(state) : null),
    // walls and doors never move; open / closed does not change which side of a wall a tile is on
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assets, state.map.id])
  const propKinds = assets?.propsByObject ?? {}
  const ground = useRef<InstancedMesh>(null)
  const groundIn = useRef<InstancedMesh>(null)
  const fence = useRef<InstancedMesh>(null)
  const kerb = useRef<InstancedMesh>(null)
  const walls = useRef<InstancedMesh>(null)
  const stallBase = useRef<InstancedMesh>(null)
  const stallCrate = useRef<InstancedMesh>(null)
  const dumpBody = useRef<InstancedMesh>(null)
  const dumpLid = useRef<InstancedMesh>(null)
  const rubble = useRef<InstancedMesh>(null)
  const poles = useRef<InstancedMesh>(null)
  const heads = useRef<InstancedMesh>(null)
  const doorsClosed = useRef<InstancedMesh>(null)
  const doorsOpen = useRef<InstancedMesh>(null)
  const marks = useRef<InstancedMesh>(null)
  const glows = useRef<InstancedMesh>(null)

  const wallList = useMemo(() => {
    const out: { x: number; y: number; wx: number; wz: number; boundary: boolean }[] = []
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (state.map.tiles[y * w + x]!.k === 'wall') out.push({ x, y, wx: tx(x, w), wz: tz(y, h), boundary: x === 0 || y === 0 || x === w - 1 || y === h - 1 })
    return out
  // walls never change during a game; recompute only when the map identity changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.map.id, w, h])
  const factors = useRef<Float32Array>(new Float32Array(0))
  const targets = useRef<Float32Array>(new Float32Array(0))

  // ---- walls: positions, colours (re-run when the visible area changes)
  useLayoutEffect(() => {
    const m = walls.current
    if (!m) return
    if (factors.current.length !== wallList.length) { factors.current = new Float32Array(wallList.length).fill(1); targets.current = new Float32Array(wallList.length).fill(1) }
    wallList.forEach((wl, i) => {
      const hb = (wl.boundary ? BOUNDARY_H : WALL_H) * factors.current[i]!
      dummy.position.set(wl.wx, hb / 2, wl.wz)
      dummy.scale.set(1, hb, 1)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      const fe = fence.current
      if (v2 && fe) {
        // v2: the outer boundary is a corrugated-metal hoarding in its own mesh; the brick mesh hides that instance (and vice versa)
        fe.setMatrixAt(i, wl.boundary ? dummy.matrix : ZERO)
        m.setMatrixAt(i, wl.boundary ? ZERO : dummy.matrix)
      } else m.setMatrixAt(i, dummy.matrix)
      const v = seen[wl.y * w + wl.x]
      const shade = (0.88 + hash2(wl.x, wl.y, 2) * 0.22) * (v ? 1 : 0.55)
      tmpColor.copy(v2 ? (wl.boundary ? V2C.boundary : V2C.brick) : wl.boundary ? C.boundary : C.wall)
      tmpColor.multiplyScalar(shade)
      m.setColorAt(i, tmpColor)
      if (v2 && fe) fe.setColorAt(i, tmpColor)
      const k = kerb.current
      if (v2 && k) {
        dummy.position.set(wl.wx, 0.07, wl.wz)
        dummy.scale.set(1.06, 0.14, 1.06)
        dummy.updateMatrix()
        k.setMatrixAt(i, dummy.matrix)
        k.setColorAt(i, tmpColor.copy(V2C.kerb).multiplyScalar(v ? 1 : 0.55))
      }
    })
    m.count = wallList.length
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    for (const o of [fence.current, kerb.current]) if (v2 && o) { o.count = wallList.length; o.instanceMatrix.needsUpdate = true; if (o.instanceColor) o.instanceColor.needsUpdate = true }
    wake(200)
  }, [wallList, seen, w, v2])

  // ---- ground colours: tile kind x light x fog (v2: street asphalt and bar tiles are two meshes)
  useLayoutEffect(() => {
    const m = ground.current
    if (!m) return
    const mIn = v2 ? groundIn.current : null
    const zone = new Set(state.map.extraction.map((p) => p.y * w + p.x))
    let n = 0, nIn = 0
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x
      const t = state.map.tiles[i]!
      if (t.k === 'wall') continue
      dummy.position.set(tx(x, w), -0.1, tz(y, h))
      dummy.scale.set(v2 ? 0.972 : 0.995, 0.2, v2 ? 0.972 : 0.995) // v2: a slightly wider dark gap keeps the tile grid readable on textured ground
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      const inside = !!(mIn && indoor && indoor[i])
      const target = inside ? mIn! : m
      const idx = inside ? nIn++ : n++
      target.setMatrixAt(idx, dummy.matrix)
      if (v2) tmpColor.copy(zone.has(i) ? V2C.zone : t.k === 'exit' ? V2C.exit : t.k === 'escape' ? V2C.escape : inside ? V2C.floor : V2C.street)
      else tmpColor.copy(zone.has(i) ? C.zone : t.k === 'exit' ? C.exit : t.k === 'escape' ? C.escape : C.floor)
      tmpColor.multiplyScalar(0.9 + hash2(x, y, 5) * 0.2)
      tmpColor.multiply(lit[i] ? C.litTint : C.darkTint)
      if (v2 && !lit[i]) tmpColor.multiply(V2C.darkBoost)
      if (!seen[i]) tmpColor.multiplyScalar(0.5)
      target.setColorAt(idx, tmpColor)
    }
    m.count = n
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    if (mIn) { mIn.count = nIn; mIn.instanceMatrix.needsUpdate = true; if (mIn.instanceColor) mIn.instanceColor.needsUpdate = true }
    invalidate()
  }, [state.map.tiles, state.map.extraction, lit, seen, w, h, invalidate, v2, indoor])

  // ---- props, doors, lamps, exit markings (re-run when tiles change)
  useLayoutEffect(() => {
    const put = (m: InstancedMesh | null, i: number, px: number, py: number, pz: number, sx: number, sy: number, sz: number, ry = 0, color?: string, shade = 1): void => {
      if (!m) return
      dummy.position.set(px, py, pz)
      dummy.scale.set(sx, sy, sz)
      dummy.rotation.set(0, ry, 0)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
      if (color) { tmpColor.set(color).multiplyScalar(shade); m.setColorAt(i, tmpColor) }
    }
    const cnt = { stall: 0, crate: 0, dump: 0, lid: 0, rub: 0, pole: 0, head: 0, dead: 0, dc: 0, do: 0, mark: 0 }
    const crateColors = ['#c98a2b', '#8f5d2e', '#4f7a58', '#a64b3c']
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const t = state.map.tiles[y * w + x]!
      const X = tx(x, w), Z = tz(y, h)
      const sh = seen[y * w + x] ? 1 : 0.55
      if (t.o === 'halfCover' && !propKinds.halfCover) {
        put(stallBase.current, cnt.stall++, X, 0.24, Z, 0.9, 0.48, 0.78, 0, hash2(x, y, 1) > 0.5 ? '#6b5a48' : '#5a6070', sh)
        put(stallCrate.current, cnt.crate++, X + (hash2(x, y, 3) - 0.5) * 0.3, 0.6, Z + (hash2(x, y, 4) - 0.5) * 0.2, 0.34, 0.24, 0.34, hash2(x, y, 7) * 3, crateColors[Math.floor(hash2(x, y, 8) * 4)], sh)
      } else if (t.o === 'fullCover' && !propKinds.fullCover) {
        put(dumpBody.current, cnt.dump++, X, 0.52, Z, 0.92, 1.04, 0.82, 0, '#2f5a45', sh)
        put(dumpLid.current, cnt.lid++, X, 1.09, Z, 0.98, 0.1, 0.88, 0, '#1f3b2e', sh)
      } else if (t.o === 'rubble') {
        for (let k = 0; k < 3; k++) {
          const ox = (hash2(x, y, 20 + k) - 0.5) * 0.55, oz = (hash2(x, y, 30 + k) - 0.5) * 0.55
          const sz = 0.26 + hash2(x, y, 40 + k) * 0.22
          put(rubble.current, cnt.rub++, X + ox, sz * 0.4, Z + oz, sz, sz * 0.8, sz * 1.1, hash2(x, y, 50 + k) * 3, '#6a645a', sh)
        }
      } else if (t.o === 'lamp') {
        if (!propKinds.lamp) put(poles.current, cnt.pole++, X, 1.05, Z, 1, 2.1, 1, 0, '#2c3038', sh)
        if (!propKinds.lamp) put(heads.current, cnt.head++, X, 2.15, Z, 1, 1, 1)
      }
      if (t.k === 'door') {
        const ew = isWallAt(state, x - 1, y) && isWallAt(state, x + 1, y)
        if (!t.open) put(doorsClosed.current, cnt.dc++, X, 0.62, Z, ew ? 0.98 : 0.2, 1.24, ew ? 0.2 : 0.98, 0, v2 ? '#ffffff' : '#c47a2c', sh)
        else put(doorsOpen.current, cnt.do++, ew ? X - 0.44 : X, 0.62, ew ? Z + 0.3 : Z - 0.44, ew ? 0.1 : 0.62, 1.24, ew ? 0.62 : 0.1, 0, v2 ? '#ffffff' : '#c47a2c', sh)
      }
      if (t.k === 'exit') {
        // an arrow bar pointing out of the map
        const horizontal = x === 0 || x === w - 1
        put(marks.current, cnt.mark++, X, 0.012, Z, horizontal ? 0.16 : 0.7, 0.02, horizontal ? 0.7 : 0.16, 0)
        put(marks.current, cnt.mark++, X + (x === 0 ? -0.2 : x === w - 1 ? 0.2 : 0), 0.012, Z + (y === 0 ? -0.2 : y === h - 1 ? 0.2 : 0), horizontal ? 0.4 : 0.16, 0.02, horizontal ? 0.16 : 0.4, 0)
      }
    }
    for (const [m, c] of [[stallBase.current, cnt.stall], [stallCrate.current, cnt.crate], [dumpBody.current, cnt.dump], [dumpLid.current, cnt.lid], [rubble.current, cnt.rub], [poles.current, cnt.pole], [heads.current, cnt.head], [doorsClosed.current, cnt.dc], [doorsOpen.current, cnt.do], [marks.current, cnt.mark]] as [InstancedMesh | null, number][]) {
      if (!m) continue
      m.count = c
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
    invalidate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, seen, w, h, propKinds])

  // ---- lamp light pools: one glow per original lamp, hidden when the lamp is destroyed
  useLayoutEffect(() => {
    const g = glows.current
    if (!g) return
    lamps.forEach((l, i) => {
      const alive = state.map.tiles[l.y * w + l.x]?.o === 'lamp'
      dummy.position.set(tx(l.x, w), 0.02, tz(l.y, h))
      dummy.rotation.set(-Math.PI / 2, 0, 0)
      const r = alive ? (state.tuning.light.lampRadius + 0.6) * 2 : 0.0001
      dummy.scale.set(r, r, 1)
      dummy.updateMatrix()
      g.setMatrixAt(i, dummy.matrix)
    })
    g.count = lamps.length
    g.instanceMatrix.needsUpdate = true
    lamps.forEach((l, i) => {
      const L = lights.current[i]
      if (L) L.intensity = state.map.tiles[l.y * w + l.x]?.o === 'lamp' ? 26 : 0
    })
    invalidate()
  }, [sig, lamps, w, h, lights, invalidate, state.map.tiles, state.tuning.light.lampRadius])

  // ---- wall cutaway: walls between the camera and the focus drop low (height-aware, so overviews keep their walls)
  useFrame(({ camera }) => {
    const m = walls.current
    if (!m || wallList.length === 0) return
    const cam = camera as PerspectiveCamera
    const c = boardApi.controller
    const foci: { x: number; z: number; y: number }[] = []
    if (c) foci.push({ x: c.view.x, z: c.view.z, y: 0.5 })
    const sel = focus.sel, hov = focus.hover
    if (sel) foci.push({ x: tx(sel.x, w), z: tz(sel.y, h), y: 0.6 })
    if (hov) foci.push({ x: tx(hov.x, w), z: tz(hov.y, h), y: 0.6 })
    for (const p of focus.units) foci.push({ x: tx(p.x, w), z: tz(p.y, h), y: 0.6 })
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z
    let changed = false
    for (let i = 0; i < wallList.length; i++) {
      const wl = wallList[i]!
      let low = 1
      if (wl.boundary) continue
      for (const f of foci) {
        const dx = f.x - cx, dz = f.z - cz
        const len2 = dx * dx + dz * dz
        if (len2 < 1e-6) continue
        const px = wl.wx - cx, pz = wl.wz - cz
        const t = (px * dx + pz * dz) / len2
        if (t <= 0 || t >= 1.02) continue
        const perp = Math.abs(px * dz - pz * dx) / Math.sqrt(len2)
        if (perp > 1.05) continue
        const lineY = cy + t * (f.y - cy)
        if (lineY < WALL_H + 1.1) { low = 0; break }
      }
      targets.current[i] = low ? 1 : LOW_H / WALL_H
      const cur = factors.current[i]!
      const tg = targets.current[i]!
      if (Math.abs(cur - tg) > 0.004) {
        const nv = cur + (tg - cur) * 0.3
        factors.current[i] = Math.abs(nv - tg) < 0.01 ? tg : nv
        const hgt = WALL_H * factors.current[i]!
        dummy.position.set(wl.wx, hgt / 2, wl.wz)
        dummy.scale.set(1, hgt, 1)
        dummy.rotation.set(0, 0, 0)
        dummy.updateMatrix()
        m.setMatrixAt(i, dummy.matrix)
        changed = true
      }
    }
    if (changed) { m.instanceMatrix.needsUpdate = true; wake(60) }
  })

  const cap = w * h
  return (
    <group>
      <instancedMesh ref={ground} args={[geo.box, v2 ? v2.street : mats.ground, cap]} frustumCulled={false} />
      {v2 && <instancedMesh ref={groundIn} args={[geo.box, v2.floor, cap]} frustumCulled={false} />}
      <instancedMesh ref={walls} args={[geo.box, v2 ? v2.brick : mats.wall, Math.max(1, wallList.length)]} frustumCulled={false} />
      {v2 && <instancedMesh ref={fence} args={[geo.box, v2.fence, Math.max(1, wallList.length)]} frustumCulled={false} />}
      {v2 && <instancedMesh ref={kerb} args={[geo.box, v2.kerb, Math.max(1, wallList.length)]} frustumCulled={false} />}
      {v2 && assets && <PropField state={state} assets={assets} seen={seen} lit={lit} sig={sig} />}
      <instancedMesh ref={stallBase} args={[geo.box, mats.plain, cap]} frustumCulled={false} />
      <instancedMesh ref={stallCrate} args={[geo.box, mats.plain, cap]} frustumCulled={false} />
      <instancedMesh ref={dumpBody} args={[geo.box, mats.metal, cap]} frustumCulled={false} />
      <instancedMesh ref={dumpLid} args={[geo.box, mats.metal, cap]} frustumCulled={false} />
      <instancedMesh ref={rubble} args={[geo.box, mats.plain, cap * 3]} frustumCulled={false} />
      <instancedMesh ref={poles} args={[geo.pole, mats.metal, 16]} frustumCulled={false} />
      <instancedMesh ref={heads} args={[geo.head, mats.lampHead, 16]} frustumCulled={false} />
      <instancedMesh ref={doorsClosed} args={[geo.box, v2 ? v2.door : mats.door, 16]} frustumCulled={false} />
      <instancedMesh ref={doorsOpen} args={[geo.box, v2 ? v2.door : mats.door, 16]} frustumCulled={false} />
      <instancedMesh ref={marks} args={[geo.box, mats.mark, 64]} frustumCulled={false} />
      <instancedMesh ref={glows} args={[undefined, undefined, Math.max(1, lamps.length)]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={glowTexture()} transparent depthWrite={false} blending={AdditiveBlending} opacity={0.9} />
      </instancedMesh>
      <Van state={state} />
      <ZoneFrame state={state} />
    </group>
  )
}

function Van({ state }: { state: State }): React.JSX.Element | null {
  const { w, h } = state.map
  const t = useMemo(() => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (state.map.tiles[y * w + x]!.k === 'escape') return { x, y }
    return null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.map.id])
  if (!t) return null
  const X = tx(t.x, w), Z = tz(t.y, h)
  return (
    <group position={[X, 0, Z]}>
      <mesh position={[0, 0.5, 0.05]}><boxGeometry args={[0.8, 0.7, 0.92]} /><meshStandardMaterial color="#d8d6d0" roughness={0.5} metalness={0.2} /></mesh>
      <mesh position={[0, 0.38, -0.34]}><boxGeometry args={[0.78, 0.46, 0.34]} /><meshStandardMaterial color="#9ea0a6" roughness={0.5} metalness={0.2} /></mesh>
      <mesh position={[0, 0.62, -0.46]}><boxGeometry args={[0.7, 0.2, 0.1]} /><meshStandardMaterial color="#101318" roughness={0.2} metalness={0.6} /></mesh>
      <mesh position={[0, 0.48, 0.52]}><boxGeometry args={[0.8, 0.12, 0.02]} /><meshStandardMaterial color="#ff3b2f" emissive="#ff2a1e" emissiveIntensity={1.6} /></mesh>
      <mesh position={[0, 0.9, 0.05]}><boxGeometry args={[0.5, 0.06, 0.3]} /><meshStandardMaterial color="#ffb000" emissive="#ff9a00" emissiveIntensity={1.4} /></mesh>
    </group>
  )
}

function ZoneFrame({ state }: { state: State }): React.JSX.Element | null {
  const { w, h } = state.map
  const ex = state.map.extraction
  if (!ex.length) return null
  const minx = Math.min(...ex.map((p) => p.x)), maxx = Math.max(...ex.map((p) => p.x))
  const miny = Math.min(...ex.map((p) => p.y)), maxy = Math.max(...ex.map((p) => p.y))
  const cx = tx((minx + maxx) / 2, w), cz = tz((miny + maxy) / 2, h)
  const W = maxx - minx + 1, H = maxy - miny + 1
  const t = 0.09
  return (
    <group position={[cx, 0.02, cz]}>
      {[[0, -H / 2, W, t], [0, H / 2, W, t], [-W / 2, 0, t, H], [W / 2, 0, t, H]].map((b, i) => (
        <mesh key={i} position={[b[0]!, 0, b[1]!]}><boxGeometry args={[b[2]!, 0.03, b[3]!]} /><meshStandardMaterial color="#43e08a" emissive="#27d070" emissiveIntensity={1.8} /></mesh>
      ))}
    </group>
  )
}
