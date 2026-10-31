// The theme's extra cards on Reels / TikTok / Shorts (recipe hookCard, endCard; 31 Oct 2026), placed and
// timed by the app, never over a lyric line (pure, browser-safe):
//   hook card  big, in the lyric spot, in the pause right before the first chorus line of the video (at
//              most 2.5 s, at least 0.8 s of pause; no pause = no hook card, said in the plan's notes)
//   end card   the call to action ("Stream A Heart For Two on Spotify"): the last seconds of the video, in
//              the lyric spot once the last line has gone, else above or below the lyrics (the side further
//              from them) while the last line is still on screen; it stays to the very end.
// Both are always planned (with `off` when the theme has them off), so the editor can switch them on in the
// viewer at once; the composition and QA skip a card that is off. Text style: the theme's card style
// (src/picture.ts titleStyleCss), the hook card in the hook font and accent, the end card in the text colour.
import type { LyricLineProps, TextCardProps } from "./props";
import type { TitleStyle } from "./picture";

export const HOOK_CARD_MAX_S = 2.5;
export const HOOK_CARD_MIN_S = 0.8;
export const END_CARD_S = 3.5; // at most this long at the end
export const END_CARD_MIN_S = 1.2; // after the last line, for the lyric spot
export const CARD_KEEP = 60; // frames past the end: the end card never starts fading out

export type ExtraCardLook = { text: string; font: { family: string; weight: number; italic?: boolean }; size: number; colour: string; style: TitleStyle; off: boolean };

export function extraCards(o: {
  lyrics: readonly Pick<LyricLineProps, "startFrame" | "endFrame" | "enterFrame" | "isHook">[];
  fps: number;
  durationInFrames: number;
  area: { top: number; bottom: number; centerY: number };
  titleEndFrame: number; // the title opening's cards are gone by here (0: none)
  hook: ExtraCardLook | null;
  end: ExtraCardLook | null;
}): { cards: TextCardProps[]; notes: string[] } {
  const cards: TextCardProps[] = [];
  const notes: string[] = [];
  const s = (sec: number) => Math.round(sec * o.fps);
  const base = (id: "hook" | "end", l: ExtraCardLook) => ({
    id,
    type: id,
    text: l.text,
    font: l.font.family,
    weight: l.font.weight,
    ...(l.font.italic ? { italic: true } : {}),
    size: l.size,
    colour: l.colour,
    letterSpacing: id === "hook" ? 0.06 : 0.04,
    upper: id === "hook",
    effect: null,
    ...(l.style !== "plain" ? { cardStyle: l.style } : {}),
    ...(l.off ? { off: true } : {}),
  });

  if (o.hook && o.hook.text.trim()) {
    const i = o.lyrics.findIndex((l) => l.isHook);
    if (i < 0) notes.push("Hook card: this video has no chorus line, so no hook card.");
    else {
      const hookIn = o.lyrics[i].enterFrame ?? o.lyrics[i].startFrame;
      const before = Math.max(i > 0 ? o.lyrics[i - 1].endFrame : 0, o.titleEndFrame);
      const from = Math.max(before + 3, hookIn - s(HOOK_CARD_MAX_S));
      const to = hookIn - 2;
      if (to - from >= s(HOOK_CARD_MIN_S)) cards.push({ ...base("hook", o.hook), startFrame: from, endFrame: to, centerY: o.area.centerY });
      else notes.push("Hook card: the chorus follows the line before it with no pause in this video, so no hook card.");
    }
  }

  if (o.end && o.end.text.trim()) {
    const last = o.lyrics[o.lyrics.length - 1];
    const lastEnd = last ? last.endFrame : 0;
    const startAt = Math.max(0, o.durationInFrames - s(END_CARD_S));
    const endFrame = o.durationInFrames + CARD_KEEP;
    if (o.durationInFrames - lastEnd >= s(END_CARD_MIN_S)) {
      cards.push({ ...base("end", o.end), startFrame: Math.max(lastEnd + 4, startAt), endFrame, centerY: o.area.centerY });
    } else {
      // The last line is still on screen: the side of the lyric area further from where the lyrics sit.
      const h = o.area.bottom - o.area.top;
      const above = o.area.centerY - o.area.top >= o.area.bottom - o.area.centerY;
      const centerY = Math.round(above ? o.area.top + h * 0.1 : o.area.bottom - h * 0.1);
      cards.push({ ...base("end", o.end), startFrame: Math.max(o.titleEndFrame, startAt), endFrame, centerY });
    }
  }
  return { cards, notes };
}

// "{title}" and "{artist}" in the end card's text.
export function fillCardText(text: string, song: { title: string; artist: string }): string {
  return text.replace(/\{title\}/gi, song.title).replace(/\{artist\}/gi, song.artist).replace(/\s+/g, " ").trim();
}
