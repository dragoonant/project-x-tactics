// Every rule id in docs/spec/10-rules.md and docs/spec/20-campaign.md must appear in at least one test name (tests are named by rule id).
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..', '..')

function idsInSpec(file: string): string[] {
  const text = readFileSync(join(root, 'docs/spec', file), 'utf8')
  const ids = new Set<string>()
  for (const m of text.matchAll(/^- \*\*([A-Z]+(?:-[A-Z]+)?-\d+)\b/gm)) { if (!(m[1] as string).startsWith('R-')) ids.add(m[1] as string) }
  return [...ids]
}

function testNames(): string {
  const dirs = ['tests/engine', 'tests/data', 'tests/campaign']
  let names = ''
  for (const d of dirs) {
    for (const f of readdirSync(join(root, d)).filter((x) => x.endsWith('.test.ts') && x !== 'coverage.test.ts')) {
      const src = readFileSync(join(root, d, f), 'utf8')
      for (const m of src.matchAll(/\bit\(\s*(['"`])([\s\S]*?)\1\s*,/g)) names += `${m[2]}\n`
    }
  }
  return names
}

const missingIn = (ids: string[], names: string): string[] => ids.filter((id) => !new RegExp(`(^|[^A-Z0-9-])${id}(?![0-9])`).test(names))

describe('tests are named by rule id', () => {
  it('ARCH-1 every rule id in the spec appears in at least one test name', () => {
    const ids = idsInSpec('10-rules.md')
    expect(ids.length).toBeGreaterThan(130)
    expect(missingIn(ids, testNames())).toEqual([])
  })
  it('CMP-1 every rule id in the campaign spec (20) appears in at least one test name', () => {
    const ids = idsInSpec('20-campaign.md')
    expect(ids.length).toBeGreaterThan(60)
    expect(missingIn(ids, testNames())).toEqual([])
  })
})
