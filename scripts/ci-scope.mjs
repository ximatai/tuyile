import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { appendFileSync } from "node:fs";
export function verificationScope(event, files = []) {
  const docsOnly =
    files.length > 0 &&
    files.every(
      (path) =>
        path.startsWith("docs/") ||
        /^[^/]+\.md$/.test(path) ||
        /^\.github\/(CONTRIBUTING|SECURITY|.*TEMPLATE.*)\.md$/.test(path),
    );
  const full =
    event !== "pull_request" ||
    !files.length ||
    files.some(
      (path) =>
        /^(packages\/|apps\/(api|worker)\/|migrations\/|patches\/|scripts\/|tests\/|deploy\/|\.github\/workflows\/)/.test(
          path,
        ) ||
        /^(Dockerfile|\.dockerignore|compose.*\.ya?ml|.*lock.*|package\.json|pnpm-workspace\.yaml|tsconfig\.json|\.npmrc|\.node-version)$/.test(
          path,
        ) ||
        /^apps\/web\/src\/(api\.ts|auth\.tsx|session-state\.tsx|project-draft(?:-store)?\.tsx?|editor\/store\.ts)$/.test(
          path,
        ),
    );
  const frontendOnly =
    files.length > 0 &&
    files.every(
      (path) =>
        path.startsWith("apps/web/src/") ||
        path.startsWith("docs/") ||
        /^[^/]+\.md$/.test(path),
    );
  const unknown = !docsOnly && !frontendOnly;
  const dependency = files.some((path) =>
    /(^|\/)(package\.json|tsconfig[^/]*\.json)$/.test(path),
  );
  const webConfig = files.some((path) => /^apps\/web\/(?!src\/)/.test(path));
  return {
    code: event !== "pull_request" || !docsOnly,
    full: full || dependency || webConfig || unknown,
    docker:
      event !== "pull_request" || full || dependency || webConfig || unknown,
    docker_extended:
      event === "workflow_dispatch" ||
      webConfig ||
      dependency ||
      files.some((path) =>
        /^(packages\/ui\/|patches\/|deploy\/|scripts\/docker|\.github\/workflows\/|Dockerfile$|\.dockerignore$|compose.*\.ya?ml$)/.test(
          path,
        ),
      ),
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const event = process.env.CI_EVENT;
  if (!["push", "pull_request", "workflow_dispatch"].includes(event))
    throw new Error("UNKNOWN_CI_EVENT");
  let files = [];
  if (event === "pull_request") {
    const { CI_BASE_SHA: base, CI_HEAD_SHA: head } = process.env;
    if (![base, head].every((value) => /^[a-f0-9]{40}$/.test(value ?? "")))
      throw new Error("INVALID_CI_REF");
    files = execFileSync(
      "git",
      ["diff", "--name-only", "--no-renames", "-z", `${base}...${head}`],
      { encoding: "utf8" },
    )
      .split("\0")
      .filter(Boolean);
  }
  const scope = verificationScope(event, files);
  for (const [name, value] of Object.entries(scope))
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  console.log(`Verification scope: ${JSON.stringify(scope)}`);
}
