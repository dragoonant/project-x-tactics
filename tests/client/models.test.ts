import { beforeAll, describe, expect, it } from 'vitest'

beforeAll(() => {
  ;(globalThis as unknown as { document: { baseURI: string } }).document = { baseURI: 'http://localhost/app/' }
})

describe('model manifest reader (rule 26)', async () => {
  const { parseManifest, normalizeKind } = await import('../../src/client/game/models')

  it('reads a flat map, nested maps and arrays', () => {
    const flat = parseManifest({ recruit: 'recruit.glb', 'vox-operator': 'vox-operator.glb', notes: 'hello' })
    expect([...flat.keys()].sort()).toEqual(['recruit', 'vox'])
    expect(flat.get('recruit')!.url).toBe('http://localhost/app/assets/models/recruit.glb')
    const nested = parseManifest({ models: { bulwark: { file: 'bulwark.glb', yaw: 3.14, height: 1.1 } } })
    expect(nested.get('bulwark')).toMatchObject({ yaw: 3.14, height: 1.1 })
    const arr = parseManifest({ units: [{ id: 'enforcer', path: 'assets/models/enforcer.glb' }, { kind: 'chem-trooper', file: 'chem.glb' }] })
    expect(arr.get('enforcer')!.url).toBe('http://localhost/app/assets/models/enforcer.glb')
    expect(arr.has('chem')).toBe(true)
  })

  it('ignores junk and non-model files', () => {
    expect(parseManifest(null).size).toBe(0)
    expect(parseManifest({ a: 3, b: ['x'], c: { file: 'readme.txt' } }).size).toBe(0)
    expect(normalizeKind(' Vox-Operator ')).toBe('vox')
  })
})
