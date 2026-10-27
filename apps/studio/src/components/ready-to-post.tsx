"use client";

import { Download, FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";

import type { PostingPack } from "@lyric/video/captions";
import type { VideoInfo } from "@lyric/video/exports";

import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";

async function openFolder(file: string) {
  await api("/api/open-folder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file }) });
}

// "Ready to post" from a tile in the Videos tab: the post panel in a dialog.
export function ReadyToPost({ projectId, songTitle, video, onClose }: { projectId: string; songTitle: string; video: VideoInfo; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Ready to post: {video.label} {video.name}
          </DialogTitle>
          <DialogDescription>Copy the text, download the files, then post it yourself on {video.label}.</DialogDescription>
        </DialogHeader>
        <PostPanel projectId={projectId} songTitle={songTitle} video={video} />
      </DialogContent>
    </Dialog>
  );
}

// Everything to post one video: caption and hashtags per artist and platform (YouTube: title,
// description, tags from its publish.txt), copy buttons, the files (download), the folder. Nothing is
// posted from here. Mounted per video (key = video id), so it starts empty each time.
export function PostPanel({ projectId, songTitle, video }: { projectId: string; songTitle: string; video: VideoInfo }) {
  const [pack, setPack] = useState<PostingPack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchPack = () =>
    api(`/api/captions?projectId=${projectId}&video=${encodeURIComponent(video.id)}`).then(async (r) => {
      const body = (await r.json()) as PostingPack & { error?: string };
      return !r.ok || body.error ? { error: body.error ?? "Could not read the caption" } : { pack: body };
    });
  const load = async () => {
    const result = await fetchPack();
    if (result.pack) setPack(result.pack);
    else setError(result.error ?? null);
  };
  useEffect(() => {
    let live = true;
    fetchPack().then((result) => {
      if (!live) return;
      if (result.pack) setPack(result.pack);
      else setError(result.error ?? null);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per video (the component is keyed by it)
  }, []);

  const base = `${songTitle} - ${video.label} ${video.name}`;
  const files = [
    { label: "Video", file: video.mp4, name: `${base}.mp4` },
    video.srt ? { label: "Captions (.srt)", file: video.srt, name: `${base}.srt` } : null,
    video.thumbnail ? { label: "Thumbnail", file: video.thumbnail, name: `${songTitle} - thumbnail.jpg` } : null,
    video.publish ? { label: "publish.txt", file: video.publish, name: `${songTitle} - publish.txt` } : null,
  ].filter((f): f is { label: string; file: string; name: string } => !!f);

  const makeOwn = async () => {
    const r = await api("/api/captions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, platform: video.platform }) });
    const body = (await r.json()) as { file?: string; error?: string };
    if (body.file) {
      setNotice(`Made ${body.file}: edit it (e.g. in French); the captions here use it from now on.`);
      await load();
    } else setError(body.error ?? "Could not make the template");
  };

  return (
    <div className="flex flex-col gap-4" data-post-panel={video.id}>
        {error ? <p className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}
        {pack?.kind === "none" ? <p className="text-muted-foreground text-sm">A Spotify Canvas is uploaded in Spotify for Artists without a caption.</p> : null}
        {pack && pack.kind !== "none"
          ? Object.entries(pack.sections).map(([name, text]) => (
              <section key={name} className="flex flex-col gap-1.5" data-section={name}>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">{name}</h3>
                  <CopyButton text={text} label={`Copy ${name.toLowerCase()}`} />
                </div>
                <pre className="bg-muted max-h-48 overflow-y-auto rounded-md p-3 text-xs whitespace-pre-wrap">{text || "—"}</pre>
              </section>
            ))
          : null}
        {pack?.template ? (
          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
            <span>
              Text from <code>{pack.template.relative}</code>
            </span>
            <Button size="sm" variant="ghost" onClick={() => openFolder(pack.template!.relative)}>
              <FolderOpen /> Open
            </Button>
            {!pack.template.own && pack.kind === "caption" ? (
              <Button size="sm" variant="ghost" onClick={makeOwn}>
                Make {pack.artist}&apos;s own template
              </Button>
            ) : null}
          </div>
        ) : null}
        {notice ? <p className="border-brand/30 bg-brand/10 rounded-md border p-2 text-xs">{notice}</p> : null}
        <div className="flex flex-wrap gap-2 border-t pt-4">
          {files.map((f) => (
            <Button key={f.file} size="sm" variant="secondary" asChild>
              <a href={`/api/files/${f.file}?download=${encodeURIComponent(f.name)}`} download={f.name}>
                <Download /> {f.label}
              </a>
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => openFolder(video.mp4)}>
            <FolderOpen /> Open folder
          </Button>
        </div>
    </div>
  );
}
