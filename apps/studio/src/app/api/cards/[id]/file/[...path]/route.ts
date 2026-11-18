// A picture of a card (its reference, a view, the sheet), only from inside the card's own folder.
import { readFileSync, statSync } from "node:fs";

import { cardFilePath, cardRoot, getCard } from "@lyric/video/characters";

import { withWorkspace } from "@/lib/workspace";

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; path: string[] }> }) {
  const { id, path } = await params;
  const file = withWorkspace((ws) => {
    try {
      return cardFilePath(cardRoot(ws, getCard(ws, id)), path.map(decodeURIComponent).join("/"));
    } catch {
      return null;
    }
  });
  const type = file ? TYPES[file.split(".").pop()!.toLowerCase()] : undefined;
  if (!file || !type) return new Response("Not found", { status: 404 });
  return new Response(readFileSync(file), { headers: { "Content-Type": type, "Cache-Control": "no-cache", ETag: String(statSync(file).mtimeMs) } });
}
