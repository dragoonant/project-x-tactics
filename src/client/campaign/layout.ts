// Holo-table layout: where each district sits on the table, which district a table point picks, and each district's procedural
// skyline blocks (seeded per district id). Pure: no three.js, no React. Display only, no campaign rules.

export const CELL_W = 7
export const CELL_D = 6
export const PITCH_X = 8
export const PITCH_Z = 7
export const TABLE_W = 27
export const TABLE_D = 17

/** District i of 6 on a 3 x 2 grid (data order: docks foundry spire / market stacks undercity). */
export function districtCenter(i: number): { x: number; z: number } {
  const col = i % 3
  const row = Math.floor(i / 3)
  return { x: (col - 1) * PITCH_X, z: (row - 0.5) * PITCH_Z }
}

/** The district index under a table point, or null between plates and off the table. */
export function pickDistrict(x: number, z: number, count = 6): number | null {
  for (let i = 0; i < count; i++) {
    const c = districtCenter(i)
    if (Math.abs(x - c.x) <= CELL_W / 2 && Math.abs(z - c.z) <= CELL_D / 2) return i
  }
  return null
}

export interface Block { x: number; z: number; w: number; d: number; h: number; round: boolean }

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

const THEME: Record<string, { n: number; hMin: number; hMax: number; size: [number, number]; round: number }> = {
  docks: { n: 9, hMin: 0.3, hMax: 1.1, size: [0.9, 1.8], round: 0 },
  foundry: { n: 9, hMin: 0.8, hMax: 1.8, size: [0.8, 1.5], round: 0.35 },
  spire: { n: 8, hMin: 2.2, hMax: 5.5, size: [0.7, 1.2], round: 0.15 },
  market: { n: 16, hMin: 0.3, hMax: 1.0, size: [0.5, 0.9], round: 0 },
  stacks: { n: 11, hMin: 1.4, hMax: 3.0, size: [0.8, 1.2], round: 0 },
  undercity: { n: 10, hMin: 0.15, hMax: 0.6, size: [0.6, 1.3], round: 0.1 },
}

/** Seeded skyline for a district; blocks stay inside the plate, clear of the front strip (pips and label). */
export function blocksFor(id: string): Block[] {
  const t = THEME[id] ?? { n: 10, hMin: 0.5, hMax: 2, size: [0.7, 1.3] as [number, number], round: 0 }
  let st = hash(id) || 1
  const r = (): number => { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; return st / 4294967296 }
  const out: Block[] = []
  const halfW = CELL_W / 2 - 0.5
  const backZ = -CELL_D / 2 + 0.5
  const frontZ = CELL_D / 2 - 1.4
  let guard = 0
  while (out.length < t.n && guard++ < 400) {
    const w = t.size[0] + r() * (t.size[1] - t.size[0])
    const d = t.size[0] + r() * (t.size[1] - t.size[0])
    const x = -halfW + w / 2 + r() * (2 * halfW - w)
    const z = backZ + d / 2 + r() * (frontZ - backZ - d)
    if (out.some((b) => Math.abs(b.x - x) < (b.w + w) / 2 + 0.12 && Math.abs(b.z - z) < (b.d + d) / 2 + 0.12)) continue
    out.push({ x, z, w, d, h: t.hMin + r() * (t.hMax - t.hMin), round: r() < t.round })
  }
  return out
}
