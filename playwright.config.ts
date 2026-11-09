import { defineConfig } from '@playwright/test'

const port = Number(process.env.PW_PORT ?? 5281)

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: `http://localhost:${port}`,
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    port,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
