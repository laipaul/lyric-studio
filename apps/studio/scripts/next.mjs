// Starts Next.js for the studio ("dev" or "start") on port 3000, listening on this PC only
// (127.0.0.1) unless STUDIO_HOST says otherwise (e.g. STUDIO_HOST=0.0.0.0 to open it to the network).
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

export function studioHost(env = process.env) {
  return env.STUDIO_HOST?.trim() || "127.0.0.1";
}

const mode = process.argv[2];
if (mode === "dev" || mode === "start") {
  const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
  const child = spawn(process.execPath, [next, mode, "-H", studioHost(), "-p", process.env.STUDIO_PORT || "3000"], {
    stdio: "inherit",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
  child.on("exit", (code) => process.exit(code ?? 0));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
}
