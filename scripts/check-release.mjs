import { execFileSync } from "node:child_process";

// Inspect the Git index: unstaged redaction must not hide a staged secret.
const git = (...args) =>
  execFileSync("git", args, { maxBuffer: 16 * 1024 * 1024 });
const entries = git("ls-files", "--stage", "-z")
  .toString()
  .split("\0")
  .filter(Boolean);
const failures = [];
const required = new Set([
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_NOTICES.md",
  "licenses/gpt-image-canvas-MIT.txt",
]);
const protectedPath =
  /(?:^|\/)(?:\.git|\.codex-temp|\.ssh|\.aws|\.kube|node_modules|dist|build|coverage|\.cache|storage|data|uploads|backups|output|tmp|test-results|playwright-report)(?:\/|$)|(?:^|\/)(?:id_rsa|id_ed25519)|\.(?:pem|key|p12|pfx|jks|keystore|dump|sqlite(?:3)?(?:-.*)?|db(?:-.*)?|log|zip|tgz|tar(?:\.gz)?|sql\.gz)$/i;
const media = /\.(?:png|jpe?g|webp|gif|avif|svg|pdf|mp4|mov|mp3|wav)$/i;
let inspected = 0;
for (const entry of entries) {
  const tab = entry.indexOf("\t");
  const [mode, oid, stage] = entry.slice(0, tab).split(" ");
  const file = entry.slice(tab + 1);
  required.delete(file);
  const fail = (reason) => failures.push({ file, reason });
  if (stage !== "0") {
    fail("unresolved merge entry");
    continue;
  }
  if (mode !== "100644" && mode !== "100755") {
    fail("non-regular tracked file requires review");
    continue;
  }
  if (
    protectedPath.test(file) ||
    (/(?:^|\/)\.env(?:\..*)?$/.test(file) && file !== ".env.example")
  ) {
    fail("private/generated artifact in Git index");
    continue;
  }
  if (media.test(file) && !file.startsWith("docs/images/")) {
    fail("media must be explicitly reviewed under docs/images/");
    continue;
  }
  const size = Number(git("cat-file", "-s", oid).toString());
  if (size > 2 * 1024 * 1024) {
    fail("source artifact exceeds 2 MiB");
    continue;
  }
  const content = git("cat-file", "blob", oid);
  inspected++;
  if (media.test(file)) continue;
  if (content.includes(0)) {
    fail("unexpected binary artifact");
    continue;
  }
  const text = content.toString("utf8");
  if (/\/(?:Users|home)\/[A-Za-z0-9_.-]+\//.test(text))
    fail("machine-specific home path");
  if (
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(text) ||
    /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{24,})\b/.test(
      text,
    )
  )
    fail("secret-like content; use redacted Gitleaks for full inspection");
  if (/(?:^|\/)package\.json$/.test(file)) {
    try {
      const manifest = JSON.parse(text);
      if (manifest.license !== "Apache-2.0")
        fail("missing Apache-2.0 package metadata");
      if (manifest.private !== true)
        fail(
          "workspace package must remain private to prevent accidental npm publication",
        );
    } catch {
      fail("invalid package manifest");
    }
  }
}
for (const file of required)
  failures.push({
    file,
    reason: "required license material missing from Git index",
  });
for (const { file, reason } of failures) console.error(`${file}: ${reason}`);
if (failures.length) process.exitCode = 1;
else
  console.log(
    `Release artifact check passed: ${inspected} indexed files. Run Gitleaks separately; this is not a security audit.`,
  );
