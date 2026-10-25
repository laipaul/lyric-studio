// Server-side access to the workspace (studio.db and the project folders), the same as "pnpm make".
import { openWorkspace, resolveWorkspaceDir, type Workspace } from "@lyric/db";

export function withWorkspace<T>(work: (ws: Workspace) => T): T {
  const ws = openWorkspace(resolveWorkspaceDir());
  try {
    return work(ws);
  } finally {
    ws.close();
  }
}

export async function withWorkspaceAsync<T>(work: (ws: Workspace) => Promise<T>): Promise<T> {
  const ws = openWorkspace(resolveWorkspaceDir());
  try {
    return await work(ws);
  } finally {
    ws.close();
  }
}
