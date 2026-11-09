// Tile <-> world mapping. The board is centred on the origin; x east, tile y south => world z south.
export const tx = (x: number, w: number): number => x - w / 2 + 0.5
export const tz = (y: number, h: number): number => y - h / 2 + 0.5
export function worldToTile(px: number, pz: number, w: number, h: number): { x: number; y: number } {
  return { x: Math.floor(px + w / 2), y: Math.floor(pz + h / 2) }
}
export const inRange = (x: number, y: number, w: number, h: number): boolean => x >= 0 && y >= 0 && x < w && y < h

/** Deterministic pseudo-random in 0..1 from tile coordinates. */
export function hash2(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  h ^= h >>> 16
  return ((h >>> 0) % 10000) / 10000
}
