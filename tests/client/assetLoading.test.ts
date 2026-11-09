import { describe, expect, it } from 'vitest'
import { dataUriToBlobUrl } from '../../src/client/assetLoading'

// The claude.ai Artifact host blocks fetch() of data: URIs (connect-src has blob: but not data:); the loaders get blob: URLs instead.
describe('asset loading on the Artifact host', () => {
  it('turns a base64 data: URI into a blob: URL with the same bytes and type', async () => {
    const url = dataUriToBlobUrl('data:application/octet-stream;base64,AAEC/w==')
    expect(url.startsWith('blob:')).toBe(true)
    const buf = new Uint8Array(await (await fetch(url)).arrayBuffer())
    expect([...buf]).toEqual([0, 1, 2, 255])
  })

  it('keeps the media type and reads percent-encoded data: URIs', async () => {
    const url = dataUriToBlobUrl('data:text/plain;charset=utf-8,hi%20there')
    const r = await fetch(url)
    expect(await r.text()).toBe('hi there')
    expect((await (await fetch(dataUriToBlobUrl('data:image/webp;base64,UklGRg=='))).blob()).type).toBe('image/webp')
  })

  it('leaves every other URL alone', () => {
    for (const u of ['./assets/anim/enforcer.glb', 'https://example.test/a.json', 'blob:abc', 'data:broken']) expect(dataUriToBlobUrl(u)).toBe(u)
  })
})
