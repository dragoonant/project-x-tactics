import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
// @ts-expect-error plain .mjs tool without type declarations
import { glbToJson } from '../../tools/gltf-json.mjs'

// The claude.ai Artifact host serves the page under a content policy whose connect-src allows 'self' and blob: but not data:.
// The Artifact build embeds each model's buffer as a data: URI (tools/pack-artifact.mjs), so a loader that fetched it directly
// got nothing there and every figure fell back to the capsule stand-in. This runs one packed rigged figure and one packed prop
// under that policy and expects both to load.
const PORT = Number(process.env.PW_PORT ?? 5281)
const HOST_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data: blob:",
  "worker-src 'self' blob:",
  `connect-src 'self' blob: ws://localhost:${PORT}`, // the dev server's HMR socket; the host has no data: here either
].join('; ')

test('artifact host: packed figures and props load under the host content policy (no data: fetch)', async ({ page }) => {
  const violations: string[] = []
  page.on('console', (m) => { if (/Content Security Policy|could not load/.test(m.text())) violations.push(m.text()) })

  await page.route(/\/(\?.*)?$/, async (route) => {
    const res = await route.fetch()
    await route.fulfill({ response: res, headers: { ...res.headers(), 'content-security-policy': HOST_CSP } })
  })
  const anim = JSON.parse(readFileSync(join('public', 'assets', 'anim', 'manifest.json'), 'utf8'))
  const enforcer = { ...anim.figures.enforcer, file: 'enforcer.gltf.json', attachments: [] }
  await page.route('**/assets/anim/manifest.json', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...anim, figures: { enforcer }, items: {} }) }))
  await page.route('**/assets/anim/enforcer.gltf.json', (route) =>
    route.fulfill({ contentType: 'application/json', body: glbToJson(readFileSync(join('public', 'assets', 'anim', 'enforcer.glb'))) }))
  await page.route('**/assets/models/manifest.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({}) }))

  const terrain = JSON.parse(readFileSync(join('public', 'assets', 'terrain', 'manifest.json'), 'utf8'))
  const [slug, prop] = Object.entries(terrain.props as Record<string, { file: string }>)[0]!
  const packedProp = String(prop.file).replace(/\.glb$/, '.gltf.json')
  await page.route('**/assets/terrain/manifest.json', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...terrain, props: { [slug]: { ...prop, file: packedProp } } }) }))
  await page.route(`**/assets/terrain/${packedProp}`, (route) =>
    route.fulfill({ contentType: 'application/json', body: glbToJson(readFileSync(join('public', 'assets', 'terrain', prop.file))) }))

  await page.goto('/')
  await expect(page.getByTestId('new-op')).toBeEnabled({ timeout: 90_000 })
  expect(await page.evaluate(() => window.__px.rigKinds())).toContain('enforcer')
  await page.waitForTimeout(500)
  expect(violations.filter((v) => /data:|could not load/.test(v))).toEqual([])
})
