import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 300_000,
    // No Python for the vocal-start guard in the tests (they pass a voice map where they test it).
    env: { LYRIC_VOICE_MAP: "off" },
  },
});
