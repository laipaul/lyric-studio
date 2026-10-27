// YouTube thumbnail (1280x720): a strong picture, the song title in the brand title font with wide
// spacing and the accent colour, the artist and the logo. Rendered as a still by "pnpm make".
import { AbsoluteFill, Img } from "remotion";

import type { FontFileRef } from "./font-files";
import { useFonts } from "./fonts";
import { mediaUrl } from "./props";

export const THUMBNAIL_ID = "Thumbnail";
export const THUMBNAIL_SIZE = { width: 1280, height: 720 } as const;

export type ThumbnailProps = {
  mediaBaseUrl: string;
  background: string; // picture, relative to mediaBaseUrl
  title: string;
  artist: string;
  font: { family: string; weight: number; letterSpacing: number };
  colour: string; // accent colour for the title
  fonts: FontFileRef[];
  logo: { src: string; position: "top-left" | "top-right" | "bottom-left" | "bottom-right"; width: number } | null;
};

export const defaultThumbnailProps: ThumbnailProps = {
  mediaBaseUrl: "",
  background: "",
  title: "Song",
  artist: "Life Lyrics",
  font: { family: "Cinzel", weight: 700, letterSpacing: 0.18 },
  colour: "#E8A3B5",
  fonts: [],
  logo: null,
};

export const Thumbnail: React.FC<ThumbnailProps> = (p) => {
  const ready = useFonts(p.mediaBaseUrl, p.fonts);
  const size = p.title.length > 18 ? 74 : 96;
  const [v, h] = (p.logo?.position ?? "bottom-left").split("-") as ["top" | "bottom", "left" | "right"];
  return (
    <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
      {p.background ? <Img src={mediaUrl(p.mediaBaseUrl, p.background)} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
      <AbsoluteFill style={{ background: "linear-gradient(90deg, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.05) 100%)" }} />
      {ready ? (
        <div
          data-thumbnail-title
          style={{
            position: "absolute",
            left: 72,
            right: 300,
            top: "50%",
            transform: "translateY(-50%)",
            fontFamily: `"${p.font.family}", serif`,
            fontWeight: p.font.weight,
            fontSynthesis: "none",
            letterSpacing: `${p.font.letterSpacing}em`,
            textShadow: "0 4px 24px rgba(0,0,0,0.7)",
          }}
        >
          <div style={{ fontSize: size, lineHeight: 1.08, color: p.colour, textTransform: "uppercase" }}>{p.title}</div>
          <div style={{ fontSize: 34, marginTop: 22, color: "#ffffff", opacity: 0.9 }}>{p.artist}</div>
        </div>
      ) : null}
      {p.logo ? <Img src={mediaUrl(p.mediaBaseUrl, p.logo.src)} style={{ position: "absolute", width: p.logo.width, [v]: 36, [h]: 40, opacity: 0.95 }} /> : null}
    </AbsoluteFill>
  );
};
