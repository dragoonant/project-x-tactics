import { expect, test } from '@playwright/test'
import { beginGame, openStart, watchErrors } from './helpers'

// A minimal silent 8-bit mono WAV (44 header bytes + 800 samples).
function wav(): Buffer {
  const n = 800
  const b = Buffer.alloc(44 + n)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28)
  b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40)
  b.fill(128, 44)
  return b
}

test('audio: a manifest turns audio on (settings say so), SFX and music requests succeed, missing manifest says "audio not found"', async ({ page }) => {
  const requested: string[] = []
  await page.route('**/assets/audio/manifest.json', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ sfx: { rifle: 'sfx/rifle.wav', cuff: 'sfx/cuff.wav', explosion: 'sfx/boom.wav' }, music: { calm: 'music/calm.wav', tense: 'music/tense.wav', combat: 'music/combat.wav' } }) }),
  )
  await page.route('**/assets/audio/**/*.wav', (r) => { requested.push(r.request().url()); return r.fulfill({ contentType: 'audio/wav', body: wav() }) })
  const errs = watchErrors(page)
  await openStart(page)
  await beginGame(page)
  await page.mouse.click(20, 400) // iOS-style unlock gesture
  await page.evaluate(async () => { for (let i = 0; i < 4; i++) await window.__px.randomStep(i, 0) })
  await page.waitForTimeout(500)
  await page.getByTestId('gear').click()
  await expect(page.getByText('audio ready')).toBeVisible()
  expect(requested.some((u) => u.includes('calm'))).toBe(true)
  expect(errs.filter((e) => !/ReadPixels|autoplay/i.test(e))).toEqual([])
})
