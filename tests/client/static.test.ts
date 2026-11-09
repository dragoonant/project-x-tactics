import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p] })
}
const files = walk('src/client').filter((f) => /\.(tsx?|css)$/.test(f))

describe('client source rules', () => {
  it('rule 25: only the tile pick surface in Board.tsx has pointer handlers', () => {
    for (const f of files.filter((x) => x.endsWith('.tsx') && x.includes('board'))) {
      const src = readFileSync(f, 'utf8')
      const has = /\bon(Pointer\w*|Click|DoubleClick|ContextMenu)\s*=/.test(src)
      if (f.endsWith('Board.tsx')) expect(has).toBe(true)
      else expect(has, f).toBe(false)
    }
    const board = readFileSync('src/client/board/Board.tsx', 'utf8')
    expect((board.match(/<mesh\b/g) ?? []).length).toBe(1)
  })

  it('rule 8: no native tooltips (title attributes or SVG <title>)', () => {
    for (const f of files.filter((x) => x.endsWith('.tsx'))) {
      const src = readFileSync(f, 'utf8')
      expect(/\btitle=/.test(src), f).toBe(false)
      expect(/<title>/.test(src), f).toBe(false)
    }
  })

  it('rule 24: the base CSS block is present verbatim and selectstart / contextmenu are guarded', () => {
    const css = readFileSync('src/client/style.css', 'utf8')
    expect(css).toContain("html, body, #root { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; } input, textarea, select, [contenteditable='true'] { -webkit-user-select: text; user-select: text; -webkit-touch-callout: default; } img, canvas { -webkit-user-drag: none; } button { touch-action: manipulation; }")
    const main = readFileSync('src/client/main.tsx', 'utf8')
    expect(main).toMatch(/addEventListener\('selectstart'/)
    expect(main).toMatch(/addEventListener\('contextmenu'/)
  })

  it('performance: no full-screen SVG filters and no backdrop-filter', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      expect(/backdrop-filter/.test(src), f).toBe(false)
      expect(/<feTurbulence|<filter\b/.test(src), f).toBe(false)
    }
  })

  it('the client never edits the engine, the AI or the data', () => {
    for (const f of files.filter((x) => x.endsWith('.ts') || x.endsWith('.tsx'))) {
      const src = readFileSync(f, 'utf8')
      expect(/from '\.\.\/\.\.\/ai\/(?!index)/.test(src)).toBe(false)
    }
  })
})
