// Mounts the camera controller inside the persistent <Canvas> and exposes it to the HUD, the director and the test hook.
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import type { PerspectiveCamera } from 'three'
import type { Pt } from '../../engine'
import { camApi, loop } from '../game/presentation'
import { CameraController, fitBoard, insetsFor, POL_DEFAULT } from './camera'
import { tx, tz } from './layout'

export const boardApi = {
  rotate: (_dir: number): void => { /* set by CameraRig */ },
  home: (): void => { /* set by CameraRig */ },
  controller: null as CameraController | null,
  w: 22,
  h: 22,
  /** Highest point of the ground under a tile is 0 (flat map). */
  tileToScreen: (x: number, y: number): { x: number; y: number } | null => {
    const c = boardApi.controller
    return c ? c.project(tx(x, boardApi.w), 0, tz(y, boardApi.h)) : null
  },
}

export function CameraRig({ w, h }: { w: number; h: number }): null {
  const { camera, gl, size, invalidate } = useThree()
  const ctl = useMemo(() => new CameraController(camera as PerspectiveCamera, gl.domElement), [camera, gl])

  useEffect(() => {
    loop.invalidate = invalidate
    // review / test access (T0 screenshots): camera controller and a forced redraw
    Object.assign(window, { __pxBoard: boardApi, __pxWake: invalidate })
    return () => { loop.invalidate = null }
  }, [invalidate])

  useEffect(() => {
    ctl.attach()
    boardApi.controller = ctl
    boardApi.w = w
    boardApi.h = h
    boardApi.rotate = (d) => ctl.rotateBy(d)
    boardApi.home = () => ctl.flyHome()
    camApi.flyTo = (x: number, y: number) => ctl.flyTo(tx(x, w), tz(y, h))
    camApi.focusTile = (p: Pt) => ctl.flyTo(tx(p.x, w), tz(p.y, h))
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLElement && /input|textarea|select/i.test(e.target.tagName)) return
      if (e.key === 'q' || e.key === 'Q') ctl.rotateBy(-1)
      if (e.key === 'e' || e.key === 'E') ctl.rotateBy(1)
      if (e.key === 'Home') ctl.flyHome()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); ctl.detach(); if (boardApi.controller === ctl) boardApi.controller = null }
  }, [ctl, w, h])

  useEffect(() => {
    const cam = camera as PerspectiveCamera
    const ins = insetsFor(size.width, size.height)
    const pol = size.width < 900 && size.height > size.width ? 0.5 : POL_DEFAULT // phone portrait: more overhead, so the board fills more of the tall screen
    const fit = fitBoard(cam.fov, size.width, size.height, ins, 0, pol, w, h)
    ctl.setFit(fit.dist, fit.shiftX, fit.shiftY, { x: w / 2, z: h / 2 }, pol)
  }, [ctl, camera, size.width, size.height, w, h])

  useFrame((_, dt) => { if (ctl.update(Math.min(dt, 0.1))) invalidate() })
  return null
}
