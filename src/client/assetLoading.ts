// One three.js LoadingManager for every GLTF load. The claude.ai Artifact host's content policy leaves `data:` out of connect-src,
// so fetch() of a data: URI fails there. The Artifact build (tools/pack-artifact.mjs) embeds each model's binary buffer and its
// textures as data: URIs, and GLTFLoader fetches them (FileLoader for buffers, ImageBitmapLoader for images). This manager hands
// the loaders a blob: URL with the same bytes instead, and the host allows blob: in connect-src. Local dev and the repo build load
// plain .glb files and never meet a data: URI, so nothing changes there.
import { LoadingManager } from 'three'

/** How long a blob: URL lives. The loaders fetch it within the same tick; the delay only frees the memory afterwards. */
const REVOKE_MS = 60_000

/** A data: URI as a blob: URL with the same bytes and media type; any other URL is returned unchanged. */
export function dataUriToBlobUrl(url: string): string {
  if (!url.startsWith('data:')) return url
  const comma = url.indexOf(',')
  if (comma < 0) return url
  const meta = url.slice(5, comma)
  const base64 = /;base64$/i.test(meta)
  const type = (base64 ? meta.slice(0, -7) : meta).split(';')[0] || 'application/octet-stream'
  const body = url.slice(comma + 1)
  let bytes: Uint8Array
  try {
    if (base64) {
      const bin = atob(body)
      bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(body))
    }
  } catch {
    return url // malformed: let the loader fail on the original URI as before
  }
  const blobUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type }))
  setTimeout(() => URL.revokeObjectURL(blobUrl), REVOKE_MS)
  return blobUrl
}

let manager: LoadingManager | null = null
/** The manager every GLTFLoader in the client is built with. */
export function assetManager(): LoadingManager {
  if (!manager) {
    manager = new LoadingManager()
    manager.setURLModifier(dataUriToBlobUrl)
  }
  return manager
}
