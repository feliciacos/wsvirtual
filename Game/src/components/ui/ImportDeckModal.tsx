// src/components/ImportDeckModal.tsx
import React from "react";
import { listDeckNames, loadDeck, saveDeck } from "../../utils/deckStore";
import { DECK_MAX } from "../../config/constants";
import ImportDeckCustom from "../ui/ImportDeckCustom";
import { fetchSetJson, fetchSeriesListFromKeys } from "../../utils/ids"; // used by fetchSetCardsCb
import { fetchSeriesListFromManifest, getSetManifestEntry } from "../../utils/manifest";

type Entry = { id: string; count: number };
type Mode = "Saved" | "EncoreDecks" | "DeckLog" | "Custom";

export default function ImportDeckModal(props: {
    open: boolean;
    onClose: () => void;
    onReady: (payload: { name: string; entries: Entry[]; raw: string }) => void;
}) {
    const { open, onClose, onReady } = props;

    const savedNames = React.useMemo(() => listDeckNames(), []);
    const hasSaved = savedNames.length > 0;

    const initialMode: Mode = hasSaved ? "Saved" : "EncoreDecks";
    const [mode, setMode] = React.useState<Mode>(initialMode);

    // Parent "canonical" fields
    const [raw, setRaw] = React.useState("");
    const [name, setName] = React.useState("");
    const [nameTouched, setNameTouched] = React.useState(false);
    const [savedPick, setSavedPick] = React.useState<string>(savedNames[0] || "");
    const [error, setError] = React.useState<string>("");

    // ---- NEW: store entries provided by ImportDeckCustom when in Custom mode
    const [customEntries, setCustomEntries] = React.useState<Entry[]>([]);

    // parsing helpers (unchanged)
    const parseEncoreDecks = (txt: string): Entry[] => {
        const map: Record<string, number> = {};
        for (const lineRaw of txt.split(/\r?\n/)) {
            const line = lineRaw.trim();
            if (!line) continue;
            const m = line.match(/^([A-Z0-9]{1,6}\/[A-Z0-9]{1,4}-[A-Z0-9]{1,5})\s+(\d+)/i);
            if (!m) continue;
            const id = m[1].toUpperCase();
            const cnt = Math.max(1, parseInt(m[2], 10) || 1);
            map[id] = (map[id] || 0) + cnt;
        }
        return Object.entries(map).map(([id, count]) => ({ id, count }));
    };

    const parseDeckLog = (txt: string): Entry[] => {
        const map: Record<string, number> = {};
        for (const lineRaw of txt.split(/\r?\n/)) {
            const line = lineRaw.trim();
            if (!line) continue;
            const m = line.match(/^([A-Z0-9]{1,6}\/[A-Z0-9]{1,4}-[A-Z0-9]{1,5})$/i);
            if (!m) continue;
            const id = m[1].toUpperCase();
            map[id] = (map[id] || 0) + 1;
        }
        return Object.entries(map).map(([id, count]) => ({ id, count }));
    };

    // For Custom mode we will rely on the entries provided by ImportDeckCustom (via handleCustomChange)
    const parseCustom = (_txt: string): Entry[] => {
        // return the entries previously received from the Custom UI
        return customEntries;
    };

    const parse = React.useCallback((txt: string, mode: Mode) => {
        if (!txt.trim()) return [];
        if (mode === "EncoreDecks") return parseEncoreDecks(txt);
        if (mode === "DeckLog") return parseDeckLog(txt);
        if (mode === "Saved") {
            const looksEncore =
                /\t\d+\t/.test(txt) ||
                /^[^\n]*\r?\n[A-Z0-9]{1,6}\/[A-Z0-9]{1,4}-[A-Z0-9]{1,5}\s+\d+/im.test(txt);
            return looksEncore ? parseEncoreDecks(txt) : parseDeckLog(txt);
        }
        return parseCustom(txt);
    }, [customEntries]); // parseCustom depends on customEntries

    // --- canonical entries & readiness check (prefer customEntries in Custom mode) ---
    const effectiveEntries = React.useMemo(() => {
        if (mode === "Custom") {
            // prefer the canonical entries provided by the custom UI
            return customEntries ?? [];
        }
        // otherwise fall back to parsing the raw text
        return parse(raw, mode) ?? [];
    }, [mode, customEntries, raw, parse]);

    // Alias for backwards compatibility with existing code usage
    const entries = effectiveEntries;

    const totalCount = React.useMemo(() => entries.reduce((s, e) => s + e.count, 0), [entries]);
    const distinctIDs = entries.length;

    // defensive/clear readiness test (name must be present & exactly DECK_MAX cards)
    const readyDisabled = !name.trim() || totalCount !== DECK_MAX || distinctIDs === 0;

    // debug (remove or gate behind env when done)
    //if (process.env.NODE_ENV === "development") {
    //    console.debug("ImportDeckModal readiness:", { mode, totalCount, distinctIDs, namePresent: !!name.trim(), readyDisabled });
    //}

    // Auto-fill name from first line for EncoreDecks (until user edits name)
    React.useEffect(() => {
        if (!nameTouched && mode === "EncoreDecks") {
            const first = (raw.split(/\r?\n/, 1)[0] || "").trim();
            if (first) setName(first);
        }
    }, [raw, mode, nameTouched]);

    // When opening and we have saved decks, preload the first saved deck
    React.useEffect(() => {
        if (!open) return;
        if (!hasSaved) return;
        const first = savedNames[0];
        setMode("Saved");
        setSavedPick((v) => v || first);
        const txt = loadDeck(first) || "";
        setRaw(txt);
        const firstLine = (txt.split(/\r?\n/, 1)[0] || "").trim();
        setName(firstLine || first);
        setNameTouched(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, hasSaved]);

    // Reset inputs when switching modes
    const handleModeChange = (m: Mode) => {
        setMode(m);
        setError("");
        setNameTouched(false);

        // Clear customEntries when leaving Custom mode to avoid stale results
        if (m !== "Custom") setCustomEntries([]);

        if (m === "Saved") {
            if (hasSaved && savedPick) {
                const txt = loadDeck(savedPick) || "";
                setRaw(txt);
                const first = (txt.split(/\r?\n/, 1)[0] || "").trim();
                setName(first || savedPick);
            } else {
                setRaw("");
                setName("");
            }
        } else {
            setRaw("");
            setName("");
        }
    };

    const handleSavedPick = (v: string) => {
        setSavedPick(v);
        const txt = loadDeck(v) || "";
        setRaw(txt);
        const first = (txt.split(/\r?\n/, 1)[0] || "").trim();
        setName(first || v);
        setNameTouched(false);
    };

    // --- stable callbacks passed to ImportDeckCustom ---------------------------
    const fetchSeriesCb = React.useCallback(async (lang: "EN" | "JP", query?: string, limit = 200) => {
        // Use manifest helper (manifest exists in /DB-ENG/sets-manifest.json etc.)
        return await fetchSeriesListFromManifest(lang, query, limit);
    }, []);

    const fetchSetCardsCb = React.useCallback(async (setKey: string, lang: "EN" | "JP") => {
        try {
            const data = await fetchSetJson(setKey, lang);
            if (!data) return [];
            const arr = Array.isArray(data) ? data : Object.values(data);
            return arr.map((raw: any) => {
                const id = (raw.code || raw.Code || raw.id || raw.ID || raw.cardCode || raw.CardCode || raw.number || raw.Number || raw.serial || raw.Serial || "")
                    .toString().toUpperCase();
                const name = raw.name || raw.title || raw.jname || raw.Name || "";
                const type = raw.type || raw.card_type || raw.Type || raw.cardType || "";
                const level = typeof raw.level === "number" ? raw.level : parseInt(raw.level || raw.Level || "0", 10) || 0;
                const color = raw.color || raw.colour || raw.attr || raw.Color || "";
                const attributes = raw.attributes || raw.traits || raw.tags || raw.Attributes || [];
                return { id, name, type, level, color, attributes };
            });
        } catch {
            return [];
        }
    }, []);

    // Called by ImportDeckCustom when user changes selection/entries
    const handleCustomChange = React.useCallback(
        ({ entries: e, raw: customRaw, name: customName }: { entries: Entry[]; raw: string; name?: string }) => {
            // parent owns the authoritative name & raw
            setRaw(customRaw);
            if (customName !== undefined) {
                setName(customName);
            }
            // **** NEW: store the entries provided by the custom component so parse() can use them ****
            setCustomEntries(e ?? []);
            setNameTouched(true);
            setError("");
            // entries derive from raw OR customEntries when mode === "Custom"
        },
        []
    );

    const handleReady = () => {
        setError("");
        const deckName = (name.trim() || savedPick || "").trim();

        if (!deckName) {
            setError("Please enter a deck name.");
            return;
        }
        if (totalCount !== DECK_MAX) {
            setError(`Deck must contain exactly ${DECK_MAX} cards (currently ${totalCount}).`);
            return;
        }

        if (mode === "Saved") {
            onReady({ name: deckName, entries, raw });
            return;
        }

        const exists = listDeckNames().includes(deckName);
        if (exists) {
            const ok = window.confirm(`${deckName} exists. Overwrite?`);
            if (!ok) return;
        }
        saveDeck(deckName, raw);
        onReady({ name: deckName, entries, raw });
    };

    // Keep the top-of-text reserved for deck name whenever name changes:
    React.useEffect(() => {
        if (mode !== "Custom") return;
        setRaw((r) => {
            const lines = r.split(/\r?\n/);
            const first = lines[0] || "";
            if (!name) return r;
            if (first === name) return r;
            return [name, ...lines.slice(1)].join("\n");
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [name, mode]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div
                role="dialog"
                aria-modal="true"
                className="w-[min(44rem,95vw)] rounded-2xl border border-white/10 bg-slate-900 text-white shadow-2xl p-4"
            >
                <div className="flex items-center justify-between mb-3">
                    <div className="text-base font-semibold">Import Deck</div>
                    <button onClick={onClose} className="text-sm px-3 py-1 rounded bg-white/5">Close</button>
                </div>

                {/* Mode buttons */}
                <div className="flex gap-2 mb-3">
                    {hasSaved && (
                        <button
                            onClick={() => handleModeChange("Saved")}
                            className={`px-3 py-1.5 rounded-lg border ${mode === "Saved" ? "bg-slate-800" : "bg-white/10 hover:bg-white/20"} border-white/10 text-sm`}
                        >
                            Saved
                        </button>
                    )}
                    <button onClick={() => handleModeChange("EncoreDecks")} className={`px-3 py-1.5 rounded-lg border ${mode === "EncoreDecks" ? "bg-slate-800" : "bg-white/10 hover:bg-white/20"} border-white/10 text-sm`}>EncoreDecks</button>
                    <button onClick={() => handleModeChange("DeckLog")} className={`px-3 py-1.5 rounded-lg border ${mode === "DeckLog" ? "bg-slate-800" : "bg-white/10 hover:bg-white/20"} border-white/10 text-sm`}>DeckLog</button>
                    <button onClick={() => handleModeChange("Custom")} className={`px-3 py-1.5 rounded-lg border ${mode === "Custom" ? "bg-slate-800" : "bg-white/10 hover:bg-white/20"} border-white/10 text-sm`}>Custom</button>
                </div>

                {/* Saved picker */}
                {mode === "Saved" && hasSaved && (
                    <div className="mb-3 flex items-center gap-2">
                        <select className="px-3 py-1.5 rounded-lg bg-black/40 border border-white/10 min-w-[16rem]" value={savedPick} onChange={(e) => handleSavedPick(e.target.value)} title="Select a saved deck">
                            {savedNames.map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                        <div className="text-sm text-white/60">Loaded {savedPick ? `"${savedPick}"` : "—"}</div>
                    </div>
                )}

                {/* Name field */}
                <label className="block text-sm mb-2">
                    Deck name
                    <input
                        value={name}
                        onChange={(e) => { setNameTouched(true); setName(e.target.value); }}
                        className="mt-1 w-full rounded-lg bg-black/40 border border-white/10 px-2 py-1 outline-none"
                        placeholder={mode === "EncoreDecks" ? "Autofilled from first line…" : "Enter a deck name…"}
                        maxLength={64}
                    />
                </label>

                {/* Raw textarea (hidden in Saved but still present for preview/edit) */}
                <label className="block text-sm">
                    {mode === "EncoreDecks" && (
                        <span className="text-white/70">Paste EncoreDecks text (top line is deck name)</span>
                    )}
                    {mode === "DeckLog" && (
                        <span className="text-white/70">Paste DeckLog text (one card ID per line)</span>
                    )}
                    {mode === "Custom" && (
                        <div className="mb-3">
                            <ImportDeckCustom
                                fetchSeries={fetchSeriesCb}
                                fetchSetCards={fetchSetCardsCb}
                                onChange={handleCustomChange}
                                initialLang="EN"
                                deckMax={DECK_MAX}
                                externalTextAreaSelector="#importDeckTextarea"
                            />
                        </div>
                    )}

                    {mode === "Saved" && (<span className="text-white/70">Loaded text (editable)</span>)}
                    <textarea
                        value={raw}
                        onChange={(e) => setRaw(e.target.value)}
                        className="mt-1 w-full h-48 p-2 rounded-xl bg-black/50 border border-white/10 outline-none font-mono text-xs"
                        placeholder={
                            mode === "DeckLog"
                                ? "NIK/S117-004\nNIK/S117-001p\nNIK/S117-011s\nNIK/S117-041\n…"
                                : mode === "EncoreDecks"
                                    ? "My Deck Name\nCharacters\nDAL/W79-TE10\t2\tHostile, Tohka\nDAL/W79-TE10\t2\tHostile, Tohka\n…"
                                    : ""
                        }
                    />
                </label>

                {/* Status / validation */}
                <div className="mt-2 text-sm">
                    <span className={totalCount === DECK_MAX ? "text-emerald-300" : "text-amber-300"}>Parsed cards: {totalCount} / {DECK_MAX}</span>
                    {entries.length > 0 && (<span className="text-white/50"> — distinct IDs: {entries.length}</span>)}
                </div>
                {error && <div className="mt-2 text-sm text-red-300">{error}</div>}

                {/* Actions */}
                <div className="mt-4 flex items-center justify-between">
                    <div className="text-xs text-white/50">Ready is enabled only when the deck has exactly {DECK_MAX} cards.</div>
                    <div className="flex gap-2">
                        <button disabled={readyDisabled} onClick={handleReady} className={`px-3 py-1.5 rounded-xl border ${readyDisabled ? "bg-white/5 border-white/10 text-white/50 cursor-not-allowed" : "bg-emerald-500/80 hover:bg-emerald-500 border-emerald-300 text-black font-semibold"}`} title={readyDisabled ? "Enter a name and import exactly 50 cards" : "Save and load this deck"}>Ready</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
