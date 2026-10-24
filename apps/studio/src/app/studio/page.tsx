import { Clapperboard } from "lucide-react";

import { Button } from "@/components/ui/button";

const LEFT_SECTIONS = ["Project", "Sections", "Lyrics", "Text styles", "Cinematic bars"];

function PanelSection({ title }: { title: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{title}</h2>
      <div className="h-16 rounded-lg border border-dashed" />
    </section>
  );
}

// Studio: three-panel layout with a phone-shaped 9:16 preview. Placeholders only.
export default function StudioPage() {
  return (
    <div className="flex min-h-0 flex-1">
      <aside
        aria-label="Project panel"
        className="flex w-72 shrink-0 flex-col gap-5 overflow-y-auto border-r p-4"
      >
        {LEFT_SECTIONS.map((title) => (
          <PanelSection key={title} title={title} />
        ))}
      </aside>

      <section
        aria-label="Preview"
        className="flex min-w-0 flex-1 flex-col items-center justify-center gap-4 p-6"
      >
        <div
          data-testid="phone-preview"
          className="bg-card relative aspect-[9/16] h-full max-h-[640px] rounded-[2.5rem] border-[6px] border-neutral-800 shadow-2xl"
        >
          <div className="absolute top-2 left-1/2 h-5 w-24 -translate-x-1/2 rounded-full bg-neutral-800" />
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            Preview
          </div>
        </div>
        <Button disabled>
          <Clapperboard />
          Render video
        </Button>
      </section>

      <aside
        aria-label="Media panel"
        className="flex w-72 shrink-0 flex-col gap-5 overflow-y-auto border-l p-4"
      >
        <PanelSection title="Media collections" />
        <div className="h-full min-h-40 rounded-lg border border-dashed" />
      </aside>
    </div>
  );
}
