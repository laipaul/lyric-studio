"use client";

// The Shape stage as one page (Style and Storyboard merged, 31 Oct 2026): the tools column on the left
// (ShapeTools: look, this song, what to make, automatic; the selected shot's details above them) and,
// in the middle from top to bottom, the viewer (the planned video), the soundtrack with its bar lines and
// the lyrics, the shots, and the clips used (drag to reorder, or onto a shot or a lyric line). A recipe
// change is saved at once and the video is planned again; until then the viewer patches the look in.
import { useCallback, useEffect, useRef, useState } from "react";

import { ShapeBoard } from "@/components/shape-board";
import { ShapeTools, type ShapeLook } from "@/components/shape-tools";

export function ShapePage({ projectId }: { projectId: string }) {
  const [look, setLook] = useState<ShapeLook | null>(null);
  const [replan, setReplan] = useState(0);
  const [planned, setPlanned] = useState(0);
  // Several quick changes (dragging the colour picker) plan once.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const requested = useRef(0); // the latest recipe change
  const onSaved = useCallback(() => {
    requested.current += 1;
    const n = requested.current;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setReplan(n), 400);
  }, []);
  // A plan arrived: once it includes the latest change, the tools stop patching the viewer.
  const onPlanned = useCallback((n: number) => {
    if (n === requested.current) setPlanned((k) => k + 1);
  }, []);
  return (
    <ShapeBoard
      projectId={projectId}
      look={look}
      replan={replan}
      onPlanned={onPlanned}
      tools={<ShapeTools projectId={projectId} onLook={setLook} onSaved={onSaved} planned={planned} />}
    />
  );
}
