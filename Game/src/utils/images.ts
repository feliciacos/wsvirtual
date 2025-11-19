// src/utils/images.ts
import { PUBLIC_ROOT_EN, PUBLIC_ROOT_JP } from "../config/constants";
import { splitId } from "./ids";
import type { CardInfo } from "./cards";
import { lookupCardInfo } from "./cards";

export function colorToBorder(color?: string) {
  switch ((color || "").toUpperCase()) {
    case "YELLOW": return "#fbbf24";
    case "GREEN":  return "#34d399";
    case "RED":    return "#fb7185";
    case "BLUE":   return "#60a5fa";
    default:       return "rgba(255,255,255,0.2)";
  }
}

export const ICONS = {
  stand: "/Images/Icons/icon_stand.png",
  rest: "/Images/Icons/icon_rest.png",
  reverse: "/Images/Icons/icon_reverse.png",
} as const;

// Try both E### and ### file names
function sidVariants(code: string): string[] {
  const up = (code || "").toUpperCase();
  const out = new Set<string>([up]);
  const mE = up.match(/^E(\d+)$/);
  if (mE) out.add(mE[1]);
  const mPlain = up.match(/^(\d+)$/);
  if (mPlain) out.add(`E${mPlain[1]}`);
  return Array.from(out);
}

/** Return an ordered list of local image URLs to try (no network URLs). */
export function imageUrlCandidatesFromId(
  id: string,
  catalog?: Record<string, (CardInfo & { __lang?: "EN" | "JP" })>
): string[] {
  const idU = (id || "").toUpperCase();
  const p = splitId(idU);
  if (!p) return [];

  // tolerant metadata lookup (handles S##- stripping, case, unicode punctuation)
  const meta = catalog ? lookupCardInfo(catalog as any, idU) as (CardInfo & { __lang?: "EN" | "JP" }) : undefined;

  const setFolder = `${p.a}_${p.b}`;

  // Prefer explicit SID from metadata if present; fall back to parsed code
  const sidMeta = (meta as any)?.sid ?? (meta as any)?.SID ?? (meta as any)?.Sid;
  const baseSid = String(sidMeta || p.code).toUpperCase();

  // Root priority: card's language hint if present, then JP, then EN
  const roots = [
    (meta as any)?.__lang === "JP" ? PUBLIC_ROOT_JP : PUBLIC_ROOT_EN,
    PUBLIC_ROOT_JP,
    PUBLIC_ROOT_EN,
  ];

  const sids = Array.from(new Set([baseSid, ...sidVariants(baseSid)]));
  const exts = [".png", ".jpg"];

  const urls: string[] = [];
  for (const root of roots) {
    for (const sid of sids) {
      for (const ext of exts) {
        urls.push(`${root}/Images/${setFolder}/${sid}${ext}`);
      }
    }
  }
  // de-dupe while preserving order
  return Array.from(new Set(urls));
}
