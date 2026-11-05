import { defineConfig } from "@playwright/test";
import built from "./playwright.built.config";
// Independent database fixture: model catalog bootstrap must not precede legacy migration checks.
export default defineConfig({
  ...built,
  testIgnore: [],
  testMatch: ["**/creation-journey.spec.ts"],
});
