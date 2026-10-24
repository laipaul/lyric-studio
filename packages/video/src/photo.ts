// Photos as shots: a slow Ken Burns move (zoom between 1.00 and 1.12 with a gentle pan), seeded so
// the same seed gives the same move, and stretched over exactly the shot's duration.
export type KenBurns = { fromZoom: number; toZoom: number; fromX: number; fromY: number; toX: number; toY: number };

export const KEN_BURNS = { minZoom: 1, maxZoom: 1.12, panShare: 0.9 } as const;
export const PHOTO_FILE = /\.(jpe?g|png|webp)$/i;

// x/y: offsets as a fraction of the frame. At zoom z the picture overhangs each edge by (z-1)/2, so
// an offset up to that never shows an edge.
export function kenBurns(random: () => number): KenBurns {
  const low = 1 + random() * 0.02;
  const high = 1.08 + random() * (KEN_BURNS.maxZoom - 1.08);
  const zoomIn = random() < 0.5;
  const [fromZoom, toZoom] = zoomIn ? [low, high] : [high, low];
  const dx = random() * 2 - 1;
  const dy = random() * 2 - 1;
  const room = (z: number) => ((z - 1) / 2) * KEN_BURNS.panShare;
  return { fromZoom, toZoom, fromX: dx * room(fromZoom), fromY: dy * room(fromZoom), toX: -dx * room(toZoom), toY: -dy * room(toZoom) };
}

// The move at progress t (0 = first frame of the shot, 1 = last), eased in and out.
export function kenBurnsAt(m: KenBurns, t: number): { zoom: number; x: number; y: number } {
  const e = 0.5 - Math.cos(Math.PI * Math.min(1, Math.max(0, t))) / 2;
  const lerp = (a: number, b: number) => a + (b - a) * e;
  return { zoom: lerp(m.fromZoom, m.toZoom), x: lerp(m.fromX, m.toX), y: lerp(m.fromY, m.toY) };
}
