// Our own easing curves (CSS cubic-bezier), so the lyric effects need nothing from Remotion: the HyperFrames text
// layer runs the same effect code in the browser. The standard method: Newton-Raphson on x(t), bisection when
// the slope is too flat; pure and deterministic. Checked against Remotion's Easing.bezier (test/easing.test.ts).
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const ax = 1 - 3 * x2 + 3 * x1;
  const bx = 3 * x2 - 6 * x1;
  const cx = 3 * x1;
  const ay = 1 - 3 * y2 + 3 * y1;
  const by = 3 * y2 - 6 * y1;
  const cy = 3 * y1;
  const x = (t: number) => ((ax * t + bx) * t + cx) * t;
  const y = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const solve = (v: number) => {
    let t = v;
    for (let i = 0; i < 8; i++) {
      const err = x(t) - v;
      if (Math.abs(err) < 1e-7) return t;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = v;
    for (let i = 0; i < 60 && hi - lo > 1e-9; i++) {
      if (x(t) < v) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  if (x1 === y1 && x2 === y2) return (t) => t;
  return (t) => (t <= 0 ? 0 : t >= 1 ? 1 : y(solve(t)));
}
