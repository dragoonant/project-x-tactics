// GLB to self-contained JSON glTF (the binary chunk embedded as a data: URI). Used by tools/pack-artifact.mjs for the Artifact build,
// and by tests/e2e/artifact-host.spec.ts to load a packed figure under the Artifact host's content policy.
export function glbToJson(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB')
  let off = 12
  let json = null
  let bin = null
  while (off < buf.length) {
    const len = buf.readUInt32LE(off)
    const type = buf.readUInt32LE(off + 4)
    const chunk = buf.subarray(off + 8, off + 8 + len)
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8').replace(/[\u0000 ]+$/, ''))
    else if (type === 0x004e4942) bin = chunk
    off += 8 + len
  }
  if (!json) throw new Error('GLB has no JSON chunk')
  if (bin) {
    // The GLB-stored buffer is the first one without a uri (meshopt fallback buffers also lack a uri but are marked).
    const b = json.buffers.find((x) => x.uri === undefined && !x.extensions?.EXT_meshopt_compression?.fallback)
    if (!b) throw new Error('no buffer for the BIN chunk')
    b.uri = 'data:application/octet-stream;base64,' + Buffer.from(bin).toString('base64')
  }
  return JSON.stringify(json)
}
