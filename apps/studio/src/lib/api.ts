// fetch for the studio's own API: when the server does not answer at all (stopped or crashed), a clear
// message instead of the browser's "Failed to fetch"; the cause goes to the browser console.
export const SERVER_DOWN = "Lyric Studio's server isn't responding — restart it with Start Lyric Studio.cmd (what happened is in logs\\lyric-studio.log).";

export async function api(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    console.error(`Lyric Studio: ${init?.method ?? "GET"} ${input} failed`, error);
    throw new Error(SERVER_DOWN);
  }
}
