// Render worker. For now it only starts and stays alive.
// Later steps will poll RenderJob rows and render them with Remotion.

console.log("worker ready");

// Keep the process alive until it is stopped (Ctrl+C).
const heartbeat = setInterval(() => {}, 60_000);

function shutdown() {
  clearInterval(heartbeat);
  console.log("worker stopped");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
