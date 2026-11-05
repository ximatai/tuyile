import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rasterizeSvg } from "../packages/infrastructure/src/svg-render.js";

// The full offline probe is for target-image acceptance. Compose uses the
// Linux hard-limit checks alongside its own API rendering checks.
const args = process.argv.slice(2);
const limitsOnly = args.length === 1 && args[0] === "--linux-limits-only";
assert.ok(!args.length || limitsOnly, "Unsupported SVG check arguments");
if (limitsOnly) assert.equal(process.platform, "linux");

const svg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="3840" height="2160"><rect width="3840" height="2160" fill="#0062b0"/><circle cx="1920" cy="1080" r="512" fill="#ffffff"/><text x="40" y="160" font-family="Noto Sans CJK SC" font-size="96" fill="#ffffff">图一乐 SVG 验收</text></svg>',
);
async function normal() {
  const rendered = await rasterizeSvg(svg);
  assert.deepEqual([rendered.width, rendered.height], [3840, 2160]);
  const png = Buffer.from(rendered.png);
  assert.equal(png.toString("ascii", 1, 4), "PNG");
  assert.equal(png.readUInt32BE(16), 3840);
  assert.equal(png.readUInt32BE(20), 2160);
}
if (!limitsOnly) {
  await normal();
  await assert.rejects(rasterizeSvg(svg, { wallMs: 1 }), {
    code: "SVG_PREVIEW_FAILED",
  });
  await normal();
  const concurrent = await Promise.allSettled([
    rasterizeSvg(svg),
    rasterizeSvg(svg),
    rasterizeSvg(svg),
  ]);
  assert.equal(concurrent.filter((r) => r.status === "fulfilled").length, 2);
  assert.ok(
    concurrent.some(
      (r) => r.status === "rejected" && r.reason.code === "SVG_RENDERER_BUSY",
    ),
  );
  if (process.platform === "linux")
    assert.match(
      execFileSync("fc-match", ["-f", "%{family}", "Noto Sans CJK SC"], {
        encoding: "utf8",
      }),
      /Noto Sans CJK SC/,
    );
}
if (process.platform === "linux") {
  const native = execFileSync(
    "/bin/sh",
    [
      "-c",
      `ulimit -c 0
ulimit -d 196608
exec "$1" --jitless --max-old-space-size=64 -e 'try {Buffer.alloc(384*1024*1024).fill(1);process.exitCode=1;} catch {process.stdout.write("NATIVE_LIMIT_OK");}'`,
      "svg-check",
      process.execPath,
    ],
    { encoding: "utf8", timeout: 15000 },
  );
  assert.equal(native, "NATIVE_LIMIT_OK");
  const cpu = execFileSync(
    "/bin/sh",
    [
      "-c",
      `ulimit -c 0
ulimit -d 196608
ulimit -t 1
"$1" --jitless --max-old-space-size=64 -e 'while(true){}' 2>/dev/null
status=$?
[ "$status" -eq 137 ] || [ "$status" -eq 152 ] || exit 1
printf CPU_LIMIT_OK`,
      "svg-check",
      process.execPath,
    ],
    { encoding: "utf8", timeout: 15000 },
  );
  assert.equal(cpu, "CPU_LIMIT_OK");
}
console.log(
  JSON.stringify({
    svgCheck: "passed",
    mode: limitsOnly ? "linux-limits" : "full",
    platform: process.platform,
    architecture: process.arch,
    ...(!limitsOnly && {
      maximumResolution: [3840, 2160],
      killAndRecovery: true,
      boundedAdmission: true,
      cjkFontAvailable: process.platform === "linux",
    }),
    linuxNativeAndCpuLimits: process.platform === "linux",
  }),
);
