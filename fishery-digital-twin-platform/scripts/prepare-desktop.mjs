import fs from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const workspaceRoot = process.cwd();
const desktopRoot = path.join(workspaceRoot, "apps", "desktop");
const runtimeRoot = path.join(desktopRoot, "runtime");
const standaloneSource = path.join(workspaceRoot, "apps", "frontend", ".next", "standalone");
const frontendRuntime = path.join(runtimeRoot, "frontend");
const backendRuntime = path.join(runtimeRoot, "backend");

if (!runtimeRoot.startsWith(desktopRoot + path.sep)) {
  throw new Error("Refusing to prepare a runtime directory outside apps/desktop.");
}

await fs.access(standaloneSource);
// Do not recursively delete the existing runtime before rebuilding it. On
// Windows, OneDrive/antivirus can hold one of the thousands of Next.js files
// open and make fs.rm spend minutes retrying (or fail with EPERM). Copying over
// the generated runtime is idempotent and keeps the last working desktop build
// intact until the replacement files are ready.
await fs.mkdir(backendRuntime, { recursive: true });
await fs.cp(standaloneSource, frontendRuntime, {
  recursive: true,
  force: true,
  errorOnExist: false,
});

const serverCandidates = [
  path.join(frontendRuntime, "apps", "frontend", "server.js"),
  path.join(frontendRuntime, "server.js"),
];

let frontendServer;
for (const candidate of serverCandidates) {
  try {
    await fs.access(candidate);
    frontendServer = candidate;
    break;
  } catch {
    // Continue to the next supported Next.js standalone layout.
  }
}

if (!frontendServer) {
  throw new Error("Next.js standalone server.js was not found.");
}

const frontendAppRoot = path.dirname(frontendServer);
await fs.cp(
  path.join(workspaceRoot, "apps", "frontend", ".next", "static"),
  path.join(frontendAppRoot, ".next", "static"),
  { recursive: true },
);
await fs.cp(
  path.join(workspaceRoot, "apps", "frontend", "public"),
  path.join(frontendAppRoot, "public"),
  { recursive: true },
);

const backendOutput = path.join(backendRuntime, "index.cjs");
await build({
  entryPoints: [path.join(workspaceRoot, "apps", "backend", "src", "index.ts")],
  outfile: backendOutput,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  minify: false,
  sourcemap: false,
});

const relativeRuntimePath = (absolutePath) => path.relative(runtimeRoot, absolutePath).split(path.sep).join("/");
await fs.writeFile(
  path.join(runtimeRoot, "desktop-manifest.json"),
  `${JSON.stringify({
    frontendServer: relativeRuntimePath(frontendServer),
    backendScript: relativeRuntimePath(backendOutput),
  }, null, 2)}\n`,
  "utf8",
);
