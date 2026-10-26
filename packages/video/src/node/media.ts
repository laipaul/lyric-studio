// Serves media (songs, clips, fonts) to the composition over HTTP, with Range support so videos can
// seek. Used by the render (a small local server) and by the studio's preview route.
import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { Readable } from "node:stream";


export type MediaRoots = {
  workspaceDir: string;
  // Files outside the workspace (e.g. a song elsewhere on disk), served as "_ext/<name>".
  extraFiles?: Record<string, string>;
  // Folders with the bundled font files, per @fontsource package slug ("inter", "bebas-neue"); see
  // bundledFontDirs() in ./font-catalog (kept separate so the studio can import this file).
  fontDirs?: Record<string, string>;
  // Folders moved since (migration, renamed songs): old manifests still find their files.
  moves?: readonly { from: string; to: string }[];
};

// Where a workspace-relative path is now after moves of files or folders ("projects/<id>/exports" ->
// "songs/<artist>/<title>/exports"), or the path itself. The moves are applied in the order they
// were made; pass only the moves made after the path was written (see movesSince).
export function resolveMoved(moves: readonly { from: string; to: string }[], relative: string): string {
  let current = relative.replace(/\\/g, "/");
  const bare = (p: string) => p.replace(/\/+$/, "");
  for (const m of moves) {
    const from = bare(m.from);
    if (current === from || current.startsWith(`${from}/`)) current = bare(m.to) + current.slice(from.length);
  }
  return current;
}

// The moves made at or after `time` (an ISO date, e.g. a manifest's created_at); all without one.
export function movesSince<T extends { at?: string }>(moves: readonly T[], time?: string | null): T[] {
  return time ? moves.filter((m) => !m.at || m.at >= time) : [...moves];
}

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

// Maps a URL path ("clips/x.mp4", "_fonts/inter-...woff2", "_ext/song.wav") to a file on disk, or
// null if it is not allowed (outside the workspace, unknown font, ...).
export function resolveMediaPath(urlPath: string, roots: MediaRoots): string | null {
  let relative: string;
  try {
    relative = decodeURIComponent(urlPath.split("?")[0]).replace(/\\/g, "/").replace(/^\/+/, "");
  } catch {
    return null;
  }
  if (relative.startsWith("_fonts/")) {
    const file = relative.slice("_fonts/".length);
    if (!/^[a-z0-9-]+\.woff2$/.test(file)) return null;
    // The package whose slug is the longest prefix of the file name ("caveat-brush-..." before "caveat-...").
    const slug = Object.keys(roots.fontDirs ?? {})
      .filter((s) => file.startsWith(`${s}-`))
      .sort((a, b) => b.length - a.length)[0];
    return slug ? path.join(roots.fontDirs![slug], file) : null;
  }
  if (relative.startsWith("_ext/")) {
    return roots.extraFiles?.[relative.slice("_ext/".length)] ?? null;
  }
  if (roots.moves?.length) relative = resolveMoved(roots.moves, relative);
  const root = path.resolve(roots.workspaceDir);
  const full = path.resolve(root, ...relative.split("/"));
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

export type MediaResponse = {
  status: number;
  headers: Record<string, string>;
  stream: Readable | null;
};

export function mediaResponse(file: string | null, rangeHeader: string | null | undefined): MediaResponse {
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    return { status: 404, headers: { "Content-Type": "text/plain" }, stream: null };
  }
  const size = statSync(file).size;
  const headers: Record<string, string> = {
    "Content-Type": CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache",
  };
  const match = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null;
  if (match) {
    let start = match[1] === "" ? NaN : Number(match[1]);
    let end = match[2] === "" ? size - 1 : Number(match[2]);
    if (Number.isNaN(start)) {
      // "bytes=-500": the last 500 bytes
      start = Math.max(0, size - end);
      end = size - 1;
    }
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      return { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` }, stream: null };
    }
    return {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
      stream: createReadStream(file, { start, end }),
    };
  }
  return { status: 200, headers: { ...headers, "Content-Length": String(size) }, stream: createReadStream(file) };
}

export type MediaServer = { url: string; close: () => Promise<void> };

// A local-only server (127.0.0.1, random free port) for the duration of a render.
export function startMediaServer(roots: MediaRoots): Promise<MediaServer> {
  const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Range" });
      res.end();
      return;
    }
    const response = mediaResponse(resolveMediaPath(req.url ?? "/", roots), req.headers.range);
    res.writeHead(response.status, response.headers);
    if (!response.stream || req.method === "HEAD") {
      response.stream?.destroy();
      res.end();
      return;
    }
    response.stream.pipe(res);
    res.on("close", () => response.stream?.destroy());
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
