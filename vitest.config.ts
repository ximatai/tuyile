import { configDefaults, defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    testTimeout: 15000,
    hookTimeout: 30000,
    exclude: [...configDefaults.exclude, "**/.codex-temp/**"],
  },
});
