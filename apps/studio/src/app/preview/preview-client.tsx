"use client";

import { LyricVideo, VIDEO, composeProps, type LyricVideoProps, type RenderBase, type StyleChoice } from "@lyric/video";
import { Player } from "@remotion/player";
import { Shuffle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Data = {
  base: RenderBase;
  defaultSeed: number;
  report: {
    song: string;
    bpm: number;
    downbeatConfidence: number;
    requestedSection: { start_ms: number; end_ms: number };
    section: { start_ms: number; end_ms: number };
    cuts: number;
    clipCount: number;
    lyricLines: number;
  };
};

const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${((ms % 60_000) / 1000).toFixed(3).padStart(6, "0")}`;

export function PreviewClient() {
  const searchParams = useSearchParams();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seed, setSeed] = useState<number | null>(null);
  const [style, setStyle] = useState<StyleChoice>("simple");
  const [safeGuides, setSafeGuides] = useState(searchParams.has("safe-guides"));
  const [reloading, setReloading] = useState(false);

  const fetchData = (refresh: boolean) =>
    fetch(`/api/preview-data${refresh ? "?refresh=1" : ""}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setData(d);
        setError(null);
        setSeed((s) => s ?? d.defaultSeed);
      })
      .catch((e: Error) => setError(e.message));

  const reload = () => {
    setReloading(true);
    fetchData(true).finally(() => setReloading(false));
  };
  useEffect(() => {
    fetchData(false);
  }, []);

  // Same function as "pnpm render:test": identical props for the same seed and style.
  const props: LyricVideoProps | null = useMemo(
    () =>
      data && seed !== null
        ? { ...composeProps(data.base, { seed, style }), mediaBaseUrl: "/api/media", showSafeGuides: safeGuides }
        : null,
    [data, seed, style, safeGuides],
  );

  if (error) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-8">
        <h1 className="text-2xl font-semibold">Preview</h1>
        <pre className="bg-muted rounded-lg p-4 text-sm whitespace-pre-wrap">{error}</pre>
        <p className="text-muted-foreground text-sm">
          The preview uses the same files as <code>pnpm render:test</code>: workspace\test\song.wav (or .mp3),
          workspace\test\clips\ and workspace\test\lyrics.lrc.
        </p>
        <Button onClick={reload} disabled={reloading}>
          Try again
        </Button>
      </div>
    );
  }
  if (!data || !props || seed === null) {
    return <p className="text-muted-foreground p-8 text-sm">Preparing the preview (analysing the song and clips)…</p>;
  }

  const snapped = data.report.section.start_ms !== data.report.requestedSection.start_ms;
  return (
    <div className="flex min-h-0 flex-1 gap-8 p-6">
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div className="aspect-[9/16] h-full max-h-[820px] overflow-hidden rounded-[2rem] border-[6px] border-neutral-800 bg-black shadow-2xl">
          <Player
            component={LyricVideo}
            inputProps={props}
            durationInFrames={props.durationInFrames}
            compositionWidth={VIDEO.width}
            compositionHeight={VIDEO.height}
            fps={VIDEO.fps}
            controls
            style={{ width: "100%", height: "100%" }}
          />
        </div>
      </div>

      <aside className="flex w-80 shrink-0 flex-col gap-6 text-sm">
        <div>
          <h1 className="text-xl font-semibold">Preview</h1>
          <p className="text-muted-foreground">Same composition and props as the export.</p>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-muted-foreground text-xs font-medium uppercase">Clips</span>
          <div className="flex items-center gap-3">
            <Button onClick={() => setSeed(Math.floor(Math.random() * 1_000_000))}>
              <Shuffle />
              Shuffle
            </Button>
            <span className="font-mono">seed {seed}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-muted-foreground text-xs font-medium uppercase">Text style</span>
          <div className="bg-muted inline-flex w-fit rounded-lg p-1">
            {(["simple", "bold"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStyle(s)}
                className={cn(
                  "rounded-md px-4 py-1.5 font-medium capitalize",
                  style === s ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2">
          <input type="checkbox" checked={safeGuides} onChange={(e) => setSafeGuides(e.target.checked)} />
          Show safe-zone guides (preview only)
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs font-medium uppercase">Export exactly this</span>
          <code className="bg-muted rounded-md p-2 text-xs break-all">
            pnpm render:test --seed {seed} --style {style}
          </code>
        </div>

        <dl className="text-muted-foreground grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt>Song</dt>
          <dd className="break-all">{data.report.song}</dd>
          <dt>BPM</dt>
          <dd>{data.report.bpm}</dd>
          <dt>Section</dt>
          <dd>
            {clock(data.report.section.start_ms)} – {clock(data.report.section.end_ms)}
            {snapped ? ` (start snapped from ${clock(data.report.requestedSection.start_ms)})` : ""}
          </dd>
          <dt>Cuts</dt>
          <dd>{data.report.cuts}</dd>
          <dt>Clips</dt>
          <dd>{data.report.clipCount}</dd>
          <dt>Lyrics</dt>
          <dd>{data.report.lyricLines} lines</dd>
        </dl>

        <Button variant="outline" onClick={reload} disabled={reloading} className="w-fit">
          {reloading ? "Reloading…" : "Reload files"}
        </Button>
      </aside>
    </div>
  );
}
