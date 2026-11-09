import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export default defineConfig(({ command }) => ({
  base: './',
  plugins: [react()],
  // A build knows which optional asset manifests it ships, so the published page never requests a file that is not there
  // (a 404 would show up as a console error). The dev server always asks: the manifests may appear while it runs.
  define: {
    __PX_MANIFESTS__: JSON.stringify(
      command === 'build'
        ? { models: existsSync('public/assets/models/manifest.json'), audio: existsSync('public/assets/audio/manifest.json') }
        : { models: true, audio: true },
    ),
  },
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), debug: resolve(import.meta.dirname, 'debug.html') } },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
  },
}))
