import { build } from "esbuild";
await build({
  entryPoints: {
    "svg/render": "packages/infrastructure/src/svg-render-worker.ts",
    "api/main": "apps/api/src/main.ts",
    "worker/main": "apps/worker/src/main.ts",
  },
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  external: ["pg", "sharp"],
});
// Bundle workspace and ESM dependencies together; keep pg as an explicit root runtime dependency.
