// The Library banner: songs and collections still in the old layout (projects\<id>\, clips\<name>\).
// GET = the dry run (what would move), POST = the migration (the same as "pnpm songs:migrate --apply").
import { connection } from "next/server";

import { applyMigration, BACKUP_REMINDER, migrationStatus, migrationText, planMigration } from "@lyric/video/migrate";

import { withWorkspace, withWorkspaceAsync } from "@/lib/workspace";

export async function GET() {
  await connection();
  return Response.json(
    withWorkspace((ws) => {
      const plan = planMigration(ws);
      return { status: migrationStatus(ws), lines: migrationText(plan), problems: plan.problems, reminder: BACKUP_REMINDER };
    }),
  );
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { confirmed?: boolean };
  if (!body.confirmed) return Response.json({ error: "Confirm the backup reminder first." }, { status: 400 });
  try {
    const r = await withWorkspaceAsync((ws) => applyMigration(ws));
    return Response.json({ songs: r.songs, collections: r.collections, merges: r.merges, repairs: r.repairs, backupDir: r.backupDir });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
