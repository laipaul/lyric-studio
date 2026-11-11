// Post panel downloads (11 Nov 2026): "Save as" with the browser's File System Access API (Chrome / Edge), opening in
// the last folder used for this song and platform; "Save all to…" writes every file of a post into one folder. The
// folders are remembered in this browser (IndexedDB: the browser's folder handles, never paths), per song and
// platform, per song, and the last parent folder for the next song. Without the API (another browser): a normal
// download, as before. Files are streamed from /api/files, so a long video never sits in memory.

type Handle = { kind: "file" | "directory"; name: string };
type Writable = WritableStream<Uint8Array> & { close?: () => Promise<void> };
type FileHandle = Handle & { createWritable: () => Promise<Writable> };
type DirHandle = Handle & {
  getDirectoryHandle: (name: string, o?: { create?: boolean }) => Promise<DirHandle>;
  getFileHandle: (name: string, o?: { create?: boolean }) => Promise<FileHandle>;
  requestPermission?: (o: { mode: "readwrite" }) => Promise<string>;
};
type StartIn = Handle | "downloads" | "documents" | "videos";
type Pickers = {
  showSaveFilePicker?: (o: { suggestedName: string; startIn?: StartIn; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileHandle>;
  showDirectoryPicker?: (o: { mode: "readwrite"; startIn?: StartIn }) => Promise<DirHandle>;
};
const pickers = () => (typeof window === "undefined" ? {} : (window as unknown as Pickers));
export const canPickFile = () => typeof pickers().showSaveFilePicker === "function";
export const canPickFolder = () => typeof pickers().showDirectoryPicker === "function";

// ---- the remembered folders (IndexedDB; any failure: nothing remembered) ----
const DB = "lyric-studio-save";
const STORE = "handles";
function db(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}
async function remembered(key: string): Promise<Handle | null> {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const req = d.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as Handle | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}
async function remember(key: string, handle: Handle): Promise<void> {
  const d = await db();
  if (!d) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = d.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(handle, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
const KEY = { file: (song: string, platform: string) => `file:${song}:${platform}`, folder: (song: string) => `folder:${song}`, parent: "parent" };

// Where a picker opens: the first remembered folder (a file handle opens in its folder), else Downloads.
async function startIn(keys: string[]): Promise<StartIn> {
  for (const k of keys) {
    const h = await remembered(k);
    if (h) return h;
  }
  return "downloads";
}

const isCancel = (e: unknown) => (e as { name?: string })?.name === "AbortError";
const fileUrl = (file: string) => `/api/files/${file}`;
async function writeTo(handle: FileHandle, file: string): Promise<void> {
  const r = await fetch(fileUrl(file));
  if (!r.ok || !r.body) throw new Error(`Could not read ${file} (${r.status})`);
  await r.body.pipeTo(await handle.createWritable()); // closes the file when done
}
// The normal download (no picker): the browser's Downloads folder, under this name.
export function plainDownload(file: string, name: string): void {
  const a = document.createElement("a");
  a.href = `${fileUrl(file)}?download=${encodeURIComponent(name)}`;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export type PostFile = { label: string; file: string; name: string };
const TYPES: Record<string, { description: string; accept: Record<string, string[]> }> = {
  mp4: { description: "Video", accept: { "video/mp4": [".mp4"] } },
  srt: { description: "Captions", accept: { "text/plain": [".srt"] } },
  jpg: { description: "Picture", accept: { "image/jpeg": [".jpg"] } },
  txt: { description: "Text", accept: { "text/plain": [".txt"] } },
};

// One file: the "Save as" picker in the last folder used for this song and platform (else this song's, else the
// last parent folder, else Downloads); a picker opened again after a cancel is not needed.
export async function saveOne(f: PostFile, where: { song: string; platform: string }): Promise<"saved" | "cancelled" | "downloaded"> {
  const pick = pickers().showSaveFilePicker;
  if (!pick) {
    plainDownload(f.file, f.name);
    return "downloaded";
  }
  const ext = f.name.split(".").pop() ?? "";
  const options = { suggestedName: f.name, ...(TYPES[ext] ? { types: [TYPES[ext]] } : {}) };
  let handle: FileHandle;
  try {
    handle = await pick({ ...options, startIn: await startIn([KEY.file(where.song, where.platform), KEY.folder(where.song), KEY.parent]) });
  } catch (e) {
    if (isCancel(e)) return "cancelled";
    handle = await pick({ ...options, startIn: "downloads" }).catch((e2) => {
      if (isCancel(e2)) return null as unknown as FileHandle;
      throw e2;
    }); // a remembered folder that is gone: Downloads
    if (!handle) return "cancelled";
  }
  await writeTo(handle, f.file);
  await remember(KEY.file(where.song, where.platform), handle);
  return "saved";
}

// "Save all to…": every file of the post into one folder. subfolder: the folder picked is the parent; the files go
// into a folder named after the song in it (made if needed), and the next song's picker opens in that parent.
export async function saveAll(files: PostFile[], where: { song: string; songTitle: string; subfolder: boolean }): Promise<{ folder: string; count: number } | "cancelled" | "downloaded"> {
  const pick = pickers().showDirectoryPicker;
  if (!pick) {
    for (const f of files) plainDownload(f.file, f.name);
    return "downloaded";
  }
  let dir: DirHandle;
  try {
    dir = await pick({ mode: "readwrite", startIn: await startIn(where.subfolder ? [KEY.parent, KEY.folder(where.song)] : [KEY.folder(where.song), KEY.parent]) });
  } catch (e) {
    if (isCancel(e)) return "cancelled";
    try {
      dir = await pick({ mode: "readwrite", startIn: "downloads" });
    } catch (e2) {
      if (isCancel(e2)) return "cancelled";
      throw e2;
    }
  }
  const target = where.subfolder ? await dir.getDirectoryHandle(folderName(where.songTitle), { create: true }) : dir;
  for (const f of files) await writeTo(await target.getFileHandle(f.name, { create: true }), f.file);
  if (where.subfolder) await remember(KEY.parent, dir);
  await remember(KEY.folder(where.song), target);
  return { folder: where.subfolder ? `${dir.name}\\${target.name}` : target.name, count: files.length };
}

// A file or folder name Windows accepts (no \ / : * ? " < > |, no trailing dot or space).
export function folderName(title: string): string {
  return title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "") || "Song";
}
