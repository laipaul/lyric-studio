// Where the @fontsource font files are on disk (Node only).
import { createRequire } from "node:module";
import path from "node:path";

export function defaultFontDirs(): Record<string, string> {
  const require = createRequire(import.meta.url);
  const dir = (pkg: string) => path.join(path.dirname(require.resolve(`${pkg}/package.json`)), "files");
  return { inter: dir("@fontsource/inter"), montserrat: dir("@fontsource/montserrat") };
}
