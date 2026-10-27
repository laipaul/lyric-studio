// Prints "<build version> <commit>" of the Lyric Studio that answers on this PC right now, "unknown
// unknown" for one started before builds were stamped, or nothing when none is running.
// Used by "Start Lyric Studio.cmd".
try {
  const r = await fetch("http://127.0.0.1:3000/api/health", { signal: AbortSignal.timeout(2000) });
  const h = await r.json();
  console.log(`${h.build ?? "unknown"} ${h.commit ?? "unknown"}`);
} catch {
  // not running
}
