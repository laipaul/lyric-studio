import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { BUNDLED_FONTS, bundledFontDirs, findFamily, fontFileRefs, loadFontCatalog, missingCharacters, resolveFace, resolveMediaPath } from "../src/node";

const ws = mkdtempSync(path.join(os.tmpdir(), "lyric-fonts-"));
afterAll(() => rmSync(ws, { recursive: true, force: true }));

// "User fonts": real font files copied under other names into WORKSPACE_DIR\fonts.
const dirs = bundledFontDirs();
mkdirSync(path.join(ws, "fonts"));
copyFileSync(path.join(dirs["kalam"], "kalam-latin-700-normal.woff2"), path.join(ws, "fonts", "MyHandwriting-Bold.woff2"));
copyFileSync(path.join(dirs["courier-prime"], "courier-prime-latin-400-italic.woff2"), path.join(ws, "fonts", "typewriter-italic.woff2"));
writeFileSync(path.join(ws, "fonts", "broken.ttf"), "not a font");
writeFileSync(path.join(ws, "fonts", "notes.txt"), "ignored");

describe("font catalog", () => {
  const catalog = loadFontCatalog(ws);

  it("has all 16 bundled families with their weights and italics", () => {
    expect(BUNDLED_FONTS).toHaveLength(16);
    for (const [, family] of BUNDLED_FONTS) expect(findFamily(catalog, family)?.faces.length).toBeGreaterThan(0);
    const italics = (family: string) => findFamily(catalog, family)!.faces.some((f) => f.style === "italic");
    expect(italics("Cormorant Garamond")).toBe(true);
    expect(italics("Courier Prime")).toBe(true);
    expect(italics("Bebas Neue")).toBe(false); // none published
  });

  it("registers user fonts by their real family name, weight and italic flag", () => {
    const kalam = catalog.families.find((f) => f.source === "user" && f.family === "Kalam")!;
    expect(kalam.faces).toEqual([
      expect.objectContaining({ weight: 700, style: "normal", files: [expect.objectContaining({ src: "fonts/MyHandwriting-Bold.woff2" })] }),
    ]);
    const courier = catalog.families.find((f) => f.source === "user" && f.family === "Courier Prime")!;
    expect(courier.faces[0].style).toBe("italic");
    // A user font with the same name as a bundled one wins.
    expect(findFamily(catalog, "kalam")!.source).toBe("user");
    expect(catalog.problems).toEqual([expect.stringMatching(/^broken\.ttf:/)]);
  });

  it("picks the nearest weight, upright unless italic is asked for", () => {
    expect(resolveFace(catalog, "Bebas Neue", 900).weight).toBe(400);
    expect(resolveFace(catalog, "Playfair Display", 650).weight).toBe(700);
    expect(resolveFace(catalog, "Playfair Display", 400, "italic").style).toBe("italic");
    expect(() => resolveFace(catalog, "Comic Sans", 400)).toThrow(/pnpm fonts/);
  });

  it("checks French accents (and can tell when a glyph is missing)", () => {
    for (const family of catalog.families.filter((f) => f.source === "bundled")) {
      expect(missingCharacters(family.faces[0]), family.family).toEqual([]);
    }
    expect(missingCharacters(resolveFace(catalog, "Inter", 600), ["é", "漢"])).toEqual(["漢"]);
  });

  it("serves bundled and user font files to the composition", () => {
    const roots = { workspaceDir: ws, fontDirs: catalog.fontDirs };
    for (const ref of [...fontFileRefs(resolveFace(catalog, "Caveat Brush", 400)), ...fontFileRefs(resolveFace(catalog, "Caveat", 400))]) {
      expect(resolveMediaPath(ref.src, roots)).toMatch(/\.woff2$/);
    }
    // "caveat-brush-..." belongs to the Caveat Brush package, not Caveat.
    expect(resolveMediaPath("_fonts/caveat-brush-latin-400-normal.woff2", roots)).toContain("caveat-brush");
    expect(resolveMediaPath("fonts/MyHandwriting-Bold.woff2", roots)).toBe(path.join(ws, "fonts", "MyHandwriting-Bold.woff2"));
    expect(resolveMediaPath("_fonts/../../secret.woff2", roots)).toBeNull();
  });
});
