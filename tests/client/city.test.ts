// Holo-table layout helpers (src/client/campaign/layout.ts): plates do not overlap, picking finds the plate under a point, skylines
// stay on their plate and are the same every time.
import { describe, expect, it } from 'vitest'
import { CELL_D, CELL_W, TABLE_D, TABLE_W, blocksFor, districtCenter, pickDistrict } from '../../src/client/campaign/layout'
import { CAMPAIGN } from '../../src/data'

describe('holo-table layout', () => {
  it('six plates on the table, none overlapping; every plate centre picks its own district', () => {
    const ids = CAMPAIGN.districts.map((d) => d.id)
    for (let i = 0; i < ids.length; i++) {
      const c = districtCenter(i)
      expect(Math.abs(c.x) + CELL_W / 2).toBeLessThanOrEqual(TABLE_W / 2)
      expect(Math.abs(c.z) + CELL_D / 2).toBeLessThanOrEqual(TABLE_D / 2)
      expect(pickDistrict(c.x, c.z)).toBe(i)
      expect(pickDistrict(c.x + CELL_W / 2 - 0.1, c.z - CELL_D / 2 + 0.1)).toBe(i)
      for (let j = 0; j < i; j++) {
        const d = districtCenter(j)
        expect(Math.abs(c.x - d.x) >= CELL_W || Math.abs(c.z - d.z) >= CELL_D).toBe(true)
      }
    }
    expect(pickDistrict(0, 0)).toBeNull() // the street between the rows
    expect(pickDistrict(99, 0)).toBeNull()
  })

  it('skyline blocks are seeded per district, stay on the plate, clear of the front strip, and do not overlap', () => {
    for (const d of CAMPAIGN.districts) {
      const b = blocksFor(d.id)
      expect(b).toEqual(blocksFor(d.id))
      expect(b.length).toBeGreaterThan(4)
      for (const k of b) {
        expect(Math.abs(k.x) + k.w / 2).toBeLessThanOrEqual(CELL_W / 2)
        expect(k.z - k.d / 2).toBeGreaterThanOrEqual(-CELL_D / 2)
        expect(k.z + k.d / 2).toBeLessThanOrEqual(CELL_D / 2 - 1.3)
        expect(k.h).toBeGreaterThan(0)
      }
      for (let i = 0; i < b.length; i++) for (let j = 0; j < i; j++) {
        const p = b[i]!, q = b[j]!
        expect(Math.abs(p.x - q.x) >= (p.w + q.w) / 2 || Math.abs(p.z - q.z) >= (p.d + q.d) / 2).toBe(true)
      }
    }
    expect(blocksFor('spire').reduce((a, k) => a + k.h, 0) / blocksFor('spire').length).toBeGreaterThan(blocksFor('market').reduce((a, k) => a + k.h, 0) / blocksFor('market').length)
  })
})
