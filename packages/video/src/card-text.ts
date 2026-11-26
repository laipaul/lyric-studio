// Face words and clothing words in a card's texts (26 Nov 2026, Paul, "Characters tidy-up": on some cards, e.g.
// SomeoneToLove-Character-Female, the Outfit and its three parts held the FACE description, not clothes). Pure, local,
// free: no model call.
//   outfitWarning: "Outfit describes a face, not clothes" when an outfit text names no clothing at all.
//   sortCardText: an outfit text in two piles: what describes clothes (stays in the Outfit) and what describes the face,
//   hair, skin, makeup or age (goes to the card's Notes). Each sentence, and inside a sentence each comma or "and"
//   clause, is sorted on its own; a clause naming neither follows the clause before it.

// Clothes, shoes, accessories and what is worn on the head (a veil, a hat, a tiara) or carried (a bouquet).
const CLOTHING = [
  "outfit", "wear", "wears", "wearing", "worn", "dress", "dresses", "gown", "gowns", "robe", "skirt", "skirts", "trousers", "pants", "jeans", "shorts", "leggings",
  "shirt", "shirts", "t-shirt", "tee", "blouse", "top", "tank", "camisole", "corset", "bodice", "bustier", "sweater", "jumper", "cardigan", "hoodie", "vest",
  "waistcoat", "jacket", "blazer", "coat", "trench", "parka", "cape", "shawl", "scarf", "stole", "suit", "tuxedo", "tux", "tie", "bow-tie", "bowtie", "collar",
  "lapel", "lapels", "cufflinks", "boutonniere", "sleeve", "sleeves", "sleeveless", "strapless", "strap", "straps", "neckline", "v-neck", "hem", "hemline",
  "train", "veil", "tiara", "crown", "hat", "cap", "beanie", "headband", "fascinator", "hairpin", "gloves", "glove", "belt", "sash", "buttons", "button",
  "zip", "zipper", "lace", "satin", "silk", "chiffon", "tulle", "velvet", "linen", "cotton", "denim", "leather", "wool", "knit", "sequins", "sequined", "embroidered",
  "embroidery", "beaded", "pleated", "ruffles", "a-line", "mermaid", "midi", "maxi", "mini", "floor-length", "knee-length", "shoes", "shoe", "heels", "boots",
  "sneakers", "trainers", "sandals", "loafers", "socks", "stockings", "tights", "jewellery", "jewelry", "necklace", "pendant", "earrings", "earring",
  "bracelet", "ring", "rings", "watch", "brooch", "corsage", "bouquet", "bag", "handbag", "clutch", "purse", "glasses", "sunglasses", "uniform", "apron",
  "kimono", "sari", "overalls", "jumpsuit", "romper", "lingerie", "bra", "pyjamas", "pajamas", "swimsuit", "bikini", "fabric", "garment", "clothes",
  "clothing", "attire", "costume",
];
// The face, hair, skin, makeup, body and age: what the face references and the Notes describe.
const FACE = [
  "face", "faces", "facial", "eyes", "eye", "eyebrows", "brows", "lashes", "eyelashes", "nose", "lips", "lip", "mouth", "smile", "smiles", "smiling", "teeth",
  "cheeks", "cheekbones", "cheekbone", "jaw", "jawline", "chin", "forehead", "freckles", "dimples", "skin", "complexion", "tan", "tanned", "pale", "olive",
  "hair", "haired", "hairstyle", "bangs", "fringe", "curls", "curly", "wavy", "straight", "braid", "braids", "ponytail", "bun", "updo", "blonde", "blond",
  "brunette", "redhead", "auburn", "ginger", "beard", "moustache", "mustache", "stubble", "makeup", "make-up", "mascara", "eyeliner", "lipstick", "blush",
  "age", "aged", "years", "year-old", "twenties", "thirties", "forties", "20s", "30s", "40s", "young", "older", "expression", "gaze", "look", "looks", "vibe",
  "features", "ethnicity", "asian", "european", "african", "latina", "latino", "caucasian", "build", "slim", "petite", "tall", "height",
];

const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [];
const has = (text: string, list: readonly string[]) => {
  const w = words(text);
  const set = new Set(list);
  return w.some((x) => set.has(x) || (x.endsWith("s") && set.has(x.slice(0, -1))));
};

export const describesClothes = (text: string | null | undefined): boolean => !!text && has(text, CLOTHING);
export const describesFace = (text: string | null | undefined): boolean => !!text && has(text, FACE);

export const OUTFIT_FACE_WARNING = "Outfit describes a face, not clothes";
// The warning for an outfit text (null: fine, or empty).
export function outfitWarning(text: string | null | undefined): string | null {
  const t = text?.trim();
  if (!t) return null;
  return describesClothes(t) ? null : `${OUTFIT_FACE_WARNING}: move the face and hair words to Notes (Tidy texts does it) and describe the clothes here.`;
}

type Pile = "clothes" | "face" | null;
const pileOf = (clause: string): Pile => (describesClothes(clause) ? "clothes" : describesFace(clause) ? "face" : null);

// The sentences of a text (". ", "; ", line breaks), each split into its clauses (", " and " and ").
const sentences = (text: string) => text.split(/(?<=[.!?;])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
const clauses = (sentence: string) => sentence.replace(/[.!?;]+$/, "").split(/,\s*|\s+and\s+|\s+with\s+(?=(?:long|short|dark|light|blue|green|brown|hazel|grey|gray|full|soft|high|warm|natural)\b)/i).map((c) => c.trim()).filter(Boolean);

const join = (parts: string[]) => {
  const s = parts.join(", ").trim();
  return s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}${/[.!?]$/.test(s) ? "" : "."}` : "";
};

// Sorts a text into clothes and face. Neither: the text is kept as clothes (nothing is lost from the Outfit).
export function sortCardText(text: string | null | undefined): { clothes: string; face: string } {
  const t = text?.trim() ?? "";
  if (!t) return { clothes: "", face: "" };
  const clothes: string[] = [];
  const face: string[] = [];
  for (const s of sentences(t)) {
    const whole = pileOf(s);
    if (whole !== "clothes" || !describesFace(s)) {
      // One kind only (or neither): the sentence as it is.
      (whole === "face" ? face : clothes).push(s.replace(/[.!?;]+$/, ""));
      continue;
    }
    // Both in one sentence: clause by clause.
    const c: string[] = [];
    const f: string[] = [];
    let last: Pile = null;
    for (const cl of clauses(s)) {
      const p: Pile = pileOf(cl) ?? last ?? "clothes";
      (p === "face" ? f : c).push(cl);
      last = p;
    }
    if (c.length) clothes.push(c.join(", "));
    if (f.length) face.push(f.join(", "));
  }
  return { clothes: clothes.map((x) => join([x])).join(" "), face: face.map((x) => join([x])).join(" ") };
}

// Only the clothing part of a split field (close-ups / front / back); "" when it held only face words.
export const clothesOnly = (text: string | null | undefined): string => sortCardText(text).clothes;
