// src/utils/ids.ts
import { PUBLIC_ROOT, PUBLIC_ROOT_EN, PUBLIC_ROOT_JP } from "../config/constants";
import { normalizeCard, CardInfo } from "./cards";

/** Build EN/JP JSON candidates, including common promo suffixes. */
export function jsonUrlsCandidates(setKey: string): Array<{ url: string; lang: "EN" | "JP" }> {
  const suffixes = ["", "_P", "_PR", "_Promos"];
  const make = (root: string, lang: "EN" | "JP") =>
    suffixes.map((sfx) => ({ url: `${root}/Json/${setKey}${sfx}.json`, lang }));
  return [
    ...make(PUBLIC_ROOT_EN, "EN"),
    ...make(PUBLIC_ROOT_JP, "JP"),
  ];
}

/** Examples: TL/W37-E037  <->  TL/W37-037 */
export function codeAliases(code: string): string[] {
  const up = (code || "").toUpperCase();
  const out: string[] = [];
  const mE = up.match(/^(.+)-E(\d+)$/);
  if (mE) out.push(`${mE[1]}-${mE[2]}`);
  const mPlain = up.match(/^(.+)-(\d+)$/);
  if (mPlain) out.push(`${mPlain[1]}-E${mPlain[2]}`);
  return out;
}

/** Robust card-code parser: "DAL/W79-E023" -> parts + "DAL_W79". */
export function splitId(id: string) {
  // Allow hyphens in the "code" part (e.g., BSF2019-01)
  // a: 1-6 A/Z/0-9, b: 1-4 A/Z/0-9, code: 1-20 of A/Z/0-9 or hyphen
  const m = id.match(
    /^(?<a>[A-Z0-9]{1,6})\/(?<b>[A-Z0-9]{1,4})-(?<code>[A-Z0-9-]{1,20})$/i
  );
  if (!m || !m.groups) return null;
  const a = m.groups.a.toUpperCase();
  const b = m.groups.b.toUpperCase();
  const code = m.groups.code.toUpperCase();
  return { a, b, code, setUnd: `${a}_${b}` } as const; // e.g. DAL_W79
}

export function setKeyFromId(id: string) {
  const p = splitId(id);
  return p ? p.setUnd : null;
}

export function jsonUrlsFromSet(setKey: string): [string, string] {
  const file = `${setKey}.json`;
  return [`${PUBLIC_ROOT_EN}/Json/${file}`, `${PUBLIC_ROOT_JP}/Json/${file}`];
}

export function metaUrlFromId(id: string) {
  const p = splitId(id);
  if (!p) return "";
  // /DB-ENG/Meta/DAL_W79/DAL_W79_TE10.json (example)
  return `${PUBLIC_ROOT}/Meta/${p.setUnd}/${p.a}_${p.b}_${p.code}.json`;
}

/** Extract a "code-like" value from any raw card record. */
export function pickCode(raw: any): string {
  const cands = [
    raw?.code, raw?.Code, raw?.cardCode, raw?.CardCode,
    raw?.id, raw?.ID, raw?.number, raw?.Number,
    raw?.card_no, raw?.cardNo, raw?.serial, raw?.Serial,
    raw?.no, raw?.No,
  ];
  const v = cands.find(Boolean);
  return v ? String(v).trim().toUpperCase() : "";
}

/* ============================================================================
 * Canonical ID Normalization (matches most JSON "code" fields)
 *   - Uppercase
 *   - Normalize unicode dashes/slashes
 *   - Collapse dup separators
 *   - Strip optional "/S<digits>-" release segment before SID
 *     e.g. NGL/S58-E024 -> NGL/E024
 *          NGL/S58-BSF2019-01 -> NGL/BSF2019-01
 * ========================================================================== */
export function normalizeCardId(raw: string): string {
  let s = (raw || "").trim().toUpperCase();
  s = s.replace(/[‐–—−-]/gu, "-").replace(/[／]/gu, "/"); // normalize punctuation
  s = s.replace(/-+/g, "-").replace(/\/+/g, "/");         // collapse dup separators
  s = s.replace(/\/S\d+-/i, "/");                         // drop release segment
  return s;
}

/* ============================================================================
 * Catalog Indexer — index all useful aliases for a set into the catalog
 *   Adds: primary, normalized, altWithRelease, altNoRelease, and codeAliases
 *   Optionally tags info with __lang = "EN" | "JP" for image root prioritization
 * ========================================================================== */
export function indexSetIntoCatalog(
  catalog: Record<string, CardInfo>,
  setJson: any[],
  opts?: { lang?: "EN" | "JP" }
) {
  const lang = opts?.lang;

  for (const entry of setJson || []) {
    const info = normalizeCard(entry) as CardInfo & { __lang?: "EN" | "JP" };
    if (lang) info.__lang = lang;

    const primary = normalizeCardId(pickCode(entry)); // tolerant primary
    if (!primary) continue;

    // variants
    const normalized = normalizeCardId(primary);
    const altWithRelease =
      entry.set && entry.release && (entry.sid ?? entry.SID ?? entry.Sid)
        ? `${String(entry.set).toUpperCase()}/${String(entry.release).toUpperCase()}-${String(entry.sid ?? entry.SID ?? entry.Sid).toUpperCase()}`
        : undefined;
    const altNoRelease = primary.replace(/\/S\d+-/i, "/");

    // Also cross-index plain alias forms like TL/W37-037 <-> TL/W37-E037
    const aliasList = codeAliases(primary);

    // Index all keys (duplicates will overwrite with same object)
    if (normalized) catalog[normalized] = info;
    catalog[primary] = info;
    if (altWithRelease) catalog[altWithRelease] = info;
    if (altNoRelease && altNoRelease !== primary) catalog[altNoRelease] = info;
    for (const a of aliasList) catalog[normalizeCardId(a)] = info;
  }
}
// -----------------------------------------------------------------------------
// Helpers for fetching set JSONs and extracting a human-friendly "series name"
// -----------------------------------------------------------------------------

export type Lang = "EN" | "JP";
export type SeriesOption = { key: string; name: string } | null;

/**
 * Try to fetch and parse the JSON for a given setKey.
 * Tries URLs returned by jsonUrlsCandidates(setKey) and respects the requested lang.
 * Returns parsed JSON (any shape) or null if none could be fetched/parsed.
 */
export async function fetchSetJson(setKey: string, lang: Lang = "EN"): Promise<any | null> {
  const cands = jsonUrlsCandidates(setKey);
  for (const cand of cands) {
    if (cand.lang !== lang) continue; // prefer same-lang file candidates
    try {
      const r = await fetch(cand.url, { cache: "force-cache" });
      if (!r.ok) continue;
      const j = await r.json();
      return j;
    } catch {
      // ignore and try next candidate
    }
  }

  // if we got here, try opposite lang as a fallback (useful when only JP/EN exists)
  for (const cand of cands) {
    if (cand.lang === lang) continue;
    try {
      const r = await fetch(cand.url, { cache: "force-cache" });
      if (!r.ok) continue;
      const j = await r.json();
      return j;
    } catch { }
  }

  return null;
}

/**
 * Small heuristic to extract a human-friendly expansion/series name from a set JSON.
 * Many JSONs use keys like: expansion, expansionName, setName, title, name, meta.expansion, etc.
 * Returns { key, name } or null if no useful name is found.
 */
export async function fetchSeriesInfo(setKey: string, lang: Lang = "EN"): Promise<SeriesOption> {
  const j = await fetchSetJson(setKey, lang);
  if (!j) return null;

  // candidate fields (try in order)
  const candPaths = [
    (d: any) => d.expansion,
    (d: any) => d.expansionName,
    (d: any) => d.setName,
    (d: any) => d.title,
    (d: any) => d.name,
    (d: any) => d.metadata?.expansion,
    (d: any) => d.meta?.expansion,
    // some files use top-level object with a map of codes; try the first entry's expansion
    (d: any) => {
      if (Array.isArray(d) && d.length > 0) return d[0].expansion || d[0].expansionName || d[0].setName || d[0].title || d[0].name;
      if (d && typeof d === "object" && !Array.isArray(d)) {
        const first = Object.values(d)[0] as any;
        if (first && typeof first === "object") return first.expansion || first.expansionName || first.setName || first.title || first.name;
      }
      return undefined;
    },
  ];

  for (const fn of candPaths) {
    try {
      const v = fn(j);
      if (v && typeof v === "string" && v.trim()) return { key: setKey, name: v.trim() };
    } catch { /* ignore */ }
  }

  // if nothing found, derive a safe fallback from setKey
  const fallback = setKey.replace(/_/g, " ");
  return { key: setKey, name: fallback };
}

/**
 * Turn an array of known setKeys into a SeriesOption[] by fetching each set
 * and extracting its friendly name. This is ideal when you have a manifest
 * array of available set keys (recommended).
 *
 * Example usage:
 *   const series = await fetchSeriesListFromKeys(["DAL_W79", "5HY_W83"], "EN");
 */
export async function fetchSeriesListFromKeys(setKeys: string[], lang: Lang = "EN"): Promise<SeriesOption[]> {
  const out: SeriesOption[] = [];
  // run sequentially to avoid hammering remote hosts; if you have many keys you
  // can parallelize with Promise.all and some throttling.
  for (const k of setKeys) {
    try {
      const info = await fetchSeriesInfo(k, lang);
      if (info) out.push(info);
    } catch {
      // ignore single failures
    }
  }
  return out;
}
