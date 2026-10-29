import { measureText } from "@remotion/layout-utils";
import { useMemo } from "react";
import {
  AbsoluteFill,
  Easing,
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
import { LyricScene } from "./LyricScene";
import { activeLyricLine, applyTextCase, layoutLyric } from "./lyrics";
import { kenBurnsAt } from "./photo";
import { loopBlendOpacity, photoLoopProgress } from "./canvas";
import { dipOpacity } from "./transitions";
import { beatPulse, coverMotionAt, logoOpacity, moodAt, stillOpacity, type Rgba } from "./youtube";
import { COVER_CENTRE_X, coverSide } from "./youtube-layout";

const LOGO_FADE_FRAMES = 15; // 0.5 s
import { cinematicBarHeight, DEFAULT_FORMAT, DEFAULT_LYRIC_AREA, DEFAULT_SAFE_ZONE, type Format, type LyricArea, type SafeZone } from "./platform";
import { mediaUrl, type LyricLineProps, type LyricVideoProps, type ShotProps, type StyleProps, type TextCardProps } from "./props";
import { textCardLook } from "./text-cards";

const cover: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };
const cover_ = cover;
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
  // A dissolve starts the shot early and a tail keeps it on after: the move stays fitted to the shot.
  const frame = useCurrentFrame() - (shot.dissolve?.before ?? 0);
  const progress = shot.duration > 1 ? Math.min(1, Math.max(0, frame / (shot.duration - 1))) : 0;
  // A looping photo moves out and back, so its last frame matches its first.
  const t = shot.motionLoop ? photoLoopProgress(progress) : progress;
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
  if (shot.loopBlend) return <LoopingClip src={src} shot={shot} blend={shot.loopBlend} />;
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

// Story anchors: the shot fades in over the previous one (which is still playing underneath).
function DissolveIn({ frames, children }: { frames: number; children: React.ReactNode }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, Math.max(1, frames)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.ease) });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

// Lyric readability "strong": a soft dark band behind the lyric area (fading out above and below).
function LyricBacking({ area, height }: { area: LyricArea; height: number }) {
  const half = Math.max(area.bottom - area.top, height * 0.12) * 0.75;
  const top = Math.max(0, area.centerY - half);
  const bottom = Math.min(height, area.centerY + half);
  return (
    <div
      data-lyric-backing
      style={{ position: "absolute", left: 0, right: 0, top, height: bottom - top, background: "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.42) 35%, rgba(0,0,0,0.42) 65%, rgba(0,0,0,0) 100%)" }}
    />
  );
}

// A dip to black between two shots (automatic transitions): under the lyrics, darkest on the cut.
function DipOverlay({ dips }: { dips: NonNullable<LyricVideoProps["dips"]> }) {
  const opacity = dipOpacity(useCurrentFrame(), dips);
  return opacity > 0 ? <AbsoluteFill style={{ backgroundColor: "#000", opacity }} /> : null;
}

// Loop platforms: the last `frames` frames fade into the first shot's opening (the frames just before it,
// or its first frame held), so the loop's last frame leads straight into the first.
function LoopIntoFirst({ first, frames, durationInFrames, mediaBaseUrl }: { first: ShotProps; frames: number; durationInFrames: number; mediaBaseUrl: string }) {
  const back = Math.round(frames * first.playbackRate);
  const plays = first.kind !== "photo" && first.clipStartFrame >= back;
  const shot: ShotProps = { ...first, start: 0, duration: frames, dissolve: undefined, tail: undefined, loopBlend: undefined, ...(plays ? { clipStartFrame: first.clipStartFrame - back } : {}) };
  return (
    <Sequence from={durationInFrames - frames} durationInFrames={frames} layout="none">
      <LoopIntoFade frames={frames}>{plays ? <Shot shot={shot} mediaBaseUrl={mediaBaseUrl} /> : <Freeze frame={0}><Shot shot={first} mediaBaseUrl={mediaBaseUrl} /></Freeze>}</LoopIntoFade>
    </Sequence>
  );
}
function LoopIntoFade({ frames, children }: { frames: number; children: React.ReactNode }) {
  const opacity = Math.min(1, (useCurrentFrame() + 1) / frames);
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

// Seamless loop: the clip plays from clipStartFrame; over the last `blend.frames` frames the frames
// right before clipStartFrame fade in on top, so the final frame leads straight into the first one.
function LoopingClip({ src, shot, blend }: { src: string; shot: ShotProps; blend: NonNullable<ShotProps["loopBlend"]> }) {
  const frame = useCurrentFrame();
  const from = shot.duration - blend.frames;
  const opacity = loopBlendOpacity(frame, shot.duration, blend.frames);
  return (
    <>
      <ClipVideo src={src} shot={shot} />
      <Sequence from={from} durationInFrames={blend.frames} layout="none">
        <AbsoluteFill style={{ opacity }}>
          <ClipVideo src={src} shot={{ ...shot, clipStartFrame: blend.fromClipFrame, loopBlend: undefined }} />
        </AbsoluteFill>
      </Sequence>
    </>
  );
}

const textShadows: Record<string, string> = {
  none: "0 2px 12px rgba(0,0,0,0.55)", // light shadow only to stay readable on any clip
  shadow: "0 6px 0 rgba(0,0,0,0.35), 0 0 28px rgba(0,0,0,0.65)",
};

function LyricText({ line, style, font, textSize, colour, ready, area, glow, next, nextScale = 0.55 }: {
  line: LyricLineProps;
  area: LyricArea;
  glow?: string; // extra text-shadow (beat-pulsed glow)
  next?: string | null; // the next line, shown small and faded underneath
  nextScale?: number;
  style: StyleProps;
  font: { family: string; weight: number; italic?: boolean };
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
            (t, size) => measureText({ text: t, fontFamily: font.family, fontWeight: font.weight, fontSize: size, ...(font.italic ? { additionalStyles: { fontStyle: "italic" } } : {}) }).width,
            area.minScale,
          )
        : null,
    [ready, text, textSize, maxWidth, font.family, font.weight, font.italic, area.minScale],
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
        fontStyle: font.italic ? "italic" : "normal",
        fontSynthesis: "none", // the exact file: never a fake bold or italic
        fontSize: layout.fontSize,
        lineHeight: area.lineHeight,
        textShadow: [textShadows[style.effect] ?? textShadows.none, ...(glow ? [glow] : [])].join(", "),
        opacity,
      }}
    >
      {layout.lines.map((l, i) => (
        <div key={i} style={{ whiteSpace: "nowrap" }}>
          {l}
        </div>
      ))}
      {next ? (
        // Positioned below the current line without changing its centring.
        <div
          data-next-lyric={next}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "100%",
            marginTop: layout.fontSize * 0.35,
            fontSize: layout.fontSize * nextScale,
            opacity: 0.45,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {applyTextCase(next, style.textCase)}
        </div>
      ) : null}
    </div>
  );
}

// Cover layout: the square cover in the left part with a very slow zoom and a soft shadow, over the
// same cover blurred and darkened.
function CoverLayout({ cover, mediaBaseUrl, format, mood }: { cover: NonNullable<LyricVideoProps["cover"]>; mediaBaseUrl: string; format: Format; mood: Rgba | null }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const m = coverMotionAt(cover, frame / Math.max(1, durationInFrames - 1), cover.parallax ?? 0);
  const src = mediaUrl(mediaBaseUrl, cover.src);
  const side = coverSide(format);
  // The background is drawn a little larger so its parallax movement never shows an edge.
  const backgroundMove = `translate(${m.backgroundX.toFixed(2)}px, ${m.backgroundY.toFixed(2)}px) scale(1.06)`;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {cover.backgroundSrc ? (
        // Blurred and darkened once by FFmpeg: much faster than a CSS blur on every frame.
        <Img src={mediaUrl(mediaBaseUrl, cover.backgroundSrc)} style={{ ...cover_, position: "absolute", inset: 0, transform: backgroundMove }} />
      ) : (
        <Img src={src} style={{ ...cover_, position: "absolute", inset: 0, filter: "blur(48px) brightness(0.45)", transform: "scale(1.2)" }} />
      )}
      {mood ? <MoodOverlay colour={mood} /> : null}
      <div
        data-cover
        style={{
          position: "absolute",
          left: Math.round(format.width * COVER_CENTRE_X - side / 2),
          top: Math.round((format.height - side) / 2),
          width: side,
          height: side,
          overflow: "hidden",
          borderRadius: 6,
          boxShadow: "0 30px 90px rgba(0,0,0,0.65), 0 8px 24px rgba(0,0,0,0.45)",
          transform: `translate(${m.x.toFixed(2)}px, ${m.y.toFixed(2)}px) scale(${m.zoom.toFixed(5)})`,
        }}
      >
        <Img src={src} style={cover_} />
      </div>
    </AbsoluteFill>
  );
}

// Section mood: a colour veil over the background (see moodAt: eased 2 s changes, never flashing).
function MoodOverlay({ colour }: { colour: Rgba }) {
  if (colour[3] <= 0.001) return null;
  return <AbsoluteFill data-mood style={{ pointerEvents: "none", backgroundColor: `rgba(${colour.slice(0, 3).map((c) => Math.round(c)).join(",")},${colour[3].toFixed(4)})` }} />;
}

// Stills layout: one picture per lyric section, crossfaded, each with a slow Ken Burns move.
function StillsLayout({ stills, mediaBaseUrl }: { stills: NonNullable<LyricVideoProps["stills"]>; mediaBaseUrl: string }) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {stills.map((s, i) => {
        const opacity = stillOpacity(s, frame, i === 0, i === stills.length - 1);
        if (opacity <= 0) return null;
        const t = (frame - s.startFrame) / Math.max(1, s.endFrame - s.startFrame - 1);
        const m = s.motion ? kenBurnsAt(s.motion, t) : { zoom: 1, x: 0, y: 0 };
        return (
          <Img
            key={`${s.src}-${s.startFrame}`}
            src={mediaUrl(mediaBaseUrl, s.src)}
            style={{
              ...cover_,
              position: "absolute",
              inset: 0,
              opacity,
              transform: `translate(${(m.x * 100).toFixed(4)}%, ${(m.y * 100).toFixed(4)}%) scale(${m.zoom.toFixed(5)})`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
}

// Subtle film grain: SVG noise that changes every frame (the same frame always looks the same).
function Grain() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: 0.07, mixBlendMode: "overlay" }}>
      <svg width="100%" height="100%">
        <filter id="lyric-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={frame % 97} stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#lyric-grain)" />
      </svg>
    </AbsoluteFill>
  );
}

// Song title and artist (brand title font, wide spacing, accent colour) over the opening seconds.
function TitleOverlay({ t, format }: { t: NonNullable<LyricVideoProps["titleOverlay"]>; format: Format }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [t.untilFrame - 30, t.untilFrame], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (opacity <= 0) return null;
  return (
    <div
      data-title
      style={{
        position: "absolute",
        left: t.left ?? 0,
        right: t.right !== undefined ? format.width - t.right : 0,
        top: t.position === "top" ? Math.round(format.height * 0.07) : "50%",
        transform: t.position === "top" ? undefined : "translateY(-50%)",
        textAlign: "center",
        fontFamily: `"${t.font}", serif`,
        fontWeight: t.weight,
        fontSynthesis: "none",
        color: t.colour,
        letterSpacing: `${t.letterSpacing}em`,
        textShadow: "0 2px 18px rgba(0,0,0,0.6)",
        opacity,
      }}
    >
      <div style={{ fontSize: t.size, textTransform: "uppercase" }}>{t.title}</div>
      <div style={{ fontSize: Math.round(t.size * 0.45), marginTop: t.size * 0.25, color: "#ffffff", opacity: 0.85 }}>{t.artist}</div>
    </div>
  );
}

// The textboard's title, byline and tagline cards. A card "with-title" sits under the card it is stacked
// on (as the artist under the title); the others are blocks of their own. Without an effect a card
// is on screen from its start and fades out over its last second (the YouTube title as before).
function TextCards({ cards, format }: { cards: TextCardProps[]; format: Format }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const shown = new Set(cards.map((c) => c.id));
  const roots = cards.filter((c) => !c.stackOn || !shown.has(c.stackOn));
  const line = (c: TextCardProps, parent: TextCardProps | null) => {
    const look = parent ? textCardLook(c, frame, fps) : { opacity: 1 };
    if (!look || look.opacity <= 0.001) return null;
    return (
      <div
        key={c.id}
        data-text-card={c.id}
        style={{
          fontSize: c.size,
          ...(c.upper ? { textTransform: "uppercase" as const } : {}),
          ...(parent
            ? {
                marginTop: parent.size * 0.25,
                ...(c.colour !== parent.colour ? { color: c.colour } : {}),
                ...(c.font !== parent.font || c.weight !== parent.weight || !!c.italic !== !!parent.italic
                  ? { fontFamily: `"${c.font}", serif`, fontWeight: c.weight, fontStyle: c.italic ? "italic" : "normal" }
                  : {}),
                ...(c.letterSpacing !== parent.letterSpacing ? { letterSpacing: `${c.letterSpacing}em` } : {}),
                opacity: (c.opacity ?? 1) * look.opacity,
              }
            : c.opacity !== undefined && c.opacity !== 1
              ? { opacity: c.opacity }
              : {}),
        }}
      >
        {c.text}
      </div>
    );
  };
  return (
    <>
      {roots.map((root) => {
        const look = textCardLook(root, frame, fps);
        if (!look || look.opacity <= 0.001) return null;
        const stacked = cards.filter((c) => c.stackOn === root.id);
        const moved = look.x || look.y || look.scale !== 1;
        return (
          <div
            key={root.id}
            data-title={root.type === "title" ? "" : undefined}
            style={{
              position: "absolute",
              left: root.left ?? 0,
              right: root.right !== undefined ? format.width - root.right : 0,
              top: root.top ?? root.centerY ?? "50%",
              transform: [root.top === undefined ? "translateY(-50%)" : "", moved ? `translate(${look.x.toFixed(2)}px, ${look.y.toFixed(2)}px) scale(${look.scale.toFixed(4)})` : ""].filter(Boolean).join(" ") || undefined,
              textAlign: "center",
              fontFamily: `"${root.font}", serif`,
              fontWeight: root.weight,
              ...(root.italic ? { fontStyle: "italic" as const } : {}),
              fontSynthesis: "none",
              color: root.colour,
              letterSpacing: `${root.letterSpacing}em`,
              textShadow: "0 2px 18px rgba(0,0,0,0.6)",
              opacity: look.opacity,
              filter: look.blur > 0.01 ? `blur(${look.blur.toFixed(2)}px)` : undefined,
            }}
          >
            {line(root, null)}
            {stacked.map((c) => line(c, root))}
          </div>
        );
      })}
    </>
  );
}

function Logo({ logo, mediaBaseUrl }: { logo: NonNullable<LyricVideoProps["logo"]>; mediaBaseUrl: string }) {
  const frame = useCurrentFrame();
  const opacity = 0.9 * logoOpacity(frame, logo.goneAt, LOGO_FADE_FRAMES);
  if (opacity <= 0) return null;
  return (
    <Img
      data-logo
      src={mediaUrl(mediaBaseUrl, logo.src)}
      style={{ position: "absolute", left: logo.left, top: logo.top, width: logo.width, height: logo.height, opacity }}
    />
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
  // In the last seconds of a YouTube video the lyrics move out of the end-screen area; a line that
  // reaches into that time is placed there from its start (it never jumps).
  const endScreen = props.endScreen;
  const area = line && endScreen && line.endFrame > endScreen.fromFrame ? endScreen.lyricArea : (props.lyricArea ?? DEFAULT_LYRIC_AREA);
  const { fps } = useVideoConfig();
  const mood = props.mood?.length ? moodAt(frame, props.mood, fps) : null;
  const next = props.nextLine && line ? lyrics.find((l) => l.startFrame > line.startFrame)?.text ?? null : null;
  const glow = props.glow
    ? (() => {
        const p = beatPulse(frame, props.glow.beatFrames);
        return `0 0 ${Math.round(14 + 22 * p)}px ${hexAlpha(props.glow.colour, 0.35 + 0.4 * p)}`;
      })()
    : undefined;
  const barHeight = cinematicBarHeight(format);
  const font =
    line?.isHook && props.hookFont
      ? { family: props.hookFont.font, weight: props.hookFont.weight, italic: props.hookFont.italic === true }
      : { family: style.font, weight: style.weight, italic: style.italic === true };

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {props.layout === "cover" && props.cover ? <CoverLayout cover={props.cover} mediaBaseUrl={mediaBaseUrl} format={format} mood={mood} /> : null}
      {props.layout === "stills" && props.stills ? <StillsLayout stills={props.stills} mediaBaseUrl={mediaBaseUrl} /> : null}
      {shots.map((shot) => (
        <Sequence
          key={shot.start}
          from={shot.start - (shot.dissolve?.before ?? 0)}
          durationInFrames={shot.duration + (shot.dissolve?.before ?? 0) + (shot.tail ?? 0)}
          premountFor={30}
        >
          {shot.dissolve ? (
            <DissolveIn frames={shot.dissolve.before + shot.dissolve.after}>
              <Shot shot={shot} mediaBaseUrl={mediaBaseUrl} />
            </DissolveIn>
          ) : (
            <Shot shot={shot} mediaBaseUrl={mediaBaseUrl} />
          )}
        </Sequence>
      ))}

      {props.loopInto && shots.length > 1 ? <LoopIntoFirst first={shots[0]} frames={props.loopInto.frames} durationInFrames={durationInFrames} mediaBaseUrl={mediaBaseUrl} /> : null}
      {props.dips?.length ? <DipOverlay dips={props.dips} /> : null}

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

      {mood && props.layout !== "cover" ? <MoodOverlay colour={mood} /> : null}

      {props.lyricBacking && props.lyrics.length ? <LyricBacking area={props.lyricArea ?? DEFAULT_LYRIC_AREA} height={format.height} /> : null}

      {cinematicBars ? (
        <>
          <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: barHeight, background: "#000" }} />
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: barHeight, background: "#000" }} />
        </>
      ) : null}

      {props.lyricEffects ? (
        <LyricScene
          lyrics={lyrics}
          effects={props.lyricEffects}
          style={style}
          hookFont={props.hookFont ?? null}
          textSize={textSize}
          colour={colour}
          ready={ready}
          areaFor={(l) => (endScreen && l.endFrame > endScreen.fromFrame ? endScreen.lyricArea : (props.lyricArea ?? DEFAULT_LYRIC_AREA))}
          glow={glow}
          showNext={props.nextLine ?? false}
          nextScale={props.nextLineScale ?? 0.55}
        />
      ) : line ? (
        <Sequence key={line.startFrame} from={line.startFrame} durationInFrames={line.endFrame - line.startFrame} layout="none">
          <LyricText line={line} style={style} font={font} textSize={textSize} colour={colour} ready={ready} area={area} glow={glow} next={next} nextScale={props.nextLineScale} />
        </Sequence>
      ) : null}

      {props.grain ? <Grain /> : null}
      {props.textCards?.length ? <TextCards cards={props.textCards} format={format} /> : props.titleOverlay ? <TitleOverlay t={props.titleOverlay} format={format} /> : null}
      {props.logo ? <Logo logo={props.logo} mediaBaseUrl={mediaBaseUrl} /> : null}

      {props.showSafeGuides ? <SafeGuides format={format} safe={props.safeZone ?? DEFAULT_SAFE_ZONE} area={area} /> : null}
    </AbsoluteFill>
  );
};

// "#E8A3B5" + alpha -> "rgba(232,163,181,0.5)"
function hexAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha.toFixed(3)})`;
}
