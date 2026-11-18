import { connection } from "next/server";
import { Suspense } from "react";

import { CardPage } from "@/components/characters-view";

// One character or scene card: its picture and check, outfit or props, the pack, the description, lock.
export default function CharacterPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="text-muted-foreground p-8 text-sm">Loading…</div>}>
      <Card params={params} />
    </Suspense>
  );
}

async function Card({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  return <CardPage id={id} />;
}
