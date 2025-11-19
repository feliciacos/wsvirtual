// src/components/ui/ImportDeckCustom.tsx
import React from "react";
import { DECK_MAX } from "../../config/constants";

export type Entry = { id: string; count: number };
type Lang = "EN" | "JP";
type SeriesOption = { key: string; name: string };

type CardShape = {
  id?: string;
  code?: string;
  Code?: string;
  name?: string;
  type?: string;
  level?: number | string;
  color?: string;
  attributes?: string[];
  image?: string;
  [k: string]: any;
};

/**
 * ImportDeckCustom
 *
 * - fetchSeries(lang, query, limit) => returns series manifest
 * - fetchSetCards(setKey, lang) => returns array or map of cards
 *
 * Important behavior:
 * - Keeps selection state locally and emits `onChange({ entries, raw, name })`.
 * - Writes the same `raw` text into the parent textarea (selected heuristically or via `externalTextAreaSelector`)
 *   and dispatches input/change/keyup so the parent re-parses and updates the Ready button.
 *
 * Fixes included:
 * - Disables "+" buttons for all cards when deck is full (no increments allowed that would exceed DECK_MAX).
 * - Prevents adding more than 8 climax cards.
 * - Defensive checks inside the state updater to avoid race conditions.
 *
 * Visual & behavior fixes (2025-11-19):
 * - The series dropdown is now absolutely positioned (overlays page, does not push content).
 * - Dropdown limited to ~20 entries (maxHeight: 400px) and sits just under the search input.
 * - Use live `lang` state for fetches so DB-ENG/DB-JP selection doesn't revert on focus/search.
 */
export default function ImportDeckCustom(props: {
  fetchSeries: (lang: Lang, query?: string, limit?: number) => Promise<Array<SeriesOption> | undefined>;
  fetchSetCards: (setKey: string, lang: Lang) => Promise<CardShape[] | Record<string, CardShape> | undefined>;
  onChange: (payload: { entries: Entry[]; raw: string; name: string }) => void;
  initialLang?: Lang;
  deckMax?: number;
  initialDeckName?: string;
  externalTextAreaSelector?: string;
}) {
  const {
    fetchSeries,
    fetchSetCards,
    onChange,
    initialLang = "EN",
    deckMax = DECK_MAX,
    initialDeckName = "",
    externalTextAreaSelector
  } = props;

  // stable refs to callbacks
  const fetchSeriesRef = React.useRef(fetchSeries);
  const fetchSetCardsRef = React.useRef(fetchSetCards);
  React.useEffect(() => { fetchSeriesRef.current = fetchSeries; }, [fetchSeries]);
  React.useEffect(() => { fetchSetCardsRef.current = fetchSetCards; }, [fetchSetCards]);

  // language ref + state
  const langRef = React.useRef<Lang>(initialLang);
  const [lang, setLang] = React.useState<Lang>(initialLang);
  React.useEffect(() => { langRef.current = lang; }, [lang]);

  // UI state
  const [seriesQuery, setSeriesQuery] = React.useState("");
  const [seriesOptions, setSeriesOptions] = React.useState<SeriesOption[]>([]);
  const [loadingSeries, setLoadingSeries] = React.useState(false);
  const [seriesDropdownOpen, setSeriesDropdownOpen] = React.useState(false);

  const [selectedSeries, setSelectedSeries] = React.useState<SeriesOption[]>([]);
  const [loadingSets, setLoadingSets] = React.useState<Record<string, boolean>>({});
  const [loadedSets, setLoadedSets] = React.useState<Record<string, any>>({});

  const [deckName, setDeckName] = React.useState<string>(initialDeckName);
  React.useEffect(() => { setDeckName(initialDeckName); }, [initialDeckName]);

  // filters
  const [textQuery, setTextQuery] = React.useState("");
  const [typeFilters, setTypeFilters] = React.useState<Record<string, boolean>>({ Character: true, Event: true, Climax: true });
  const [levelFilters, setLevelFilters] = React.useState<Record<number, boolean>>({ 0: true, 1: true, 2: true, 3: true });
  const colorOptions = ["YELLOW", "GREEN", "RED", "BLUE", "PURPLE"];
  const [colorFilters, setColorFilters] = React.useState<Record<string, boolean>>(() =>
    colorOptions.reduce((acc, c) => ({ ...acc, [c]: true }), {} as Record<string, boolean>)
  );
  const [traitFilters, setTraitFilters] = React.useState<Record<string, boolean>>({});

  // selection map: id -> count
  const [selection, setSelection] = React.useState<Record<string, number>>({});
  const selectionRef = React.useRef(selection);
  React.useEffect(() => { selectionRef.current = selection; }, [selection]);

  // results UI
  const [resultsOpen, setResultsOpen] = React.useState(true);
  const [activeTab, setActiveTab] = React.useState<"Type" | "Level" | "Color" | "Traits">("Type");

  // refs for UI containers
  const seriesRef = React.useRef<HTMLDivElement | null>(null);
  const resultsRef = React.useRef<HTMLDivElement | null>(null);
  const resultsScrollRef = React.useRef<HTMLDivElement | null>(null);

  // --- series search (debounced) ---
  React.useEffect(() => {
    let cancelled = false;
    const q = (seriesQuery || "").trim();
    if (!q) { setLoadingSeries(false); return; }
    setLoadingSeries(true);
    const t = window.setTimeout(() => {
      (async () => {
        try {
          // use live lang state (avoid stale ref closures)
          const res = await fetchSeriesRef.current(lang, q, 200);
          if (cancelled) return;
          setSeriesOptions(res ?? []);
          setSeriesDropdownOpen(true);
        } catch {
          if (!cancelled) setSeriesOptions([]);
        } finally { if (!cancelled) setLoadingSeries(false); }
      })();
    }, 260);
    return () => { cancelled = true; clearTimeout(t); };
  }, [seriesQuery, lang]);

  // load sets for selected series
  React.useEffect(() => {
    let mounted = true;
    const loadSet = async (opt: SeriesOption) => {
      if (loadedSets[opt.key]) return;
      setLoadingSets(s => ({ ...s, [opt.key]: true }));
      try {
        // use live lang state here too
        const cards = await fetchSetCardsRef.current(opt.key, lang);
        if (!mounted) return;
        setLoadedSets(prev => {
          const prevVal = prev[opt.key];
          const newVal = cards ?? [];
          try {
            const prevLen = Array.isArray(prevVal) ? prevVal.length : prevVal ? Object.keys(prevVal).length : 0;
            const newLen = Array.isArray(newVal) ? newVal.length : newVal ? Object.keys(newVal).length : 0;
            if (prevLen === newLen && JSON.stringify(prevVal) === JSON.stringify(newVal)) return prev;
          } catch { /* ignore */ }
          return { ...prev, [opt.key]: newVal };
        });
      } catch {
        if (mounted) setLoadedSets(prev => ({ ...prev, [opt.key]: [] }));
      } finally {
        if (mounted) setLoadingSets(s => ({ ...s, [opt.key]: false }));
      }
    };

    selectedSeries.forEach(s => void loadSet(s));
    return () => { mounted = false; };
  }, [selectedSeries, loadedSets, lang]);

  // scroll top when sets load
  React.useEffect(() => {
    if (selectedSeries.length === 0) return;
    const anyLoaded = selectedSeries.some(s => {
      const v = loadedSets[s.key];
      if (!v) return false;
      if (Array.isArray(v)) return v.length > 0;
      if (v && typeof v === "object") return Object.keys(v).length > 0;
      return false;
    });
    if (anyLoaded) {
      try { if (resultsScrollRef.current) resultsScrollRef.current.scrollTop = 0; } catch {}
    }
  }, [loadedSets, selectedSeries]);

  // prune loadedSets when series removed
  React.useEffect(() => {
    const keep = new Set(selectedSeries.map(s => s.key));
    setLoadedSets(prev => {
      const keys = Object.keys(prev);
      const next: Record<string, any> = {};
      let changed = false;
      for (const k of keys) {
        if (keep.has(k)) next[k] = prev[k];
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [selectedSeries]);

  // allCards merged
  const allCards = React.useMemo(() => {
    const out: CardShape[] = [];
    for (const v of Object.values(loadedSets)) {
      if (!v) continue;
      if (Array.isArray(v)) out.push(...(v as CardShape[]));
      else if (typeof v === "object") {
        try { out.push(...(Object.values(v as Record<string, any>) as CardShape[])); } catch {}
      }
    }
    return out;
  }, [loadedSets]);

  // update trait filters when cards change
  React.useEffect(() => {
    const traits = new Set<string>();
    allCards.forEach(c => (c.attributes || []).forEach(a => traits.add(String(a))));
    const nextObj: Record<string, boolean> = {};
    Array.from(traits).sort().forEach(t => { nextObj[t] = traitFilters[t] ?? false; });

    const prevKeys = Object.keys(traitFilters);
    const nextKeys = Object.keys(nextObj);
    const same = prevKeys.length === nextKeys.length && prevKeys.every(k => nextObj.hasOwnProperty(k) && traitFilters[k] === nextObj[k]);
    if (!same) setTraitFilters(nextObj);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allCards]);

  // image candidate builder
  const buildImageCandidates = React.useCallback((c: CardShape, langLocal: Lang) => {
    const candidates: string[] = [];
    if (c.image && typeof c.image === "string" && c.image.trim()) candidates.push(c.image);

    const rawId = (c.id || c.code || c.Code || "").toString().trim();
    if (!rawId) return candidates;

    let folder = "";
    let filename = "";

    if (rawId.includes("/")) {
      const [prefix, rest] = rawId.split("/", 2);
      const restParts = rest.split("-");
      const partAfterSlash = restParts[0] || rest;
      folder = `${prefix}_${partAfterSlash}`;
      if (restParts.length > 1) filename = restParts.slice(1).join("-");
      else filename = rest;
    } else {
      const dashParts = rawId.split("-");
      if (dashParts.length >= 2) {
        folder = dashParts[0];
        filename = dashParts.slice(1).join("-");
      } else {
        folder = rawId;
        filename = rawId;
      }
    }

    folder = folder.replace(/\s+/g, "");
    filename = filename.replace(/\s+/g, "");

    const dbLang = langLocal === "EN" ? "ENG" : "JP";
    const dbAltLang = langLocal === "EN" ? "JP" : "ENG";

    if (folder && filename) {
      candidates.push(`/DB-${dbLang}/Images/${folder}/${filename}.png`);
      candidates.push(`/DB-${dbLang}/Images/${folder}/${filename}.jpg`);
      const folderAlt = folder.includes("_") ? folder.split("_")[0] + "_" + (folder.split("_")[1] || "") : folder;
      candidates.push(`/DB-${dbLang}/Images/${folderAlt}/${filename}.png`);
      candidates.push(`/DB-${dbLang}/Images/${folderAlt}/${filename}.jpg`);
      candidates.push(`/DB-${dbAltLang}/Images/${folder}/${filename}.png`);
      candidates.push(`/DB-${dbAltLang}/Images/${folder}/${filename}.jpg`);
    }

    candidates.push(`/DB-${dbLang}/Images/${rawId}.png`);
    candidates.push(`/DB-${dbLang}/Images/${rawId}.jpg`);
    candidates.push(`/DB-${dbAltLang}/Images/${rawId}.png`);
    candidates.push(`/DB-${dbAltLang}/Images/${rawId}.jpg`);

    const uniq: string[] = [];
    const seen = new Set<string>();
    for (const s of candidates) {
      if (!s) continue;
      if (!seen.has(s)) { seen.add(s); uniq.push(s); }
    }
    return uniq;
  }, []);

  // filtered cards according to filters
  const filteredCards = React.useMemo(() => {
    const q = (textQuery || "").trim().toLowerCase();
    const checkedTraits = Object.keys(traitFilters).filter(k => traitFilters[k]);

    return allCards.filter(c => {
      if (!c) return false;
      const id = (c.id || c.code || c.Code || "").toString();
      if (!id && !c.name) return false;
      if (q) {
        const hay = `${(c.name ?? "")} ${id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      const typ = String(c.type || "").toLowerCase();
      if (typ.includes("character") && !typeFilters.Character) return false;
      if (typ.includes("event") && !typeFilters.Event) return false;
      if ((typ.includes("climax") || /(^cx$|^cx\b|climax)/i.test(String(c.type || ""))) && !typeFilters.Climax) return false;
      const lvl = Number.isFinite(Number(c.level)) ? Number(c.level) : 0;
      if (!levelFilters[lvl]) return false;
      const colorRaw = String(c.color || "").replace(/\s+/g, "");
      const colorKey = colorRaw ? colorRaw.toUpperCase() : "";
      if (colorKey && !colorFilters[colorKey]) return false;
      if (checkedTraits.length > 0) {
        const attrs = (c.attributes || []).map(a => String(a).toLowerCase());
        if (!checkedTraits.some(t => attrs.includes(t.toLowerCase()))) return false;
      }
      return true;
    });
  }, [allCards, textQuery, typeFilters, levelFilters, colorFilters, traitFilters]);

  // derived totals from selection
  const totalSelected = React.useMemo(() => Object.values(selection).reduce((s, n) => s + n, 0), [selection]);
  const totalClimaxSelected = React.useMemo(() => {
    let sum = 0;
    for (const [id, cnt] of Object.entries(selection)) {
      const card = allCards.find(c => (c.id || c.code || c.Code) === id);
      if (!card) continue;
      const isClimax = (/climax/i.test(String(card.type || "")) || (card.attributes || []).some(a => /climax/i.test(String(a))));
      if (isClimax) sum += cnt;
    }
    return sum;
  }, [selection, allCards]);

  // find parent textarea (heuristic)
  const findParentTextarea = React.useCallback((): HTMLTextAreaElement | null => {
    try {
      const candidates = [
        externalTextAreaSelector,
        "#importDeckTextarea",
        "textarea#importDeckTextarea",
        "textarea#deck-code",
        "textarea.import-deck-textarea",
        "textarea[name='import_deck_text']",
        "textarea"
      ].filter(Boolean) as string[];

      for (const sel of candidates) {
        if (!sel) continue;
        const el = document.querySelector(sel) as HTMLTextAreaElement | null;
        if (el && el.tagName && el.tagName.toLowerCase() === "textarea") return el;
      }

      const all = Array.from(document.querySelectorAll("textarea")) as HTMLTextAreaElement[];
      if (all.length === 0) return null;
      let best: HTMLTextAreaElement | null = null;
      let bestArea = 0;
      for (const t of all) {
        try {
          const r = t.getBoundingClientRect();
          const area = Math.max(0, r.width) * Math.max(0, r.height);
          if (area > bestArea) { bestArea = area; best = t; }
        } catch { /* ignore */ }
      }
      return best;
    } catch {
      return null;
    }
  }, [externalTextAreaSelector]);

  // build human-friendly raw + entries
  const buildRawAndEntries = React.useCallback((sel: Record<string, number>, deckNameLocal?: string) => {
    const entries: Entry[] = Object.entries(sel).map(([id, count]) => ({ id, count }));
    const selectedCards = Object.entries(sel).map(([id, count]) => {
      const card = allCards.find(c => (c.id || c.code || c.Code) === id) ?? { id, name: "", type: "" };
      return { id, count, card };
    });

    const group = { character: [] as any[], event: [] as any[], climax: [] as any[] };

    selectedCards.forEach(s => {
      const t = String(s.card.type || "").toLowerCase();
      if (t.includes("character")) group.character.push(s);
      else if (t.includes("event")) group.event.push(s);
      else if (t.includes("climax")) group.climax.push(s);
      else {
        const attrs = (s.card.attributes || []).map((a: any) => String(a).toLowerCase());
        if (attrs.some(a => /climax/i.test(a))) group.climax.push(s);
        else if (attrs.some(a => /event/i.test(a))) group.event.push(s);
        else group.character.push(s);
      }
    });

    const lines: string[] = [];
    lines.push(deckNameLocal ?? deckName ?? "");
    const writeGroup = (title: string, items: { id: string; count: number; card: any }[]) => {
      if (!items || items.length === 0) return;
      lines.push(title);
      items.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      items.forEach(it => {
        const name = it.card.name ?? "";
        lines.push(`${it.id}\t${it.count}\t${name}`);
      });
    };

    writeGroup("Characters", group.character);
    writeGroup("Events", group.event);
    writeGroup("Climaxes", group.climax);

    const raw = lines.join("\n");
    return { entries, raw, name: deckNameLocal ?? deckName ?? "" };
  }, [allCards, deckName]);

  // write raw to parent textarea and dispatch events
  const writeRawToParentTextarea = React.useCallback((raw: string) => {
    try {
      const ta = findParentTextarea();
      if (!ta) return false;
      const proto = Object.getPrototypeOf(ta);
      const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
      if (descriptor && descriptor.set) {
        descriptor.set.call(ta, raw);
      } else {
        (ta as any).value = raw;
      }

      setTimeout(() => {
        try {
          const inputEv = new InputEvent("input", { bubbles: true, composed: true });
          ta.dispatchEvent(inputEv);
          const changeEv = new Event("change", { bubbles: true, composed: true });
          ta.dispatchEvent(changeEv);
          const keyEv = new KeyboardEvent("keyup", { bubbles: true });
          ta.dispatchEvent(keyEv);
        } catch { /* ignore */ }
      }, 0);

      return true;
    } catch {
      return false;
    }
  }, [findParentTextarea]);

  // emit selection (notify parent and write raw)
  const emitSelectionChange = React.useCallback((sel: Record<string, number>, deckNameLocal?: string) => {
    const { entries, raw, name } = buildRawAndEntries(sel, deckNameLocal);
    onChange({ entries, raw, name });
    writeRawToParentTextarea(raw);
  }, [buildRawAndEntries, onChange, writeRawToParentTextarea]);

  // increment: defensive checks inside updater to prevent exceeding deckMax and climax limit
  const increment = React.useCallback((card: CardShape) => {
    const id = (card.id || card.code || card.Code || "").toString();
    if (!id) return;

    setSelection(prev => {
      const cur = prev[id] || 0;
      if (cur >= 4) return prev; // per-card cap

      // compute totals from prev (defensive/race-safe)
      const totalNow = Object.values(prev).reduce((a, b) => a + b, 0);
      if (totalNow >= deckMax) {
        // deck already full — no increment allowed (even for existing card) because it would exceed deckMax
        return prev;
      }

      const isClimax = (/climax/i.test(String(card.type || "")) || (card.attributes || []).some(a => /climax/i.test(String(a))));
      if (isClimax) {
        const totalClimaxNow = Object.entries(prev).reduce((acc, [k, v]) => {
          const c = allCards.find(x => (x.id || x.code || x.Code) === k);
          if (!c) return acc;
          if (/climax/i.test(String(c.type || "")) || (c.attributes || []).some(a => /climax/i.test(String(a)))) return acc + v;
          return acc;
        }, 0);
        if (totalClimaxNow >= 8) return prev; // climax cap
      }

      const next = { ...prev, [id]: Math.min((prev[id] || 0) + 1, 4) };
      emitSelectionChange(next);
      return next;
    });
  }, [allCards, deckMax, emitSelectionChange]);

  // decrement
  const decrement = React.useCallback((id: string) => {
    setSelection(prev => {
      const cur = prev[id] || 0;
      if (cur <= 0) return prev;
      const copy = { ...prev };
      if (cur === 1) delete copy[id];
      else copy[id] = cur - 1;
      emitSelectionChange(copy);
      return copy;
    });
  }, [emitSelectionChange]);

  // seed parent on mount with empty selection
  React.useEffect(() => {
    emitSelectionChange(selection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // toggle series selection
  const toggleSeries = React.useCallback((opt: SeriesOption) => {
    setSelectedSeries(s => {
      if (s.find(x => x.key === opt.key)) return s.filter(x => x.key !== opt.key);
      return [...s, opt];
    });
    setResultsOpen(true);
    setSeriesDropdownOpen(false);
  }, []);

  const clearAll = React.useCallback(() => {
    setSelectedSeries([]);
    setLoadedSets({});
    setSelection({});
    setSeriesQuery("");
    setSeriesOptions([]);
    setTextQuery("");
    setTraitFilters({});
    emitSelectionChange({});
  }, [emitSelectionChange]);

  // click outside to close dropdowns
  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node | null;
      try {
        if (seriesRef.current && !seriesRef.current.contains(target)) setSeriesDropdownOpen(false);
      } catch { /* ignore */ }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // focus handler to nudge manifest load
  const handleResultsFocus = () => {
    setResultsOpen(true);
    selectedSeries.forEach(s => { if (!loadedSets[s.key]) setSelectedSeries(prev => prev); });
    if (selectedSeries.length === 0 && (!seriesOptions || seriesOptions.length === 0)) {
      setLoadingSeries(true);
      // use live lang here (avoid fallback to ref)
      fetchSeriesRef.current(lang, undefined, 200)
        .then(res => { setSeriesOptions(res ?? []); setSeriesDropdownOpen(true); })
        .catch(() => setSeriesOptions([]))
        .finally(() => setLoadingSeries(false));
    }
  };

  // helper for class toggles
  const cls = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

  // language change and reload
  const setLangAndReload = React.useCallback(async (newLang: Lang) => {
    if (newLang === langRef.current) {
      // still update state so UI reflects the change
      setLang(newLang);
      langRef.current = newLang;
      return;
    }
    setLoadedSets({});
    setSelectedSeries([]);
    setSeriesOptions([]);
    setSeriesQuery("");
    setSeriesDropdownOpen(false);
    setSelection({});
    setTraitFilters({});
    setLang(newLang);
    langRef.current = newLang;
    setLoadingSeries(true);
    try {
      const res = await fetchSeriesRef.current(newLang, undefined, 200);
      setSeriesOptions(res ?? []);
    } catch { setSeriesOptions([]); }
    finally { setLoadingSeries(false); }
    emitSelectionChange({});
  }, [emitSelectionChange]);

  // Render
  return (
    <div className="p-3 space-y-3 text-sm">
      <div className="flex items-center gap-3">
        <div className="flex gap-2 items-center">
          <button
            className={cls("px-2 py-1 rounded transition-colors", lang === "EN" ? "bg-slate-700" : "bg-white/10")}
            onClick={() => void setLangAndReload("EN")}
            title="Use English database (JSON)"
            aria-pressed={lang === "EN"}
          >
            DB-ENG
          </button>
          <button
            className={cls("px-2 py-1 rounded transition-colors", lang === "JP" ? "bg-slate-700" : "bg-white/10")}
            onClick={() => void setLangAndReload("JP")}
            title="Use Japanese database (JSON)"
            aria-pressed={lang === "JP"}
          >
            DB-JP
          </button>
        </div>
        <div className="ml-auto text-xs text-white/60">Selected cards: {totalSelected} / {deckMax}</div>
      </div>

      {/* Series selector */}
      <div ref={seriesRef} className="relative">
        <div className="text-xs text-white/70 mb-1">Series (select one or more)</div>
        <div className="flex gap-2">
          <input
            placeholder="Type to search series..."
            value={seriesQuery}
            onChange={(e) => { setSeriesQuery(e.target.value); setSeriesDropdownOpen(true); }}
            onFocus={() => {
              setSeriesDropdownOpen(true);
              if (!seriesQuery.trim() && (!seriesOptions || seriesOptions.length === 0)) {
                setLoadingSeries(true);
                // use live lang state when fetching
                fetchSeriesRef.current(lang, undefined, 200)
                  .then(res => { setSeriesOptions(res ?? []); setSeriesDropdownOpen(true); })
                  .catch(() => setSeriesOptions([]))
                  .finally(() => setLoadingSeries(false));
              }
            }}
            className="flex-1 px-2 py-1 rounded bg-black/30 border border-white/10 outline-none"
            aria-label="Series search"
          />
          <button onClick={() => { setSeriesQuery(""); setSeriesOptions([]); setSeriesDropdownOpen(false); }} className="px-3 py-1 rounded bg-white/5">Clear</button>
        </div>

        {seriesDropdownOpen && (
          <div
            className="absolute left-0 right-0 mt-1 z-50 rounded shadow-lg border border-white/10 bg-black/70 backdrop-blur-sm"
            style={{ maxHeight: 400, overflow: "auto" }}
            role="listbox"
            aria-expanded={seriesDropdownOpen}
          >
            {seriesQuery.trim() === "" ? (
              loadingSeries ? <div className="text-xs text-white/50 p-2">Loading series…</div>
              : seriesOptions.length === 0 ? <div className="text-xs text-white/50 p-2">Click the field to search series</div>
              : seriesOptions.map(opt => {
                const picked = !!selectedSeries.find(x => x.key === opt.key);
                return (
                  <div key={opt.key} className="flex items-center justify-between gap-2 p-2 hover:bg-white/5 cursor-pointer">
                    <label className="flex items-center gap-2 cursor-pointer" onClick={() => toggleSeries(opt)}>
                      <input type="checkbox" checked={picked} readOnly />
                      <div className="text-sm">{opt.name}</div>
                    </label>
                    <div className="text-xs text-white/50">{opt.key}</div>
                  </div>
                );
              })
            ) : loadingSeries ? <div className="text-xs text-white/50 p-2">Searching series…</div>
              : seriesOptions.length === 0 ? <div className="text-xs text-white/50 p-2">No series matched</div>
              : seriesOptions.map(opt => {
                const picked = !!selectedSeries.find(x => x.key === opt.key);
                return (
                  <div key={opt.key} className="flex items-center justify-between gap-2 p-2 hover:bg-white/5 cursor-pointer">
                    <label className="flex items-center gap-2 cursor-pointer" onClick={() => toggleSeries(opt)}>
                      <input type="checkbox" checked={picked} readOnly />
                      <div className="text-sm">{opt.name}</div>
                    </label>
                    <div className="text-xs text-white/50">{opt.key}</div>
                  </div>
                );
              })
            }
          </div>
        )}

        {/* selected series tags */}
        {selectedSeries.length > 0 && (
          <div className="mt-2 flex gap-2 flex-wrap">
            {selectedSeries.map(s => (
              <div key={s.key} className="px-2 py-1 rounded bg-black/30 border border-white/10 text-xs flex items-center gap-2">
                <strong>{s.name}</strong>
                <span className="text-white/60">({s.key})</span>
                <button className="ml-2 text-[11px]" onClick={() => toggleSeries(s)}>×</button>
                <div className="ml-2 text-[11px] text-white/50">{loadingSets[s.key] ? "loading…" : (loadedSets[s.key] ? `${(Array.isArray(loadedSets[s.key]) ? loadedSets[s.key].length : Object.keys(loadedSets[s.key]).length)} cards` : "not loaded")}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Search + filters */}
      <div>
        <div className="mt-2">
          <input placeholder="Search cards (click to open results)" value={textQuery} onChange={(e) => setTextQuery(e.target.value)} onFocus={handleResultsFocus} className="w-full px-2 py-1 rounded bg-black/30 border border-white/10 outline-none" />
        </div>

        <div className="mt-2 flex items-center gap-2">
          {(["Type", "Level", "Color", "Traits"] as const).map(t => (
            <button key={t} onClick={() => { setActiveTab(t); setResultsOpen(true); }} className={cls("px-3 py-1 rounded bg-white/5 text-xs", activeTab === t ? "bg-slate-700" : "")}>{t}</button>
          ))}
        </div>

        <div className="mt-2">
          {activeTab === "Type" && (
            <div className="flex gap-3">
              {["Character", "Event", "Climax"].map(t => (
                <label key={t} className="flex items-center gap-2">
                  <input type="checkbox" checked={!!typeFilters[t]} onChange={() => setTypeFilters(p => ({ ...p, [t]: !p[t] }))} />
                  {t}
                </label>
              ))}
            </div>
          )}
          {activeTab === "Level" && (
            <div className="flex gap-3">
              {[0, 1, 2, 3].map(l => (
                <label key={l} className="flex items-center gap-2 p-1"><input type="checkbox" checked={!!levelFilters[l]} onChange={() => setLevelFilters(p => ({ ...p, [l]: !p[l] }))} />Lvl {l}</label>
              ))}
            </div>
          )}
          {activeTab === "Color" && (
            <div className="flex gap-3 flex-wrap">
              {colorOptions.map(c => (
                <label key={c} className="flex items-center gap-2">
                  <input type="checkbox" checked={!!colorFilters[c]} onChange={() => setColorFilters(p => ({ ...p, [c]: !p[c] }))} />
                  <span>{c.charAt(0) + c.slice(1).toLowerCase()}</span>
                </label>
              ))}
            </div>
          )}
          {activeTab === "Traits" && (
            <div className="max-h-40 overflow-auto p-1 border border-white/10 rounded bg-black/10">
              {Object.keys(traitFilters).length === 0 ? <div className="text-xs text-white/50 p-2">No traits loaded yet</div> :
                Object.keys(traitFilters).sort().map(t => (
                  <label key={t} className="flex items-center gap-2 p-1">
                    <input type="checkbox" checked={!!traitFilters[t]} onChange={() => setTraitFilters(p => ({ ...p, [t]: !p[t] }))} />
                    {t}
                  </label>
                ))
              }
            </div>
          )}
        </div>

        {/* Results panel */}
        <div className="mt-3" ref={resultsRef}>
          <div className="text-xs text-white/70 mb-1">Results</div>

          <div className="text-[11px] text-white/50 mb-2">Loaded cards: {allCards.length}</div>

          <div className="max-h-[320px] overflow-auto rounded border border-white/10 bg-black/10 p-2" ref={resultsScrollRef}>
            {filteredCards.length === 0 ? (
              <div className="text-xs text-white/50 p-2">
                No cards match filters{allCards.length > 0 ? ` — loaded ${allCards.length} card(s). Try clearing filters or click a set tag to inspect.` : "."}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {filteredCards.map((c: CardShape) => {
                  const id = (c.id || c.code || c.Code || "").toString();
                  const cnt = selection[id] || 0;
                  const isClimax = (/climax/i.test(String(c.type || "")) || (c.attributes || []).some(a => /climax/i.test(String(a))));
                  // disable + when deck full or climax cap reached (defensive)
                  const canInc = cnt < 4 && totalSelected < deckMax && (!(isClimax && totalClimaxSelected >= 8));
                  const canDec = cnt > 0;
                  const numClass = (cnt >= 4 || (isClimax && totalClimaxSelected >= 8) || (totalSelected >= deckMax && cnt === 0)) ? "text-yellow-300 font-semibold" : "";

                  const candidates = buildImageCandidates(c, lang);
                  const cardWidth = { width: "calc((100% - 40px) / 6)" };

                  return (
                    <div key={id || JSON.stringify(c)} className="flex-shrink-0" style={cardWidth}>
                      <div className="h-[110px] rounded overflow-hidden border border-white/10 flex items-center justify-center bg-black/20">
                        <ImgWithFallback candidates={candidates} alt={c.name ?? id} />
                      </div>

                      <div className="text-xs mt-1 truncate" title={c.name ?? id}>{c.name ?? id}</div>
                      <div className="text-[11px] text-white/60 truncate">{id}</div>

                      <div className="mt-1 flex items-center gap-1">
                        <button disabled={!canDec} onClick={() => decrement(id)} className={cls("px-2 py-1 rounded text-xs", !canDec ? "bg-white/5 text-white/40 cursor-not-allowed" : "bg-white/10")}>−</button>
                        <div className={cls("w-8 text-center text-sm", numClass)}>{cnt}</div>
                        <button disabled={!canInc} onClick={() => increment(c)} className={cls("px-2 py-1 rounded text-xs", !canInc ? "bg-white/5 text-white/40 cursor-not-allowed" : "bg-white/10")}>+</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* footer */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-white/60">Distinct IDs: {Object.keys(selection).length}</div>
        <div className="flex gap-2 items-center">
          <button onClick={clearAll} className="px-3 py-1 rounded bg-white/5">Clear</button>
          <div className="text-xs text-white/70">Tip: use the Ready button in Import dialog to finish import.</div>
        </div>
      </div>
    </div>
  );
}

/** ImgWithFallback component cycles through a list of candidate URLs on error. */
function ImgWithFallback({ candidates, alt }: { candidates: string[]; alt?: string }) {
  const imgRef = React.useRef<HTMLImageElement | null>(null);
  const [src, setSrc] = React.useState<string | undefined>(() => candidates && candidates.length > 0 ? candidates[0] : undefined);

  React.useEffect(() => {
    setSrc(candidates && candidates.length > 0 ? candidates[0] : undefined);
    if (imgRef.current) {
      imgRef.current.dataset.fidx = "0";
      imgRef.current.dataset.exhausted = "0";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(candidates)]);

  const handleError = () => {
    const el = imgRef.current;
    if (!el || !candidates || candidates.length === 0) return;
    const fidx = Number(el.dataset.fidx || "0");
    const next = fidx + 1;
    if (next < candidates.length) {
      el.dataset.fidx = String(next);
      setSrc(candidates[next]);
    } else {
      el.dataset.exhausted = "1";
      setSrc("data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=");
    }
  };

  return (
    <img
      ref={imgRef}
      src={src}
      alt={alt}
      onError={handleError}
      draggable={false}
      className="w-full h-full object-cover"
      style={{ backgroundColor: "transparent" }}
    />
  );
}
