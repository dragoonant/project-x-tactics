// VAR-2: the raid's evidence cache on the tactical board, a crate with a status light (amber: open, green: seized, red: burned).
// Display only: no pointer handlers (rule 25).
import type { State } from '../../engine'
import { tx, tz } from './layout'

export function CacheMarker({ state }: { state: State }): React.JSX.Element | null {
  const r = state.raid
  if (!r) return null
  const { w, h } = state.map
  const col = r.seized ? '#3dff8a' : r.burned ? '#ff4a3a' : '#ffb000'
  return (
    <group position={[tx(r.cache.x, w), 0, tz(r.cache.y, h)]}>
      <mesh position={[0, 0.2, 0]}>
        <boxGeometry args={[0.55, 0.4, 0.4]} />
        <meshStandardMaterial color={r.burned ? '#2a1a14' : '#4a3a22'} emissive={col} emissiveIntensity={0.25} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.38, 0.48, 24]} />
        <meshBasicMaterial color={col} transparent opacity={0.85} />
      </mesh>
      <pointLight color={col} intensity={3} distance={2.5} position={[0, 0.7, 0]} />
    </group>
  )
}
