import { Suspense } from "react";

import { PreviewClient } from "./preview-client";

// Preview of the test render (same composition and props as "pnpm render:test").
export default function PreviewPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground p-8 text-sm">Loading…</p>}>
      <PreviewClient />
    </Suspense>
  );
}
