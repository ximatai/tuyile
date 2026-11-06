import { it, expect } from "vitest";
import { rootVersionOnly, verificationScope } from "../../scripts/ci-scope.mjs";
it("keeps main/manual and unknown PR scope conservative", () => {
  expect(verificationScope("push", ["docs/a.md"])).toMatchObject({
    code: true,
    full: true,
    docker: true,
  });
  expect(verificationScope("workflow_dispatch")).toMatchObject({
    full: true,
    docker_extended: true,
  });
  expect(verificationScope("pull_request", [])).toMatchObject({
    code: true,
    full: true,
  });
});
it("selects cheap docs checks and bounded frontend smoke", () => {
  expect(
    verificationScope("pull_request", ["docs/development.md", "README.md"]),
  ).toMatchObject({ code: false, docker: false });
  expect(
    verificationScope("pull_request", ["apps/web/src/styles.css"]),
  ).toMatchObject({ code: true, full: false, docker: false });
});
it("forces full verification for cross-layer, harness and deployment changes", () => {
  for (const path of [
    "packages/contracts/src/canvas.ts",
    "apps/api/src/app.ts",
    "migrations/a.sql",
    "tests/e2e/a.spec.ts",
    "scripts/ci-scope.mjs",
    "pnpm-lock.yaml",
    ".env.example",
    "package.json",
    "new-configuration.conf",
    "patches/a.patch",
    "apps/web/package.json",
    "apps/web/vite.config.ts",
    ".github/workflows/verify.yml",
    "apps/web/src/editor/store.ts",
    "apps/web/src/project-draft-store.ts",
    "apps/web/src/project-draft.tsx",
    "apps/web/src/auth.tsx",
  ])
    expect(verificationScope("pull_request", [path]).full, path).toBe(true);
  for (const path of [
    "Dockerfile",
    "patches/a.patch",
    "packages/ui/src/a.tsx",
    "deploy/nginx.conf.example",
  ])
    expect(
      verificationScope("pull_request", [path]).docker_extended,
      path,
    ).toBe(true);
});

it("uses frontend PR scope for a proven root version bump", () => {
  const before = '{"version":"1.1.0","scripts":{"build":"pnpm build"}}';
  expect(
    rootVersionOnly(
      before,
      '{"scripts":{"build":"pnpm build"},"version":"1.1.1"}',
    ),
  ).toBe(true);
  for (const after of [
    before,
    '{"version":"1.1.1","scripts":{"build":"node build.mjs"}}',
    '{"version":"1.1.1","dependencies":{"another":"1.0.0"}}',
    '{"version":"latest","scripts":{"build":"pnpm build"}}',
    "",
  ])
    expect(rootVersionOnly(before, after)).toBe(false);

  const versionAndIcon = ["package.json", "apps/web/src/editor/canvas.tsx"];
  for (const files of [["package.json"], versionAndIcon])
    expect(verificationScope("pull_request", files, true)).toEqual({
      code: true,
      full: false,
      docker: false,
      docker_extended: false,
    });
  expect(
    verificationScope(
      "pull_request",
      [...versionAndIcon, "pnpm-lock.yaml"],
      true,
    ),
  ).toMatchObject({ full: true, docker: true });
  expect(
    verificationScope(
      "pull_request",
      [...versionAndIcon, "apps/web/package.json"],
      true,
    ),
  ).toMatchObject({ full: true, docker: true, docker_extended: true });
  expect(verificationScope("push", versionAndIcon, true)).toMatchObject({
    full: true,
    docker: true,
  });
});
