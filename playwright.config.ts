import { defineConfig } from '@playwright/test'

const port = Number(process.env.PW_PORT ?? 5281)

export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    port,
    reuseExistingServer: true,
  },
})
