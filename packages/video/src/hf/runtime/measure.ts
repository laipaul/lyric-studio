// Text measuring for the HyperFrames text layer, done the way the current renderer measures (an inline-block
// span off screen, its width), so a line wraps at the same word in both. The bundler maps
// "@remotion/layout-utils" to this file for the text layer only.
type Measure = { text: string; fontFamily?: string; fontSize: number | string; fontWeight?: number | string; letterSpacing?: string; additionalStyles?: Record<string, string> };
const cache = new Map<string, { width: number; height: number }>();
export function measureText(m: Measure): { width: number; height: number } {
  const key = `${m.text}-${m.fontFamily}-${m.fontWeight}-${m.fontSize}-${m.letterSpacing}-${JSON.stringify(m.additionalStyles)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const node = document.createElement("span");
  if (m.fontFamily) node.style.fontFamily = m.fontFamily;
  node.style.display = "inline-block";
  node.style.position = "absolute";
  node.style.top = "-10000px";
  node.style.whiteSpace = "pre";
  node.style.fontSize = typeof m.fontSize === "string" ? m.fontSize : `${m.fontSize}px`;
  for (const [k, v] of Object.entries(m.additionalStyles ?? {})) (node.style as unknown as Record<string, string>)[k] = v;
  if (m.fontWeight) node.style.fontWeight = String(m.fontWeight);
  if (m.letterSpacing) node.style.letterSpacing = m.letterSpacing;
  node.innerText = m.text;
  document.body.appendChild(node);
  const box = node.getBoundingClientRect();
  document.body.removeChild(node);
  const out = { width: box.width, height: box.height };
  cache.set(key, out);
  return out;
}
