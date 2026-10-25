import type { Metadata, Viewport } from "next";
import { Suspense } from "react";

import { AppHeader } from "@/components/app-header";
import { ServiceWorker } from "@/components/service-worker";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lyric Studio",
  description: "Beat-synced lyric videos for Life Lyrics, made on this PC",
  applicationName: "Lyric Studio",
  icons: { icon: "/icons/favicon-32.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = { themeColor: "#0b0b0d", colorScheme: "dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="dark h-full antialiased">
      <body className="flex h-full flex-col">
        <Suspense fallback={<div className="h-14 shrink-0 border-b" />}>
          <AppHeader />
        </Suspense>
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>
        <ServiceWorker />
      </body>
    </html>
  );
}
