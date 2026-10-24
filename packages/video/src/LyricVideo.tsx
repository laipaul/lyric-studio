import { measureText } from "@remotion/layout-utils";
import { useMemo } from "react";
import {
  AbsoluteFill,
  Audio,
  Freeze,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import { CINEMATIC_BAR_HEIGHT, LYRIC_AREA, SAFE_ZONE, VIDEO } from "./config";
import { resolveFont, useFont } from "./fonts";
import { activeLyricLine, applyTextCase, layoutLyric } from "./lyrics";
import { mediaUrl, type LyricLineProps, type LyricVideoProps, type ShotProps, type StyleProps } from "./props";

const cover: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };

function ClipVideo({ src, shot }: { src: string; shot: ShotProps }) {
  return (
    <OffthreadVideo
      src={src}
      muted
      trimBefore={shot.clipStartFrame}
      playbackRate={shot.playbackRate}
      style={cover}
      pauseWhenBuffering
    />
  );
}

// One shot: the clip from its start offset at its playback rate; if it runs out, its last frame holds.
function Shot({ shot, mediaBaseUrl }: { shot: ShotProps; mediaBaseUrl: string }) {
  const src = mediaUrl(mediaBaseUrl, shot.src);
  if (!shot.holdLastFrame) return <ClipVideo src={src} shot={shot} />;

  // Last shot frame that still shows a real clip frame at this rate.
  const lastPlayable = Math.floor((shot.clipDurationFrames - 1 - shot.clipStartFrame) / shot.playbackRate);
  return (
    <>
      <Sequence durationInFrames={lastPlayable + 1} layout="none">
        <ClipVideo src={src} shot={shot} />
      </Sequence>
      <Sequence from={lastPlayable + 1} layout="none">
        <Freeze frame={lastPlayable}>
          <ClipVideo src={src} shot={shot} />
        </Freeze>
      </Sequence>
    </>
  );
}

const textShadows: Record<string, string> = {
  none: "0 2px 12px rgba(0,0,0,0.55)", // light shadow only to stay readable on any clip
  shadow: "0 6px 0 rgba(0,0,0,0.35), 0 0 28px rgba(0,0,0,0.65)",
};

function LyricText({ line, style, textSize, colour, ready }: {
  line: LyricLineProps;
  style: StyleProps;
  textSize: number;
  colour: string;
  ready: boolean;
}) {
  const frame = useCurrentFrame(); // relative to the line's Sequence: 0 = first frame of the line
  const { fps } = useVideoConfig();
  const font = resolveFont(style.font, style.weight);
  const text = applyTextCase(line.text, style.textCase);
  const maxWidth = LYRIC_AREA.right - LYRIC_AREA.left;

  const layout = useMemo(
    () =>
      ready
        ? layoutLyric(
            text,
            textSize,
            maxWidth,
            (t, size) => measureText({ text: t, fontFamily: font.family, fontWeight: font.weight, fontSize: size }).width,
            LYRIC_AREA.minScale,
          )
        : null,
    [ready, text, textSize, maxWidth, font.family, font.weight],
  );
  if (!layout) return null;

  const length = line.endFrame - line.startFrame;
  let opacity = 1;
  let scale = 1;
  if (style.animation === "pop") {
    scale = interpolate(spring({ frame, fps, config: { damping: 12, stiffness: 180 } }), [0, 1], [0.85, 1]);
  } else {
    // Fade, but never fully invisible: the line is readable from its first to its last frame.
    opacity = Math.min(
      interpolate(frame, [0, 4], [0.4, 1], { extrapolateRight: "clamp" }),
      interpolate(frame, [length - 4, length - 1], [1, 0.4], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    );
  }

  return (
    <div
      data-lyric={line.text}
      style={{
        position: "absolute",
        left: LYRIC_AREA.left,
        width: maxWidth,
        top: LYRIC_AREA.centerY,
        transform: `translateY(-50%) scale(${scale})`,
        textAlign: "center",
        color: colour,
        fontFamily: `"${font.family}", sans-serif`,
        fontWeight: font.weight,
        fontSize: layout.fontSize,
        lineHeight: LYRIC_AREA.lineHeight,
        textShadow: textShadows[style.effect] ?? textShadows.none,
        opacity,
      }}
    >
      {layout.lines.map((l, i) => (
        <div key={i} style={{ whiteSpace: "nowrap" }}>
          {l}
        </div>
      ))}
    </div>
  );
}

function SafeGuides() {
  const right = VIDEO.width * SAFE_ZONE.right;
  const bottom = VIDEO.height * SAFE_ZONE.bottom;
  const zone: React.CSSProperties = { position: "absolute", background: "rgba(255,40,40,0.18)" };
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ ...zone, right: 0, top: 0, width: right, bottom }} />
      <div style={{ ...zone, left: 0, right: 0, bottom: 0, height: bottom }} />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: VIDEO.width - right,
          height: VIDEO.height - bottom,
          border: "4px dashed rgba(255,80,80,0.9)",
          boxSizing: "border-box",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: LYRIC_AREA.left,
          width: LYRIC_AREA.right - LYRIC_AREA.left,
          top: LYRIC_AREA.centerY - 160,
          height: 320,
          border: "3px dashed rgba(80,200,255,0.9)",
          boxSizing: "border-box",
        }}
      />
    </AbsoluteFill>
  );
}

export const LyricVideo: React.FC<LyricVideoProps> = (props) => {
  const { mediaBaseUrl, audio, shots, lyrics, style, textSize, colour, cinematicBars, durationInFrames } = props;
  const frame = useCurrentFrame();
  const font = resolveFont(style.font, style.weight);
  const ready = useFont(mediaBaseUrl, font.family, font.weight);
  const line = activeLyricLine(lyrics, frame);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {shots.map((shot) => (
        <Sequence key={shot.start} from={shot.start} durationInFrames={shot.duration} premountFor={30}>
          <Shot shot={shot} mediaBaseUrl={mediaBaseUrl} />
        </Sequence>
      ))}

      {audio ? (
        <Audio
          src={mediaUrl(mediaBaseUrl, audio.src)}
          trimBefore={audio.startFrame}
          volume={(f) =>
            Math.min(
              audio.fadeInFrames > 0 ? interpolate(f, [0, audio.fadeInFrames], [0, 1], { extrapolateRight: "clamp" }) : 1,
              audio.fadeOutFrames > 0
                ? interpolate(f, [durationInFrames - audio.fadeOutFrames, durationInFrames], [1, 0], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  })
                : 1,
            )
          }
        />
      ) : null}

      {cinematicBars ? (
        <>
          <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: CINEMATIC_BAR_HEIGHT, background: "#000" }} />
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: CINEMATIC_BAR_HEIGHT, background: "#000" }} />
        </>
      ) : null}

      {line ? (
        <Sequence key={line.startFrame} from={line.startFrame} durationInFrames={line.endFrame - line.startFrame} layout="none">
          <LyricText line={line} style={style} textSize={textSize} colour={colour} ready={ready} />
        </Sequence>
      ) : null}

      {props.showSafeGuides ? <SafeGuides /> : null}
    </AbsoluteFill>
  );
};
