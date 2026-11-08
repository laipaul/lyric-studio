import type { Metadata, Viewport } from "next";
import { Suspense } from "react";

import { AppHeader } from "@/components/app-header";
import { ServiceWorker } from "@/components/service-worker";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lyric Studio",
  description: "Beat-synced lyric videos for Life Lyrics, made on this PC",
  applicationName: "Lyric Studio",
  icons: {
    icon: [
      { url: "/icons/favicon.ico", sizes: "any" },
      { url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = { themeColor: "#0b0b0d", colorScheme: "dark" };

// The browser's own video controls (Review, Post, Compare; 8 Nov 2026, asked by the user: "what is this horizontal
// line on the Reel" — the MP4 itself is clean): Chrome / Edge draw a dark band behind the ▶ / time / volume bar whose
// top edge shows as a thin line across the picture. Our own soft fade instead (no edge). In a plain <style> tag:
// the CSS build drops these browser-specific selectors from globals.css.
const VIDEO_CONTROLS_CSS = `video::-webkit-media-controls-panel{background-image:linear-gradient(to top,rgba(0,0,0,.55),rgba(0,0,0,0))!important;background-color:transparent!important;border:0!important;box-shadow:none!important}video::-webkit-media-controls-enclosure{background:none!important;border:0!important;box-shadow:none!important}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="dark h-full antialiased">
      <body className="flex h-full flex-col">
        <style data-video-controls dangerouslySetInnerHTML={{ __html: VIDEO_CONTROLS_CSS }} />
        <Suspense fallback={<div className="h-14 shrink-0 border-b" />}>
          <AppHeader />
        </Suspense>
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>
        <ServiceWorker />
      </body>
    </html>
  );
}
