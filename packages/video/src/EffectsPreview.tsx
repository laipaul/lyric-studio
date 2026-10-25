// "pnpm effects:preview": several LyricVideo panels side by side (one per lyric effect), each with
// its label, over one audio track, so effects can be compared by watching.
import { AbsoluteFill, Audio, interpolate } from "remotion";

import { LyricVideo } from "./LyricVideo";
import { DEFAULT_FORMAT, type Format } from "./platform";
import { mediaUrl, type LyricVideoProps } from "./props";

export const EFFECTS_PREVIEW_ID = "EffectsPreview";

export type EffectsPreviewProps = {
  mediaBaseUrl: string;
  format: Format; // the whole grid, e.g. 1920x1080
  columns: number;
  durationInFrames: number;
  audio: LyricVideoProps["audio"];
  labelFont: string;
  panels: { label: string; note?: string; props: Omit<LyricVideoProps, "mediaBaseUrl" | "audio"> }[];
};

export const defaultEffectsPreviewProps: EffectsPreviewProps = {
  mediaBaseUrl: "",
  format: { width: 1920, height: 1080 },
  columns: 4,
  durationInFrames: 90,
  audio: null,
  labelFont: "Inter",
  panels: [],
};

const LABEL_PX = 44;

export const EffectsPreview: React.FC<EffectsPreviewProps> = (p) => {
  const rows = Math.max(1, Math.ceil(p.panels.length / p.columns));
  const cellW = p.format.width / p.columns;
  const cellH = p.format.height / rows;
  const audio = p.audio;
  return (
    <AbsoluteFill style={{ backgroundColor: "#0b0b0d" }}>
      {p.panels.map((panel, i) => {
        const f = panel.props.format ?? DEFAULT_FORMAT;
        const scale = Math.min(cellW / f.width, (cellH - LABEL_PX) / f.height);
        const w = f.width * scale;
        const h = f.height * scale;
        const left = (i % p.columns) * cellW;
        const top = Math.floor(i / p.columns) * cellH;
        return (
          <div key={panel.label} style={{ position: "absolute", left, top, width: cellW, height: cellH }}>
            <div
              data-panel-label={panel.label}
              style={{ position: "absolute", left: 0, right: 0, top: 0, height: LABEL_PX, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "#f2f2f2", fontFamily: `"${p.labelFont}", sans-serif`, fontWeight: 600, fontSize: 22 }}
            >
              <span>{panel.label}</span>
              {panel.note ? <span style={{ color: "#E8A3B5", fontSize: 16 }}>{panel.note}</span> : null}
            </div>
            <div style={{ position: "absolute", left: (cellW - w) / 2, top: LABEL_PX, width: w, height: h, overflow: "hidden", borderRadius: 6 }}>
              <div style={{ position: "relative", width: f.width, height: f.height, transform: `scale(${scale})`, transformOrigin: "top left" }}>
                <LyricVideo {...panel.props} audio={null} mediaBaseUrl={p.mediaBaseUrl} />
              </div>
            </div>
          </div>
        );
      })}
      {audio ? (
        <Audio
          src={mediaUrl(p.mediaBaseUrl, audio.src)}
          trimBefore={audio.startFrame}
          volume={(f) =>
            Math.min(
              interpolate(f, [0, Math.max(1, audio.fadeInFrames)], [0, 1], { extrapolateRight: "clamp" }),
              interpolate(f, [p.durationInFrames - Math.max(1, audio.fadeOutFrames), p.durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            )
          }
        />
      ) : null}
    </AbsoluteFill>
  );
};
