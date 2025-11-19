// src/utils/manifest.ts
import { PUBLIC_ROOT_EN, PUBLIC_ROOT_JP } from "../config/constants";

export type ManifestEntry = {
  key: string;
  name: string;
  file: string;
  lang?: "EN" | "JP";
  year?: number;
  [k: string]: any;
};

const manifestCache: Record<"EN" | "JP", ManifestEntry[] | null> = {
  EN: null,
  JP: null,
};

async function fetchManifest(lang: "EN" | "JP"): Promise<ManifestEntry[]> {
  if (manifestCache[lang]) return manifestCache[lang]!;
  const root = lang === "JP" ? PUBLIC_ROOT_JP : PUBLIC_ROOT_EN;
  const url = `${root.replace(/\/$/, "")}/sets-manifest.json`;

  try {
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) {
      manifestCache[lang] = [];
      return [];
    }
    const j = await res.json();
    // Normalize shape: prefer entries with key + name
    const arr: ManifestEntry[] = Array.isArray(j)
      ? j.map((e: any) => ({
          key: String(e.key || e.set || e.id || "").toUpperCase(),
          name: String(e.name || e.title || e.series || ""),
          file: String(e.file || e.filename || ""),
          lang: (e.lang || lang) as any,
          year: e.year ? Number(e.year) : undefined,
          ...e,
        }))
      : [];
    manifestCache[lang] = arr;
    return arr;
  } catch (err) {
    // swallow and return empty list
    manifestCache[lang] = [];
    return [];
  }
}

/**
 * Search the manifest for series entries.
 * - lang: "EN" | "JP"
 * - query: optional substring; case-insensitive matched against key & name
 * - limit: max results
 */
export async function fetchSeriesListFromManifest(
  lang: "EN" | "JP",
  query?: string,
  limit = 100
): Promise<ManifestEntry[]> {
  const manifest = await fetchManifest(lang);
  if (!query || !query.trim()) {
    return manifest.slice(0, limit);
  }
  const q = query.trim().toLowerCase();
  const out = manifest.filter((m) => {
    if (!m) return false;
    const key = (m.key || "").toString().toLowerCase();
    const name = (m.name || "").toString().toLowerCase();
    return key.includes(q) || name.includes(q);
  });
  return out.slice(0, limit);
}

/**
 * Get a single manifest entry by setKey (case-insensitive).
 */
export async function getSetManifestEntry(
  setKey: string,
  lang?: "EN" | "JP"
): Promise<ManifestEntry | undefined> {
  const k = (setKey || "").toString().toUpperCase();
  if (lang) {
    const m = await fetchManifest(lang);
    return m.find((e) => (e.key || "").toUpperCase() === k);
  }
  // search EN then JP
  const en = await fetchManifest("EN");
  const foundEn = en.find((e) => (e.key || "").toUpperCase() === k);
  if (foundEn) return foundEn;
  const jp = await fetchManifest("JP");
  return jp.find((e) => (e.key || "").toUpperCase() === k);
}

/**
 * Small helper to clear cache (useful in dev)
 */
export function clearManifestCache() {
  manifestCache.EN = null;
  manifestCache.JP = null;
}
