import { connection } from "next/server";
import { Suspense } from "react";

import { ReleaseDetail } from "@/components/releases-view";

// One release: its songs x platforms grid, Make all, rename, songs, delete.
export default function ReleasePage({ params }: { params: Promise<{ name: string }> }) {
  return (
    <Suspense fallback={<div className="text-muted-foreground p-8 text-sm">Loading…</div>}>
      <Release params={params} />
    </Suspense>
  );
}

async function Release({ params }: { params: Promise<{ name: string }> }) {
  await connection();
  const { name } = await params;
  return <ReleaseDetail name={decodeURIComponent(name)} />;
}
