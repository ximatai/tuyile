import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 30000,
  reporter: "list",
  use: {
    channel: "chromium",
    baseURL: "http://127.0.0.1:5180",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node --import tsx apps/api/src/main.ts",
      url: "http://127.0.0.1:8793/api/ready",
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command:
        "corepack pnpm --filter @tuyile/web exec vite --host 127.0.0.1 --port 5180 --strictPort",
      url: "http://127.0.0.1:5180",
      reuseExistingServer: false,
      timeout: 30000,
      env: { API_TARGET: "http://127.0.0.1:8793" },
    },
  ],
});
