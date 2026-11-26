// One character or scene card.
// GET (?v=n to view an older, read-only version): the card, its Character sheet (one picture of its views), its current version (or version n), the version in use, the pictures' report, the cost of Make pack, what is missing before Lock, jobs.
// PATCH { outfit?, outfit_split?, props?, description?, model? }: the draft's texts (refused on a locked version). A changed outfit is split per view
//   (close-ups / front / back) with the cheap text model; without a fal key the outfit is still saved and `message` says so.
// POST { action }: "check" (the picture again) · "crop" (crop to face) · "pack" { cap } · "remake" { only, cap } ·
//   "calibrate" { songId, her } (the face-check lines on a song's clips, local and free) ·
//   "fetch" (get missing pictures, free) · "lock" · "new-version" · "stop" { job } ·
//   "own-move" { from, to, look? } (move your own picture to another slot, free) · "describe" (draft the description, about $0.01).
// Clean-up (cleanup.ts, nothing deleted): "aside" { view } (✕: the picture out of the pack, kept) · "aside-restore" { file } ·
//   "reference-restore" { at } (an earlier card picture back) · "remove" (the whole card to _removed; answers { removed }).
// The Wardrobe: "look-add" { name, outfit?, closeup? } · "look-save" { look, name?, outfit?, outfit_split?, model?, closeup? } ·
//   "look-make" { look, cap } · "look-remake" { look, only, cap } (queued, like Make pack) · "look-lock" / "look-unlock" { look }.
// Make pack / Remake / Get missing pictures are queued and run in the studio's process (the Tasks menu shows them).
import path from "node:path";

import { connection } from "next/server";

import { openWorkspace, resolveWorkspaceDir } from "@lyric/db";
import {
  asidePictures, putAsideView, removeCard, restoreReference, restoreView, calibrationSongs, cardFace, draftDescription, hasGeminiKey, moveOwnPicture, GEMINI_KEY_MISSING, addLook, getLook, listLooks, lookDir, lookEstimate, lookProblems, setLookLocked, updateLook, MAIN_LOOK, cardTools, ensureSplit, splitNeeded, cardJobsFor, cardRoot, cardThresholds, checkCardPicture, cropCardToFace, currentVersion, enqueueCardJob, getCard, lockCard, lockProblems,
  MODELS, newVersion, usableVersion, versionByNumber, packEstimate, readCardFile, readReport, repickLegacy, buildSheet, characterSheet, geminiPackPrompt, lookViews, runCardJob, VIEWS, stopCardJob, toolsFor, updateDraft, versionDir, type CardJobKind, type ModelId, characterBlock, setCardNotes,
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
      // The Wardrobe: the main look (the pack above) and the further looks with their pictures, checks and cost.
      wardrobe: listLooks(root, file).map((l) => {
        const look = l.main ? null : getLook(file, l.id);
        return {
          ...l,
          outfit_split: look?.outfit_split ?? null,
          report: look ? readReport(lookDir(root, look.id)) : null,
          estimate: look ? lookEstimate(look) : null,
          problems: look ? lookProblems(root, look) : [],
          geminiMissing: look?.model === "gemini" && !hasGeminiKey() ? GEMINI_KEY_MISSING : null,
          // Copy the Gemini prompt: the look's views as the app would send them (outdoors, natural skin).
          geminiPrompt: row.kind === "character" ? geminiPackPrompt(look ? VIEWS.filter((x) => lookViews(look).includes(x.id)) : VIEWS, look ? look.outfit : v.outfit, look ? look.outfit_split : v.outfit_split) : null,
        };
      }),
      songs: row.kind === "character" ? calibrationSongs(ws) : [],
      // Clean-up: the pictures put aside (✕) in the current version, and the card's earlier pictures (Replace picture).
      aside: latest ? asidePictures(root, file) : [],
      replaced: ((file as { replaced?: { at: string; folder: string; reference: string }[] }).replaced ?? []).map((r) => ({ at: r.at, rel: `${r.folder}/${r.reference}` })).reverse(),
      // Copy the Gemini prompt for Add my pack (plan.ts geminiPackPrompt): the four views, outdoors, natural skin.
      geminiPrompt: row.kind === "character" ? geminiPackPrompt(VIEWS, v.outfit, v.outfit_split) : null,
      // The Character sheet (character-sheet.ts): the views side by side in one picture, file relative to the card.
      characterSheet: (() => {
        if (row.kind !== "character") return null;
        const sh = characterSheet(versionDir(root, v.n));
        return sh ? { file: path.relative(root, sh.file).split(path.sep).join("/"), panels: sh.panels } : null;
      })(),
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
    const body = (await request.json()) as {
      action: string; view?: string; file?: string; at?: string; cap?: number; only?: string[]; job?: string; songId?: string; her?: string[]; from?: string; to?: string;
      look?: string; name?: string; outfit?: string; outfit_split?: { closeups?: string; front?: string; back?: string }; model?: ModelId; closeup?: boolean;
    };
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
      case "aside":
        message = withWorkspace((ws) => putAsideView(ws, id, String(body.view))).summary;
        break;
      case "aside-restore":
        message = withWorkspace((ws) => restoreView(ws, id, String(body.file))).summary;
        break;
      case "reference-restore":
        withWorkspace((ws) => restoreReference(ws, id, String(body.at)));
        try {
          await withWorkspaceAsync((ws) => checkCardPicture(ws, id, cardFace()));
        } catch {
          // the picture is back; "Check again" on the page
        }
        message = "The earlier picture is the card's picture again (the one before it is kept under Earlier pictures).";
        break;
      case "remove":
        return Response.json({ removed: withWorkspace((ws) => removeCard(ws, id)).summary });
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
        message = (await withWorkspaceAsync((ws) => moveOwnPicture(ws, id, cardFace(), String(body.from), String(body.to), body.look ?? null))).summary;
        break;
      case "look-add":
        message = `"${withWorkspace((ws) => addLook(ws, id, { name: String(body.name ?? ""), outfit: body.outfit, closeup: body.closeup })).name}" is in the wardrobe: make it, or add your own pictures.`;
        break;
      case "look-save":
        withWorkspace((ws) => updateLook(ws, id, String(body.look ?? MAIN_LOOK), { name: body.name, outfit: body.outfit, outfit_split: body.outfit_split, model: body.model, closeup: body.closeup }));
        break;
      case "look-make":
      case "look-remake": {
        const kind = body.action === "look-make" ? "pack" : "view";
        const job = withWorkspace((ws) => enqueueCardJob(ws, id, kind, { cap: body.cap, only: body.only, look: String(body.look) }));
        start(job.id, kind);
        break;
      }
      case "look-lock":
      case "look-unlock":
        withWorkspace((ws) => setLookLocked(ws, id, String(body.look), body.action === "look-lock"));
        break;
      // Cast Library (26 Nov 2026): the card's notes, and the block for Claude.
      case "notes":
        withWorkspace((ws) => setCardNotes(ws, id, (body as { notes?: unknown }).notes));
        break;
      case "claude":
        return Response.json(withWorkspace((ws) => characterBlock(ws, id)));
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
