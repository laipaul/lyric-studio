import { measureText } from "@remotion/layout-utils";
import { useMemo } from "react";
import {
  AbsoluteFill,
  Audio,
  Freeze,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import { useFonts } from "./fonts";
import { activeLyricLine, applyTextCase, layoutLyric } from "./lyrics";
import { kenBurnsAt } from "./photo";
import { cinematicBarHeight, DEFAULT_FORMAT, DEFAULT_LYRIC_AREA, DEFAULT_SAFE_ZONE, type Format, type LyricArea, type SafeZone } from "./platform";
import { mediaUrl, type LyricLineProps, type LyricVideoProps, type ShotProps, type StyleProps } from "./props";

const cover: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };
const contain: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" };
const blurred: React.CSSProperties = { ...cover, position: "absolute", inset: 0, filter: "blur(40px) brightness(0.6)", transform: "scale(1.15)" };

function ClipVideo({ src, shot }: { src: string; shot: ShotProps }) {
  const video = (style: React.CSSProperties) => (
    <OffthreadVideo src={src} muted trimBefore={shot.clipStartFrame} playbackRate={shot.playbackRate} style={style} pauseWhenBuffering />
  );
  if (shot.fit !== "fill") return video(cover);
  // Fill: the whole picture over a blurred, enlarged copy of itself.
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {video(blurred)}
      {video(contain)}
    </AbsoluteFill>
  );
}

// A photo: cover-cropped, with its Ken Burns move spread over exactly the shot.
function PhotoShot({ src, shot }: { src: string; shot: ShotProps }) {
  const frame = useCurrentFrame();
  const t = shot.duration > 1 ? frame / (shot.duration - 1) : 0;
  const m = shot.motion ? kenBurnsAt(shot.motion, t) : { zoom: 1, x: 0, y: 0 };
  const transform = `translate(${(m.x * 100).toFixed(4)}%, ${(m.y * 100).toFixed(4)}%) scale(${m.zoom.toFixed(5)})`;
  if (shot.fit === "fill") {
    return (
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <Img src={src} style={blurred} />
        <Img src={src} style={{ ...contain, transform }} />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Img src={src} style={{ ...cover, transform }} />
    </AbsoluteFill>
  );
}

// One shot: the clip from its start offset at its playback rate; if it runs out, its last frame holds.
function Shot({ shot, mediaBaseUrl }: { shot: ShotProps; mediaBaseUrl: string }) {
  const src = mediaUrl(mediaBaseUrl, shot.src);
  if (shot.kind === "photo") return <PhotoShot src={src} shot={shot} />;
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

function LyricText({ line, style, font, textSize, colour, ready, area }: {
  line: LyricLineProps;
  area: LyricArea;
  style: StyleProps;
  font: { family: string; weight: number };
  textSize: number;
  colour: string;
  ready: boolean;
}) {
  const frame = useCurrentFrame(); // relative to the line's Sequence: 0 = first frame of the line
  const { fps } = useVideoConfig();
  const text = applyTextCase(line.text, style.textCase);
  const maxWidth = area.right - area.left;

  const layout = useMemo(
    () =>
      ready
        ? layoutLyric(
            text,
            textSize,
            maxWidth,
            (t, size) => measureText({ text: t, fontFamily: font.family, fontWeight: font.weight, fontSize: size }).width,
            area.minScale,
          )
        : null,
    [ready, text, textSize, maxWidth, font.family, font.weight, area.minScale],
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
        left: area.left,
        width: maxWidth,
        top: area.centerY,
        transform: `translateY(-50%) scale(${scale})`,
        textAlign: "center",
        color: colour,
        fontFamily: `"${font.family}", sans-serif`,
        fontWeight: font.weight,
        fontSize: layout.fontSize,
        lineHeight: area.lineHeight,
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

function SafeGuides({ format, safe, area }: { format: Format; safe: SafeZone; area: LyricArea }) {
  const zone: React.CSSProperties = { position: "absolute", background: "rgba(255,40,40,0.18)" };
  const px = { top: format.height * safe.top, bottom: format.height * safe.bottom, left: format.width * safe.left, right: format.width * safe.right };
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ ...zone, left: 0, right: 0, top: 0, height: px.top }} />
      <div style={{ ...zone, left: 0, right: 0, bottom: 0, height: px.bottom }} />
      <div style={{ ...zone, left: 0, top: px.top, bottom: px.bottom, width: px.left }} />
      <div style={{ ...zone, right: 0, top: px.top, bottom: px.bottom, width: px.right }} />
      <div
        style={{
          position: "absolute",
          left: px.left,
          top: px.top,
          width: format.width - px.left - px.right,
          height: format.height - px.top - px.bottom,
          border: "4px dashed rgba(255,80,80,0.9)",
          boxSizing: "border-box",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: area.left,
          width: area.right - area.left,
          top: area.centerY - 160,
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
  const ready = useFonts(mediaBaseUrl, props.fonts);
  const line = activeLyricLine(lyrics, frame);
  const format = props.format ?? DEFAULT_FORMAT;
  const area = props.lyricArea ?? DEFAULT_LYRIC_AREA;
  const barHeight = cinematicBarHeight(format);
  const font =
    line?.isHook && props.hookFont
      ? { family: props.hookFont.font, weight: props.hookFont.weight }
      : { family: style.font, weight: style.weight };

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
          <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: barHeight, background: "#000" }} />
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: barHeight, background: "#000" }} />
        </>
      ) : null}

      {line ? (
        <Sequence key={line.startFrame} from={line.startFrame} durationInFrames={line.endFrame - line.startFrame} layout="none">
          <LyricText line={line} style={style} font={font} textSize={textSize} colour={colour} ready={ready} area={area} />
        </Sequence>
      ) : null}

      {props.showSafeGuides ? <SafeGuides format={format} safe={props.safeZone ?? DEFAULT_SAFE_ZONE} area={area} /> : null}
    </AbsoluteFill>
  );
};
