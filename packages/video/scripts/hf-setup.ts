// pnpm hf:setup: HyperFrames' Chrome, downloaded once into the project (.cache\hyperframes). The only time the
// HyperFrames renderer goes online; renders never download anything (they stop and point here instead).
import { setupHyperframes } from "../src/node";

const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
  console.error(`\nError: HyperFrames needs Node.js 22 or newer; this is ${process.versions.node}. Install Node.js 22 LTS (see spikes\\hyperframes\\README.md).`);
  process.exit(1);
}
try {
  const browser = await setupHyperframes((m) => console.log(m));
  console.log(`HyperFrames is ready (Chrome: ${browser}). Renders now work offline.`);
} catch (error) {
  console.error(`\nError: ${(error as Error).message}`);
  process.exit(1);
}
