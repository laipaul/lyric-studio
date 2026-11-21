// fetch for the studio's own API: when the server does not answer at all (stopped or crashed), a clear
// message instead of the browser's "Failed to fetch"; the cause goes to the browser console.
export const SERVER_DOWN = "Lyric Studio's server isn't responding — restart it with Start Lyric Studio.cmd (what happened is in logs\\lyric-studio.log).";

export async function api(input: string, init?: RequestInit): Promise<Response> {
  try {
    const r = await fetch(input, init);
    // A saved change to what a song's videos are made from (Storyboard order, Use / Omit, clips, planned slots, singing
    // lines, anchors, the recipe): every open Shape (this tab and other tabs) plans again.
    if (r.ok && (init?.method ?? "GET") !== "GET" && SONG_CHANGE.test(input)) storyChanged();
    return r;
  } catch (error) {
    console.error(`Lyric Studio: ${init?.method ?? "GET"} ${input} failed`, error);
    throw new Error(SERVER_DOWN);
  }
}

// Prepare → Storyboard saved a new story order (clips.json): an open Shape plans again so both show the one order.
export const STORY_ORDER_SAVED = "lyric-story-order-saved";
export const STORY_CHANNEL = "lyric-story"; // the same news for Shape open in another browser tab
const SONG_CHANGE = /\/api\/songs\/[^/]+\/(assets|shotlist|replaced|singer|lyrics|recipe|style)(\?|$)/;

export function storyChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(STORY_ORDER_SAVED));
  try {
    const c = new BroadcastChannel(STORY_CHANNEL);
    c.postMessage(Date.now());
    c.close();
  } catch {
    // an old browser: the other tab plans again when it is shown
  }
}
