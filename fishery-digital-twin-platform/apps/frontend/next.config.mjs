import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** @param {string} phase */
export default function nextConfig(phase) {
  return {
    // Keep the hot-reload cache separate from production output. Mixing these
    // directories can leave webpack-runtime.js pointing at the wrong chunks.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
    output: "standalone",
    outputFileTracingRoot: workspaceRoot,
    transpilePackages: ["@fishery/shared"],
  };
}
