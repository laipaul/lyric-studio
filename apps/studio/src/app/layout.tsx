import type { Metadata } from "next";

import { AppHeader } from "@/components/app-header";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lyric Studio",
  description: "Local beat-synced lyric video studio for Life Lyrics",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="dark h-full antialiased">
      <body className="flex h-full flex-col">
        <AppHeader />
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}
