// src/utils/deckSets.ts
export function extractSetCode(id: string): string | null {
  // e.g. "SFN/S108-001" -> "SFN"; "DAL/W79-TE10" -> "DAL"
  const m = id.toUpperCase().match(/^([A-Z0-9]{1,6})\//);
  return m ? m[1] : null;
}

export function dominantSetFromEntries(
  entries: { id: string; count: number }[]
): string | null {
  const counts = new Map<string, number>();
  for (const { id, count } of entries) {
    const set = extractSetCode(id);
    if (!set) continue;
    counts.set(set, (counts.get(set) || 0) + count);
  }
  let best: string | null = null;
  let max = -1;
  for (const [set, n] of counts) {
    if (n > max) { max = n; best = set; }
  }
  return best;
}
