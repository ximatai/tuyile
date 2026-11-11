import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
// Same guarded test database, compiled API/Worker and nonce-protected static UI.
const origin = "http://127.0.0.1:8794";
export default defineConfig({
  ...base,
  testMatch: [
    "**/image-edit.spec.ts",
    "**/svg.spec.ts",
    "**/external-agent.spec.ts",
  ],
  use: { ...base.use, baseURL: origin },
  webServer: [
    {
      command: "node dist/worker/main.js",
      wait: { stdout: /WORKER_READY/ },
      reuseExistingServer: false,
      timeout: 30000,
      env: { FAKE_IMAGE_DELAY_MS: "1800" },
    },
    {
      command: "node dist/api/main.js",
      url: `${origin}/api/ready`,
      reuseExistingServer: false,
      timeout: 30000,
      env: { APP_ORIGIN: origin, PORT: "8794" },
    },
  ],
});
