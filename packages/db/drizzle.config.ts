import { defineConfig } from "drizzle-kit";

// Used only by "pnpm --filter @lyric/db generate" to create migration files from schema.ts.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./drizzle",
});
