import type { MetadataRoute } from "next";

// Web app manifest: Edge / Chrome offer "Install as app" (own window and taskbar icon). The icons
// are made from WORKSPACE_DIR\brand\logo.png (see app/icons/[name]/route.ts).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lyric Studio",
    short_name: "Lyric Studio",
    description: "Beat-synced lyric videos for Life Lyrics, made on this PC",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0b0b0d",
    theme_color: "#0b0b0d",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
