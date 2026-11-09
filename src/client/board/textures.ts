// Procedural textures (canvas), built once and shared. No external files.
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace } from 'three'
import { hash2 } from './layout'

const cache = new Map<string, CanvasTexture>()

function make(key: string, size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, repeat = false): CanvasTexture {
  const hit = cache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  draw(g, size)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  t.magFilter = LinearFilter
  t.minFilter = LinearMipmapLinearFilter
  t.anisotropy = 4
  if (repeat) { t.wrapS = t.wrapT = RepeatWrapping }
  cache.set(key, t)
  return t
}

/** Wet cobble / asphalt: speckle, seams, a few lighter puddle patches. */
export function groundTexture(): CanvasTexture {
  return make('ground', 128, (g, s) => {
    g.fillStyle = '#b9bcc4'
    g.fillRect(0, 0, s, s)
    for (let i = 0; i < 900; i++) {
      const v = 150 + Math.floor(hash2(i, 3) * 90)
      g.fillStyle = `rgba(${v},${v},${v + 8},${0.25 + hash2(i, 9) * 0.3})`
      g.fillRect(hash2(i, 1) * s, hash2(i, 2) * s, 1 + hash2(i, 5) * 2, 1 + hash2(i, 6) * 2)
    }
    for (let i = 0; i < 3; i++) {
      const x = 20 + hash2(i, 11) * 88, y = 20 + hash2(i, 12) * 88
      const gr = g.createRadialGradient(x, y, 2, x, y, 20 + hash2(i, 13) * 14)
      gr.addColorStop(0, 'rgba(235,240,255,0.35)')
      gr.addColorStop(1, 'rgba(235,240,255,0)')
      g.fillStyle = gr
      g.fillRect(0, 0, s, s)
    }
    g.strokeStyle = 'rgba(20,22,30,0.55)'
    g.lineWidth = 3
    g.strokeRect(0, 0, s, s)
  })
}

export function wallTexture(): CanvasTexture {
  return make('wall', 128, (g, s) => {
    g.fillStyle = '#d0c6bc'
    g.fillRect(0, 0, s, s)
    const rows = 8
    for (let r = 0; r < rows; r++) {
      const y = (r * s) / rows
      g.fillStyle = 'rgba(40,30,25,0.55)'
      g.fillRect(0, y, s, 2)
      const off = r % 2 ? s / 8 : 0
      for (let c = 0; c < 4; c++) { g.fillRect(off + (c * s) / 4, y, 2, s / rows) }
      for (let c = 0; c < 4; c++) {
        const v = 170 + Math.floor(hash2(r, c, 4) * 60)
        g.fillStyle = `rgba(${v},${v - 20},${v - 30},0.35)`
        g.fillRect(off + (c * s) / 4 + 2, y + 2, s / 4 - 3, s / rows - 3)
      }
    }
  })
}

/** Soft radial light pool (additive decal under a lamp). */
export function glowTexture(): CanvasTexture {
  return make('glow', 128, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2)
    gr.addColorStop(0, 'rgba(255,170,70,0.75)')
    gr.addColorStop(0.45, 'rgba(255,140,40,0.32)')
    gr.addColorStop(1, 'rgba(255,120,30,0)')
    g.fillStyle = gr
    g.fillRect(0, 0, s, s)
  })
}

export function cloudTexture(): CanvasTexture {
  return make('cloud', 64, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 1, s / 2, s / 2, s / 2)
    gr.addColorStop(0, 'rgba(255,255,255,0.9)')
    gr.addColorStop(0.5, 'rgba(255,255,255,0.45)')
    gr.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = gr
    g.fillRect(0, 0, s, s)
  })
}
