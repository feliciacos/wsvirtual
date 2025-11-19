// src/utils/deckParse.ts
import { setKeyFromId } from "./ids";

export const ID_REGEX = /([A-Z0-9]{1,6}\/[A-Z0-9]{1,4}-[A-Z0-9]{1,5})/i;

export function parseDeckTxt(txt: string): { entries: { id: string; count: number }[]; errors: string[] } {
  const lines = txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const map = new Map<string, number>(); const errors: string[] = [];
  for (const raw of lines) {
    if (/^(characters|events|climaxes)\b/i.test(raw)) continue;
    const idm = raw.match(ID_REGEX); if (!idm) continue;
    let id = idm[1].toUpperCase();
    let count = 1;
    const parts = raw.split(/\t+/);
    if (parts.length >= 2 && ID_REGEX.test(parts[0])) {
      const c = parseInt(parts[1], 10); if (!Number.isNaN(c) && c > 0) count = c;
    } else {
      const cm = raw.match(/(^|\s)(\d+)x?\b/i); if (cm) count = parseInt(cm[2], 10);
    }
    if (!id) { errors.push(`Could not parse: "${raw}"`); continue; }
    map.set(id, (map.get(id) ?? 0) + count);
  }
  return { entries: [...map.entries()].map(([id, count]) => ({ id, count })), errors };
}

export function collectSetKeysFromIds(ids: string[]) {
  const keys = new Set<string>();
  for (const id of ids) {
    const k = setKeyFromId(id);
    if (k) keys.add(k);
  }
  return Array.from(keys);
}
