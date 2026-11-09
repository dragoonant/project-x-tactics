import { expect, type Page } from '@playwright/test'

export interface Px {
  camera(): { x: number; z: number; az: number; pol: number; dist: number; overview: number } | null
  tileToScreen(x: number, y: number): { x: number; y: number } | null
  state(): any
  fog(): any
  screen(): string
  busy(): boolean
  selected(): string | null
  ticker(): string[]
  models(): { done: number; total: number; ready: boolean }
  legal(): any[]
  dispatch(a: unknown): Promise<boolean>
  endTurn(): Promise<void>
  select(id: string): void
  tap(x: number, y: number): Promise<void>
  setSpeed(s: 'normal' | 'fast' | 'instant'): void
  start(squad: string[], seed: number): void
  randomStep(salt?: number, endChance?: number): Promise<boolean>
  autoplay(max?: number): Promise<{ screen: string; steps: number; round: number }>
}
declare global { interface Window { __px: Px } }

/** Collects console errors, page errors and failed requests. Warnings (GPU driver chatter) are ignored. */
export function watchErrors(page: Page): string[] {
  const errs: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text()}`) })
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`))
  page.on('response', (r) => { if (r.status() >= 400) errs.push(`http ${r.status()}: ${r.url()}`) })
  return errs
}

export async function openStart(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByTestId('start-screen')).toBeVisible()
  await expect(page.getByTestId('new-op')).toBeEnabled({ timeout: 60_000 })
}

export async function beginGame(page: Page, speed: 'normal' | 'fast' | 'instant' = 'instant'): Promise<void> {
  await page.evaluate((s) => window.__px.setSpeed(s), speed)
  await page.getByTestId('new-op').click()
  await expect(page.getByTestId('hud')).toBeVisible()
  await page.waitForFunction(() => window.__px.camera() !== null)
}

export async function cam(page: Page): Promise<{ x: number; z: number; az: number; pol: number; dist: number }> {
  return (await page.evaluate(() => window.__px.camera()))!
}
