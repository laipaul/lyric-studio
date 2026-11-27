// Prepare → Creation (G2): the song's creation space: pictures and videos from anywhere, and the takes animated here.
// POST { action: "cleanup", file, n? }: put aside the takes not chosen or failed (or take n); { action: "restore", file, n }.
// GET: the pictures with their takes, the services (ready = a key in .env), prices, defaults, what was spent.
// POST multipart (pictures=<files>): adds pictures and videos under their own names; { action: "link", url }: adds the
//   picture or video a link leads to (any outside source).
// POST JSON { action: "animate", file, service, quality, takes, cap }: checks the cost against the cap, records the
//   takes and starts them (the request does not wait); { action: "mood", file, mood }; { action: "who", file, who: <card id> | null } (picture-character.ts: Animate then keeps that character's face); { action: "feeling", file, feeling } (feelings.ts; "" = its section's); { action: "resume", file, n }:
//   fetches a take that was sent but did not come back (free); { action: "send", file, n?, forLine? }: Send to Storyboard (the
//   picture, or its take n): a copy joins the end of the song's clips (forLine: true, from Lyrics Sync: only for a line, not a story moment); { action: "defaults", defaults }: Paul's own
//   defaults for every song (service, quality, takes, cap: workspace\creation.json).
// Production (C3 Part 1): GET also returns "production" (the shot list's items, shot-production.ts); multipart with
//   slot=<id>: the added pictures belong to that shot; { action: "shot", file, slot }: a picture belongs to a shot
//   (slot null: to none); { action: "use-shot", file, n?, slot }: Use this take for that shot (its place and its line).
// { action: "final", file, n }: Make final: draft take n upscaled to 1080p (final.ts), a new take right after it.
// Music video made elsewhere (music-video.ts, 27 Nov 2026): { action: "mv-make", pictures, section, aspect, resolution,
//   words, cap }: Make a music video on WaveSpeed (cost first, under the cap; the video comes back into Creation, found in
//   the song); { action: "mv-final", file, cap }: the shots on their lines made 1080p (Make final); { action: "mv-check", file }: "This is a music video of this
//   song" (its place in the song, its shots); { action: "mv-use", file, shot }: that shot on its lines, in time (or to the
//   Storyboard when it carries no sung line; a hand pick the app never replaces); { action: "mv-use-all", file }: every shot that carries sung lines.
// { action: "mv-use-slot", file, shot, slot }: Production's "Use for this shot". Best shot for each line across music
// videos (mv-best.ts; the plan: GET /api/songs/[id]/mv-shots, shown in Lyrics Sync); { action: "mv-best" }: every
//   singing shot cut out and face-checked (local, free), the best of each line placed; { action: "mv-best-pick", file,
//   shot }: that shot on its lines instead (a hand pick).
// { action: "remove-picture", file }: Put aside (to pictures\_removed\, Restore); { action: "restore-picture", file }.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { openWorkspace, project as projectTable, resolveWorkspaceDir } from "@lyric/db";
import { characterChoices, setPictureWho, startPictureAnimate } from "@lyric/video/picture-character";
import { REFERENCE_MODEL } from "@lyric/video/animate";
import { addFromLink, addPictures, picturesView, removePicture, removeTakes, restorePicture, restoreTake, setFavourite, setItemLabel, runTakes, saveCreationDefaults, sendToStoryboard, setMood, setPictureFeeling, startResume, type Quality, type ServiceId } from "@lyric/video/animate";
import { finalUsd, runFinal, startFinal } from "@lyric/video/final";
import { runSinging, withSongStarts } from "@lyric/video/singer";
import { useBestShots } from "@lyric/video/mv-best";
import { analyseMusicVideo, checkMusicVideoShots, musicVideoOptions, runMusicVideo, startMusicVideo, startMusicVideoFinals, useAllMusicVideoShots, useMusicVideoShot, useMusicVideoShotForSlot, withMusicVideos } from "@lyric/video/music-video";
import { placeByName, placeDropped, productionView, setPictureShot, useForShot, withLineStarts } from "@lyric/video/shot-production";
import { timedLines } from "@lyric/video/production";
import { referencePreview, startShotReferences } from "@lyric/video/shot-references";
import { shotDirection } from "@lyric/video/persona-node";
import { eq } from "drizzle-orm";
import { setShotLook, setShotScene } from "@lyric/video/shotlist";
import { connection } from "next/server";

import { withWorkspace, withWorkspaceAsync } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };
const fail = (error: unknown) => Response.json({ error: (error as Error).message }, { status: 400 });
const open = () => openWorkspace(resolveWorkspaceDir());
const safeName = (n: string) => path.basename(n).replace(/[^\w.\- ()]/g, "_");

export async function GET(_request: Request, { params }: Params) {
  await connection();
  const { id } = await params;
  try {
    // Each finished take with the song second its first frame belongs to (Creation plays it with the song).
    return Response.json(
      await withWorkspaceAsync(async (ws) => {
        const board = await withMusicVideos(ws, id, await withSongStarts(ws, id, await picturesView(ws, id)));
        let production = null;
        try {
          production = productionView(ws, id);
          const duration = ws.db.select().from(projectTable).where(eq(projectTable.id, id)).get()?.duration_ms ?? null;
          if (production.shots.some((s) => s.line !== null)) production = withLineStarts(production, await timedLines(ws, id).catch(() => null), duration);
        } catch {
          // a song without a folder yet: no shot list
        }
        const mvMake = await musicVideoOptions(ws, id).catch(() => null); // Make a music video (music-video.ts)
        return { board: { ...board, characters: characterChoices(ws), faceUsdPerSecond: REFERENCE_MODEL.usdPerSecond, mvMake }, production }; // characters: "Who is this" (picture-character.ts)
      }),
    );
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  try {
    if ((request.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const form = await request.formData();
      const files = form.getAll("pictures").filter((v): v is File => v instanceof File && v.size > 0);
      if (!files.length) throw new Error("Drop one or more pictures or videos.");
      const tmp = path.join(resolveWorkspaceDir(), "cache", "uploads", randomUUID());
      mkdirSync(tmp, { recursive: true });
      try {
        const saved = await Promise.all(
          files.map(async (f, n) => {
            const file = path.join(tmp, `${n}-${safeName(f.name)}`);
            writeFileSync(file, Buffer.from(await f.arrayBuffer()));
            return { file, name: f.name };
          }),
        );
        const slot = form.get("slot");
        return Response.json(
          await withWorkspaceAsync(async (ws) => {
            const r = await addPictures(ws, id, saved);
            // Dropped on a shot: they belong to it. Dropped anywhere else: a file named after its shot goes to that shot.
            if (typeof slot === "string" && slot) {
              return placeDropped(ws, id, r, slot); // 25 Nov 2026: a picture already in Creation is linked too
            }
            let placed: Record<string, number> = {};
            try {
              placed = placeByName(ws, id, r.added);
            } catch {
              // a song without a folder yet: nothing to place
            }
            return { ...r, placed };
          }),
        );
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    }
    const body = (await request.json().catch(() => ({}))) as { action?: unknown; file?: unknown; service?: unknown; quality?: unknown; takes?: unknown; cap?: unknown; mood?: unknown; feeling?: unknown; n?: unknown; slot?: unknown; shape?: unknown; seconds?: unknown };
    const file = String(body.file ?? "");
    if (body.action === "link") return Response.json(await withWorkspaceAsync((ws) => addFromLink(ws, id, (body as { url?: unknown }).url)));
    if (body.action === "label") {
      const n = body.n === undefined || body.n === null ? null : Number(body.n);
      return Response.json({ label: withWorkspace((ws) => setItemLabel(ws, id, file, n, (body as { label?: unknown }).label)) });
    }
    if (body.action === "fav") {
      const n = body.n === undefined || body.n === null ? null : Number(body.n);
      return Response.json({ fav: withWorkspace((ws) => setFavourite(ws, id, file, n, (body as { on?: unknown }).on)) });
    }
    if (body.action === "who") return Response.json({ who: withWorkspace((ws) => setPictureWho(ws, id, file, (body as { who?: unknown }).who)) });
    if (body.action === "feeling") return Response.json({ feeling: withWorkspace((ws) => setPictureFeeling(ws, id, file, body.feeling)) });
    if (body.action === "mood") return Response.json({ mood: withWorkspace((ws) => setMood(ws, id, file, body.mood)) });
    // Make with references (24 Nov 2026): the shot with its people's and place's pictures, Seedance reference-to-video.
    // With the acting direction (Persona + performance script, 26 Nov 2026) unless "acting": false (one take without, to compare).
    if (body.action === "references") {
      const acting = (body as { acting?: unknown }).acting !== false;
      const direction = acting ? (await withWorkspaceAsync((ws) => shotDirection(ws, id, String(body.slot ?? "")))).text : "";
      const started = withWorkspace((ws) => startShotReferences(ws, id, { slot: body.slot, shape: body.shape, seconds: body.seconds, guide: (body as { guide?: unknown }).guide, direction }));
      void runTakes(open, id, started.file, started.takes.map((t) => t.n));
      return Response.json(started);
    }
    // What Make with references would send (nothing is sent): the shot card's "Show the prompt sent".
    if (body.action === "references-preview") {
      const b = body as { acting?: unknown; guide?: unknown };
      const d = b.acting !== false ? await withWorkspaceAsync((ws) => shotDirection(ws, id, String(body.slot ?? ""))) : { text: "", source: "none" as const, stale: null };
      const preview = withWorkspace((ws) => referencePreview(ws, id, String(body.slot ?? ""), { guide: !!b.guide, direction: d.text }));
      return Response.json({ ...preview, source: d.source, stale: d.stale });
    }
    if (body.action === "animate") {
      const started = withWorkspace((ws) => startPictureAnimate(ws, id, file, { service: body.service as ServiceId, quality: body.quality as Quality, takes: Number(body.takes), capUsd: Number(body.cap) }));
      void runTakes(open, id, path.basename(file), started.takes.map((t) => t.n));
      return Response.json(started);
    }
    if (body.action === "final") {
      const take = withWorkspace((ws) => startFinal(ws, id, file, body.n));
      void runFinal(open, id, path.basename(file), take.n);
      return Response.json({ take });
    }
    if (body.action === "defaults") return Response.json({ defaults: saveCreationDefaults(resolveWorkspaceDir(), (body as { defaults?: unknown }).defaults) });
    // Clean up (no n: every take not chosen or failed) or Remove one take (n): put aside with Restore, never deleted.
    if (body.action === "cleanup") {
      const n = (body as { n?: unknown }).n;
      return Response.json(withWorkspace((ws) => removeTakes(ws, id, file, n === undefined || n === null ? null : [Number(n)])));
    }
    if (body.action === "restore") return Response.json(withWorkspace((ws) => restoreTake(ws, id, file, (body as { n?: unknown }).n)));
    if (body.action === "send") {
      const n = body.n === undefined || body.n === null ? null : Number(body.n);
      return Response.json(await withWorkspaceAsync((ws) => sendToStoryboard(ws, id, file, n, { forLine: (body as { forLine?: unknown }).forLine === true })));
    }
    if (body.action === "mv-make") {
      const b = body as { pictures?: unknown; section?: unknown; aspect?: unknown; resolution?: unknown; words?: unknown };
      const started = await withWorkspaceAsync((ws) => startMusicVideo(ws, id, { ...b, cap: body.cap }));
      void runMusicVideo(open, id, started.file, started.take.n);
      return Response.json(started);
    }
    // The shots on their lines made 1080p (Make final on each, cost first, under the cap).
    if (body.action === "mv-final") {
      const r = withWorkspace((ws) => startMusicVideoFinals(ws, id, file, body.cap, (n) => startFinal(ws, id, file, n), finalUsd));
      for (const t of r.takes) void runFinal(open, id, path.basename(file), t.n);
      return Response.json({ shots: r.takes.length, usd: r.usd });
    }
    if (body.action === "mv-check") return Response.json({ mv: await withWorkspaceAsync((ws) => analyseMusicVideo(ws, id, file)) });
    if (body.action === "mv-use" || body.action === "mv-use-all") {
      const used = await withWorkspaceAsync(async (ws) => (body.action === "mv-use" ? [await useMusicVideoShot(ws, id, file, (body as { shot?: unknown }).shot, { hand: true })] : (await useAllMusicVideoShots(ws, id, file)).used));
      void checkMusicVideoShots(open, id, path.basename(file)); // the face check of each singing shot (local, free), after the answer
      return Response.json({ used });
    }
    if (body.action === "mv-best") return Response.json(await withWorkspaceAsync((ws) => useBestShots(ws, id)));
    // Production, "Use for this shot": a music-video shot fills a planned shot (a singing one stays on its lines, in time).
    if (body.action === "mv-use-slot") {
      const b = body as { shot?: unknown; slot?: unknown };
      const used = await withWorkspaceAsync((ws) => useMusicVideoShotForSlot(ws, id, file, b.shot, b.slot));
      void checkMusicVideoShots(open, id, path.basename(file));
      return Response.json({ used });
    }
    if (body.action === "mv-best-pick") {
      const used = await withWorkspaceAsync((ws) => useMusicVideoShot(ws, id, file, (body as { shot?: unknown }).shot, { hand: true }));
      void checkMusicVideoShots(open, id, path.basename(file));
      return Response.json({ used });
    }
    if (body.action === "remove-picture") return Response.json(withWorkspace((ws) => removePicture(ws, id, file)));
    if (body.action === "restore-picture") return Response.json(withWorkspace((ws) => restorePicture(ws, id, file)));
    if (body.action === "shot-scene") {
      const b = body as { slots?: unknown; scene?: unknown };
      return Response.json({ changed: withWorkspace((ws) => setShotScene(ws, id, b.slots, b.scene)) });
    }
    if (body.action === "shot-look") {
      const b = body as { slot?: unknown; character?: unknown; look?: unknown };
      return Response.json({ slot: withWorkspace((ws) => setShotLook(ws, id, b.slot, b.character, b.look)) });
    }
    if (body.action === "shot") return Response.json({ slot: withWorkspace((ws) => setPictureShot(ws, id, file, (body as { slot?: unknown }).slot)) });
    if (body.action === "use-shot") return Response.json(await withWorkspaceAsync((ws) => useForShot(ws, id, { file, n: body.n, slot: (body as { slot?: unknown }).slot })));
    if (body.action === "resume") {
      const n = Number(body.n);
      const take = withWorkspace((ws) => startResume(ws, id, file, n));
      if (take.finalOf) void runFinal(open, id, path.basename(file), take.n);
      else if (take.kind === "musicvideo") void runMusicVideo(open, id, path.basename(file), take.n);
      else if (take.kind === "lipsync") void runSinging(open, id, [{ source: path.basename(file), n: take.n }]);
      else void runTakes(open, id, path.basename(file), [take.n]);
      return Response.json({ take });
    }
    throw new Error("Unknown action.");
  } catch (error) {
    return fail(error);
  }
}
