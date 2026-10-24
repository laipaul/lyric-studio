import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, resolveWorkspaceDir } from "../src";

describe("WORKSPACE_DIR", () => {
  it("defaults to ./workspace in the project root", () => {
    expect(resolveWorkspaceDir("")).toBe(path.join(REPO_ROOT, "workspace"));
    expect(resolveWorkspaceDir("  ")).toBe(path.join(REPO_ROOT, "workspace"));
  });

  it("resolves a relative folder from the project root", () => {
    expect(resolveWorkspaceDir("../media/ws")).toBe(path.resolve(REPO_ROOT, "../media/ws"));
  });

  it("keeps an absolute folder as it is", () => {
    const abs = path.resolve("/somewhere/else/workspace");
    expect(resolveWorkspaceDir(abs)).toBe(abs);
  });
});
