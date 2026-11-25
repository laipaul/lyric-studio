// Realism rules (25 Nov 2026, from two AI-realism tutorials Paul shared; doc "AI realism workflow vs Lyric Studio").
// The app, not Paul, knows what makes a generated clip look filmed instead of generated: subtle believable movement,
// real skin, natural light, a camera with weight, and a short list of things to avoid (exaggerated acting, plastic
// skin, fast or shaky camera, morphing faces, extra people, text). These words go into every Animate and singing
// request, hidden; Paul never types them. A Film look picks the feel: "natural" (default, true to life) or "dreamy"
// (soft and poetic, for Midjourney art that is not meant to look like a photo). Each take keeps the feel it was sent
// with (Take.feel), so a later change remakes nothing, and a take recorded before this rule keeps its old prompt.

export const FEELS = ["natural", "dreamy"] as const;
export type Feel = (typeof FEELS)[number];
export const DEFAULT_FEEL: Feel = "natural";
export const isFeel = (v: unknown): v is Feel => typeof v === "string" && (FEELS as readonly string[]).includes(v);
export const FEEL_LABEL: Record<Feel, string> = { natural: "Natural (true to life)", dreamy: "Dreamy (soft, poetic)" };

// Avoid list shared by both feels: what gives an AI clip away. (Animate's own prompt already says one shot, no cuts,
// no text; singing adds NO_TEXT, so the frame stays clean for the Theme's lyrics.)
const AVOID_COMMON = "morphing or melting faces and hands, extra people appearing, fast or shaky camera moves, sudden zooms";
const NO_TEXT = "text, captions, subtitles, logos";

// For Animate (image-to-video).
export function realismRules(feel: Feel): string {
  if (feel === "dreamy")
    return (
      "Soft, dreamlike and poetic, true to the picture's own style: slow floating movement, gentle light, calm and subtle expressions. " +
      `Avoid: exaggerated or cartoonish expressions, ${AVOID_COMMON}.`
    );
  return (
    "True to life, as if filmed on a real camera: real skin texture with fine detail, natural light, subtle and believable expressions " +
    "(small movements of the eyes, brow and breath), a camera with real weight that moves slowly and smoothly. " +
    `Avoid: exaggerated or cartoonish expressions, plastic or CGI-looking skin, ${AVOID_COMMON}.`
  );
}

// For singing (lipsync). The singing cue asks for big singing mouths on purpose (Paul, 21 Nov 2026), so these rules
// never say "subtle expressions": only the look of the person and what must not appear.
export function singingRealism(feel: Feel): string {
  if (feel === "dreamy") return `Soft, dreamlike light, true to the picture's own style. Avoid: ${AVOID_COMMON}, ${NO_TEXT}`;
  return `A real person filmed on a real camera: real skin texture, natural light, believable movement. Avoid: plastic or CGI-looking skin, cartoonish faces, ${AVOID_COMMON}, ${NO_TEXT}`;
}
