"use client";

import {
  DEFAULT_LEAD_MS,
  LyricVideo,
  VIDEO,
  composeProps,
  type ClipOrder,
  type LyricVideoProps,
  type LyricEffectsProps,
  type RenderBase,
  type StyleChoice,
} from "@lyric/video";
import { Player } from "@remotion/player";
import { Shuffle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Data = {
  base: RenderBase;
  effects?: LyricEffectsProps | null;
  defaultSeed: number;
  setupWarnings: string[];
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
  const [order, setOrder] = useState<ClipOrder>("story");
  const [offset, setOffset] = useState(0); // seconds
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

  // Same function as "pnpm render:test": identical props for the same choices.
  const composed = useMemo(
    () =>
      data && seed !== null
        ? composeProps(data.base, { seed, style, order, leadMs: DEFAULT_LEAD_MS, lyricsOffsetMs: Math.round(offset * 1000), ...(data.effects ? { effects: data.effects } : {}) })
        : null,
    [data, seed, style, order, offset],
  );
  const props: LyricVideoProps | null = composed
    ? { ...composed.props, mediaBaseUrl: "/api/media", showSafeGuides: safeGuides }
    : null;
  const command = [
    "pnpm render:test",
    `--order ${order}`,
    order === "shuffle" ? `--seed ${seed}` : null,
    `--style ${style}`,
    offset !== 0 ? `--lyrics-offset ${offset.toFixed(2)}` : null,
  ]
    .filter(Boolean)
    .join(" ");

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
          <span className="text-muted-foreground text-xs font-medium uppercase">Clip order</span>
          <Toggle options={["story", "shuffle"] as const} value={order} onChange={setOrder} />
          {order === "shuffle" ? (
            <div className="flex items-center gap-3">
              <Button onClick={() => setSeed(Math.floor(Math.random() * 1_000_000))}>
                <Shuffle />
                Shuffle
              </Button>
              <span className="font-mono">seed {seed}</span>
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">Clips in file-name order (01_, 02_, …); pins.txt overrides.</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-muted-foreground text-xs font-medium uppercase">Text style</span>
          <Toggle options={["simple", "bold"] as const} value={style} onChange={setStyle} />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-muted-foreground text-xs font-medium uppercase">
            Lyrics offset: {offset > 0 ? "+" : ""}
            {offset.toFixed(2)} s
          </span>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.05}
            value={offset}
            onChange={(e) => setOffset(Number(e.target.value))}
            aria-label="Lyrics offset in seconds"
          />
          <p className="text-muted-foreground text-xs">
            Negative = earlier. Lines already appear {DEFAULT_LEAD_MS / 1000} s before their stamp. To keep a value for good:{" "}
            <code>pnpm lrc:shift workspace\test\lyrics.lrc {offset.toFixed(2)}</code>
          </p>
        </div>

        <label className="flex items-center gap-2">
          <input type="checkbox" checked={safeGuides} onChange={(e) => setSafeGuides(e.target.checked)} />
          Show safe-zone guides (preview only)
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs font-medium uppercase">Export exactly this</span>
          <code className="bg-muted rounded-md p-2 text-xs break-all">
            {command}
          </code>
        </div>

        {data.setupWarnings.length || composed?.warnings.length ? (
          <ul className="space-y-1 text-xs text-amber-400">
            {[...data.setupWarnings, ...(composed?.warnings ?? [])].map((w) => (
              <li key={w}>⚠ {w}</li>
            ))}
          </ul>
        ) : null}

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

function Toggle<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="bg-muted inline-flex w-fit rounded-lg p-1">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={cn(
            "rounded-md px-4 py-1.5 font-medium capitalize",
            value === o ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}
