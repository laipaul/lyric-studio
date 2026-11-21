// One character or scene card.
// GET (?v=n to view an older, read-only version): the card, its current version (or version n), the version in use, the pictures' report, the cost of Make pack, what is missing before Lock, jobs.
// PATCH { outfit?, outfit_split?, props?, description?, model? }: the draft's texts (refused on a locked version). A changed outfit is split per view
//   (close-ups / front / back) with the cheap text model; without a fal key the outfit is still saved and `message` says so.
// POST { action }: "check" (the picture again) · "crop" (crop to face) · "pack" { cap } · "remake" { only, cap } ·
//   "calibrate" { songId, her } (the face-check lines on a song's clips, local and free) ·
//   "fetch" (get missing pictures, free) · "lock" · "new-version" · "stop" { job } ·
//   "own-move" { from, to } (move your own picture to another slot, free) · "describe" (draft the description, about $0.01).
// Make pack / Remake / Get missing pictures are queued and run in the studio's process (the Tasks menu shows them).
import { connection } from "next/server";

import { openWorkspace, resolveWorkspaceDir } from "@lyric/db";
import {
  calibrationSongs, cardFace, draftDescription, hasGeminiKey, moveOwnPicture, GEMINI_KEY_MISSING, cardTools, ensureSplit, splitNeeded, cardJobsFor, cardRoot, cardThresholds, checkCardPicture, cropCardToFace, currentVersion, enqueueCardJob, getCard, lockCard, lockProblems,
  MODELS, newVersion, usableVersion, versionByNumber, packEstimate, readCardFile, readReport, repickLegacy, buildSheet, runCardJob, stopCardJob, toolsFor, updateDraft, versionDir, type CardJobKind, type ModelId,
} from "@lyric/video/characters";

import { withWorkspace, withWorkspaceAsync } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };
const fail = (error: unknown) => Response.json({ error: (error as Error).message }, { status: 400 });

function detail(id: string, message: string | null = null, n: number | null = null) {
  return withWorkspace((ws) => {
    const row = getCard(ws, id);
    const root = cardRoot(ws, row);
    const file = readCardFile(root);
    const current = currentVersion(file);
    const v = versionByNumber(file, n);
    const latest = v.n === current.n;
    // A draft made before "the latest run wins" is picked again once (free); the contact sheet is rebuilt in the background.
    const busy = cardJobsFor(ws, id).some((j) => j.status === "queued" || j.status === "running");
    if (latest && row.kind === "character" && !busy && repickLegacy(root, file)) {
      const report = readReport(versionDir(root, v.n));
      if (report) void buildSheet(cardFace(), root, file, report).catch(() => undefined);
    }
    return {
      message,
      card: row,
      file,
      version: v,
      // The version scenes, stills and recasts use (the latest locked one), and the newest version (a draft, maybe).
      inUse: usableVersion(file)?.n ?? null,
      latest: current.n,
      report: readReport(versionDir(root, v.n)),
      estimate: packEstimate(file),
      lockProblems: latest && v.status === "draft" ? lockProblems(root, file) : [],
      thresholds: cardThresholds(root),
      jobs: cardJobsFor(ws, id),
      models: Object.values(MODELS).map((m) => ({ id: m.id, name: m.name, price: m.priceNote })),
      // The "gemini" model runs on the user's own key: without it, the plain note and no Make pack.
      geminiMissing: v.model === "gemini" && !hasGeminiKey() ? GEMINI_KEY_MISSING : null,
      songs: row.kind === "character" ? calibrationSongs(ws) : [],
    };
  });
}
export type CardDetail = ReturnType<typeof detail>;

export async function GET(request: Request, { params }: Params) {
  await connection();
  try {
    const { id } = await params;
    const v = Number(new URL(request.url).searchParams.get("v"));
    return Response.json(detail(id, null, Number.isInteger(v) && v > 0 ? v : null), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = (await request.json()) as { outfit?: string; outfit_split?: { closeups?: string; front?: string; back?: string }; props?: string; description?: string; model?: ModelId };
    withWorkspace((ws) => updateDraft(ws, id, body));
    let message: string | null = null;
    if (body.outfit !== undefined) {
      const needed = withWorkspace((ws) => {
        const v = currentVersion(readCardFile(cardRoot(ws, getCard(ws, id))));
        return splitNeeded(v.outfit, v.outfit_split);
      });
      if (needed) {
        const tools = cardTools();
        message = (await withWorkspaceAsync((ws) => ensureSplit(ws, id, "error" in tools ? null : tools.fal))).message;
      }
    }
    return Response.json(detail(id, message));
  } catch (error) {
    return fail(error);
  }
}

// A queued job runs right away in this process; the request does not wait for it.
function start(jobId: string, kind: CardJobKind) {
  void runCardJob(() => openWorkspace(resolveWorkspaceDir()), jobId, toolsFor(kind));
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = (await request.json()) as { action: string; cap?: number; only?: string[]; job?: string; songId?: string; her?: string[]; from?: string; to?: string };
    let message: string | null = null;
    switch (body.action) {
      case "check":
        await withWorkspaceAsync((ws) => checkCardPicture(ws, id, cardFace()));
        break;
      case "crop":
        await withWorkspaceAsync((ws) => cropCardToFace(ws, id, cardFace()));
        break;
      case "pack":
      case "remake":
      case "fetch": {
        const kind = body.action === "pack" ? "pack" : body.action === "remake" ? "view" : "fetch";
        const job = withWorkspace((ws) => enqueueCardJob(ws, id, kind, { cap: body.cap, only: body.only }));
        start(job.id, kind);
        break;
      }
      case "calibrate": {
        const job = withWorkspace((ws) => enqueueCardJob(ws, id, "calibrate", { songId: body.songId, her: (body.her ?? []).filter((h) => h.trim()) }));
        start(job.id, "calibrate");
        break;
      }
      case "lock":
        withWorkspace((ws) => lockCard(ws, id));
        break;
      case "new-version":
        withWorkspace((ws) => newVersion(ws, id));
        break;
      case "stop":
        withWorkspace((ws) => stopCardJob(ws, String(body.job)));
        break;
      case "own-move":
        message = (await withWorkspaceAsync((ws) => moveOwnPicture(ws, id, cardFace(), String(body.from), String(body.to)))).summary;
        break;
      case "describe": {
        const tools = cardTools();
        if ("error" in tools) throw new Error(tools.error);
        const r = await withWorkspaceAsync((ws) => draftDescription(ws, id, tools.fal));
        message = `Description drafted from your pictures (about $${r.usd.toFixed(2)}): read it and change anything that is not right.`;
        break;
      }
      default:
        throw new Error(`Unknown action "${body.action}".`);
    }
    return Response.json(detail(id, message));
  } catch (error) {
    return fail(error);
  }
}
