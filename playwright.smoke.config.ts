import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
// Separate entry: smoke-only fixtures must not mutate the full suite's catalog.
export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: [
    "**/critical.spec.ts",
    "**/canvas-gestures.spec.ts",
    "**/text-canvas.spec.ts",
  ],
});
