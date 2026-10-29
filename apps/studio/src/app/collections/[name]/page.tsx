import { connection } from "next/server";
import { Suspense } from "react";

import { CollectionView } from "@/components/collections-view";

// One shared collection: its clips, add / remove / restore, Open folder.
export default function CollectionPage({ params }: { params: Promise<{ name: string }> }) {
  return (
    <Suspense fallback={<div className="text-muted-foreground p-8 text-sm">Loading…</div>}>
      <Collection params={params} />
    </Suspense>
  );
}

async function Collection({ params }: { params: Promise<{ name: string }> }) {
  await connection();
  const { name } = await params;
  return <CollectionView name={decodeURIComponent(name)} />;
}
