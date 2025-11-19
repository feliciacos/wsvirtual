// src/utils/cards.ts

/* ========================================================================== */
/* Types                                                                      */
/* ========================================================================== */

export type ZoneKey =
  | "CENTER_L" | "CENTER_C" | "CENTER_R"
  | "BACK_L" | "BACK_R"
  | "CLIMAX" | "LEVEL" | "CLOCK"
  | "STOCK" | "WAITING_ROOM" | "MEMORY"
  | "DECK" | "HAND"
  | "DECK_TEMP";

export type Card = {
  uid: string;
  id: string;
  name?: string;
  rot?: 0 | 90 | 180;
  marks?: number;
};

export type CardInfo = {
  name?: string;
  level?: number | string;
  cost?: number | string;
  power?: number | string;
  soul?: number | string;
  trigger?: string | string[];
  color?: string;
  traits?: string[] | string;
  text?: string;
  effect?: string;
  sid?: string;
  attributes?: string[] | string;
  ability?: string[];
  type?: string;
  [k: string]: any;
};

/* ========================================================================== */
/* Helpers used around the app                                                */
/* ========================================================================== */

export const isStage = (z: ZoneKey) =>
  z === "CENTER_L" || z === "CENTER_C" || z === "CENTER_R" || z === "BACK_L" || z === "BACK_R";

export function colorToBorder(color?: string) {
  switch ((color || "").toUpperCase()) {
    case "YELLOW": return "#fbbf24";
    case "GREEN":  return "#34d399";
    case "RED":    return "#fb7185";
    case "BLUE":   return "#60a5fa";
    default:       return "rgba(255,255,255,0.2)";
  }
}

export function isClimaxMeta(meta?: CardInfo | null) {
  if (!meta) return false;
  const t = (meta.type ?? "") + "";
  if (/climax/i.test(t)) return true;
  const attrs = meta.attributes;
  if (Array.isArray(attrs)) return attrs.some(a => /climax/i.test(String(a)));
  if (typeof attrs === "string") return /climax/i.test(attrs);
  return false;
}

/* ========================================================================== */
/* ID NORMALIZATION & ALIAS LOOKUP                                            */
/* ========================================================================== */

/**
 * Normalize a raw ID to a consistent style most DB JSONs use.
 * - Uppercase
 * - Normalize unicode dashes/slashes
 * - Collapse duplicate separators
 * - Strip optional "/S<digits>-" block before the SID when followed by E###.
 *   (e.g. "NGL/S58-E024" -> "NGL/E024")
 */
export function normalizeCardId(raw: string): string {
  let s = (raw || "").trim().toUpperCase();

  // normalize unicode variants
  s = s
    .replace(/[‐–—−-]/g, "-") // dashes → hyphen
    .replace(/[／]/g, "/");   // full-width slash → ascii

  // collapse accidental duplicates
  s = s.replace(/-+/g, "-").replace(/\/+/g, "/");

  // optional release segment when the next code is E###
  s = s.replace(/\/S\d+-(?=E\d+\b)/i, "/");

  return s;
}

/**
 * Create reasonable alias candidates for a code so print variants resolve:
 *   - strip suffix letters (S, P, R, SR, PR, etc.) after the number
 *   - map TD prints (-T02R) → -T02, and also try main sequence (-002)
 *   - try padded/unpadded number variants (017 ↔ 17)
 */
function codeAliasesForLookup(id: string): string[] {
  const up = normalizeCardId(id);

  // AAA/BBBB-<T?>NNN<letters?>
  const m = up.match(/^([A-Z0-9]{1,6}\/[A-Z0-9]{1,4})-([T]?)(\d+)([A-Z]+)?$/);
  if (!m) return [];

  const set = m[1];        // e.g. NIK/S117
  const t = m[2];          // "" or "T"
  const num = m[3];        // "017", "2", …
  const suf = m[4] || "";  // "S","P","R","SR","PR",…

  const nInt = parseInt(num, 10);
  const pad3 = nInt.toString().padStart(3, "0");
  const pad2 = nInt.toString().padStart(2, "0");
  const noPad = `${nInt}`;

  const out = new Set<string>();

  // exact (already tried by caller, but keep for completeness)
  out.add(`${set}-${t}${num}${suf}`);

  // strip suffix letters
  if (suf) {
    out.add(`${set}-${t}${num}`);
    out.add(`${set}-${t}${pad3}`);
  }

  // TD prints: -T02R → -T02
  if (t === "T" && suf) {
    out.add(`${set}-T${num}`);
    out.add(`${set}-T${pad2}`);
  }

  // some DBs index TDs under the main numeric sequence
  if (t === "T") {
    out.add(`${set}-${num}`);
    out.add(`${set}-${pad3}`);
  }

  // number padding variants
  out.add(`${set}-${t}${noPad}`);
  out.add(`${set}-${t}${pad3}`);

  return Array.from(out);
}

/**
 * Safe lookup that tries:
 *   1) normalized exact,
 *   2) raw uppercase,
 *   3) alias candidates (handles -017S / -001P / -T02R, etc.)
 */
export function lookupCardInfo(
  catalog: Record<string, CardInfo>,
  rawId: string
): CardInfo | undefined {
  if (!rawId) return undefined;
  const norm = normalizeCardId(rawId);
  if (catalog[norm]) return catalog[norm];
  const upper = rawId.toUpperCase();
  if (catalog[upper]) return catalog[upper];

  for (const alt of codeAliasesForLookup(rawId)) {
    const hit = catalog[alt];
    if (hit) return hit;
  }
  return undefined;
}

/* ========================================================================== */
/* CARD RECORD NORMALIZATION (fields)                                         */
/* ========================================================================== */

export function normalizeCard(raw: any): CardInfo & { code?: string } {
  const name   = raw?.name ?? raw?.Name ?? raw?.cardName ?? raw?.CardName;
  const level  = raw?.level ?? raw?.Level;
  const cost   = raw?.cost ?? raw?.Cost;
  const power  = raw?.power ?? raw?.Power;
  const soul   = raw?.soul ?? raw?.Soul;
  const color  = (raw?.color ?? raw?.Color ?? raw?.colour ?? raw?.Colour) as string | undefined;

  let trigger = raw?.trigger ?? raw?.Trigger ?? raw?.triggers ?? raw?.Triggers;
  if (typeof trigger === "string" && trigger.includes(",")) {
    trigger = trigger.split(",").map((x: string) => x.trim());
  }

  let attributes =
    raw?.attributes ?? raw?.Attributes ?? raw?.traits ?? raw?.Traits ?? raw?.attribute ?? raw?.Attribute;

  if (typeof attributes === "string") {
    // split on comma or middle-dot bullet (U+00B7)
    attributes = attributes
      .split(/\s*\u00B7\s*|,\s*/u)
      .map((x: string) => x.trim())
      .filter(Boolean);
  }

  const ability =
    raw?.ability ?? raw?.Ability ?? raw?.textLines ?? raw?.TextLines ??
    (raw?.text ? [raw.text] : raw?.Text ? [raw.Text] : undefined);

  const text = raw?.text ?? raw?.Text ?? raw?.effect ?? raw?.Effect;
  const type = raw?.type ?? raw?.Type;

  const sid  = raw?.sid ?? raw?.SID ?? raw?.Sid;

  return { name, level, cost, power, soul, trigger, color, attributes, ability, text, type, sid } as CardInfo;
}

/* ========================================================================== */
/* Misc                                                                        */
/* ========================================================================== */

export function shuffle<T>(a: T[]) {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
