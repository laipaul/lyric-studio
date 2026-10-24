import { Music } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Home: placeholder. Song drop and recent projects arrive in a later step.
export default function HomePage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8">
      <div>
        <h1 className="text-2xl font-semibold">Home</h1>
        <p className="text-muted-foreground text-sm">Create a project from a song.</p>
      </div>

      <div className="text-muted-foreground flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed">
        <Music className="size-8" />
        <p className="text-sm">Drop a song here (coming in a later step)</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent projects</CardTitle>
          <CardDescription>No projects yet.</CardDescription>
        </CardHeader>
        <CardContent />
      </Card>
    </div>
  );
}
