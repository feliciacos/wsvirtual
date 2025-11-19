// src/components/WSPlayfield/SearchModal.tsx
import React, { useMemo, useState, useEffect } from "react";
import { Card, CardInfo, ZoneKey } from "../../utils/cards";
import CardView from "./CardView";

type Props = {
  open: boolean;
  zone: ZoneKey | null;
  cards: Card[]; // cards from the zone (uid,id,…)
  catalog: Record<string, CardInfo>;
  readOnly: boolean;
  onClose: () => void;
  // When user confirms moving selected cards out of the searched zone
  onMoveSelected: (opts: { from: ZoneKey; to: ZoneKey; uids: string[] }) => void;
};

const ZONE_NAME: Record<ZoneKey, string> = {
  CENTER_L: "Center L", CENTER_C: "Center C", CENTER_R: "Center R",
  BACK_L: "Back L", BACK_R: "Back R",
  CLIMAX: "Climax", LEVEL: "Level", CLOCK: "Clock",
  STOCK: "Stock", WAITING_ROOM: "Waiting Room", MEMORY: "Memory",
  DECK: "Deck", HAND: "Hand",
  DECK_TEMP: "Temp Deck",
};

// Allow moving to DECK too (index.tsx will place returned cards “random near top”)
const DESTS: ZoneKey[] = ["HAND", "WAITING_ROOM", "CLOCK", "STOCK", "MEMORY", "DECK"];

// Use the same sizing variables as the board so CardView renders at the right size
const CARD_VARS: React.CSSProperties = {
  ["--card" as any]: "80px",
  ["--cardH" as any]: "112px",
  ["--gap" as any]: "12px",
};

export default function SearchModal({
  open,
  zone,
  cards,
  catalog,
  readOnly,
  onClose,
  onMoveSelected,
}: Props) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) {
      setQ("");
      setSel(new Set());
    }
  }, [open]);

  const filtered = useMemo(() => {
    if (!q.trim()) return cards;
    const needle = q.trim().toLowerCase();
    return cards.filter((c) => {
      const id = c.id.toLowerCase();
      const meta = catalog[c.id.toUpperCase()];
      const name = (meta?.name ?? "").toString().toLowerCase();
      const text = (meta?.text ?? meta?.effect ?? "").toString().toLowerCase();
      return id.includes(needle) || name.includes(needle) || text.includes(needle);
    });
  }, [q, cards, catalog]);

  if (!open || !zone) return null;

  const toggle = (uid: string) => {
    setSel((prev) => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });
  };

  const selectAllFiltered = () => setSel(new Set(filtered.map((c) => c.uid)));
  const clearSelection = () => setSel(new Set());
  const moveTo = (to: ZoneKey) => {
    if (!sel.size) return;
    onMoveSelected({ from: zone, to, uids: Array.from(sel) });
    setSel(new Set());
  };

  return (
    <div className="fixed inset-0 z-[1000] bg-black/60 backdrop-blur-sm grid place-items-center p-3">
      <div
        className="w-[min(1100px,95vw)] max-h-[90vh] overflow-hidden rounded-2xl border border-white/10 bg-slate-900 text-white shadow-2xl"
        style={CARD_VARS}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-white/10">
          <div className="text-sm">
            <b>Search {ZONE_NAME[zone]}</b> · {cards.length} cards ·{" "}
            <span className="opacity-80">{sel.size} selected</span>
          </div>
          <button
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/10"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {/* Controls */}
        <div className="p-3 border-b border-white/10 flex flex-wrap gap-2 items-center">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="flex-1 min-w-[14rem] px-3 py-2 rounded-lg bg-black/40 border border-white/10 outline-none"
            placeholder="Search by id / name / rules text…"
          />
          <div className="text-sm px-2 py-2 opacity-70">{filtered.length} shown</div>
          <div className="flex gap-2 ml-auto">
            <button
              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/10"
              onClick={selectAllFiltered}
              disabled={filtered.length === 0}
            >
              Select all (filtered)
            </button>
            <button
              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/10"
              onClick={clearSelection}
              disabled={sel.size === 0}
            >
              Clear selection
            </button>
          </div>
        </div>

        {/* Grid */}
        <div className="p-3 overflow-auto" style={{ maxHeight: "60vh" }}>
          {filtered.length === 0 ? (
            <div className="text-white/60 text-sm">No matches.</div>
          ) : (
            <div
              className="grid grid-cols-8 gap-3"
              style={{ gridAutoRows: "calc(var(--cardH) + 12px)" }}
            >
              {filtered.map((c, i) => {
                const active = sel.has(c.uid);
                return (
                  <button
                    key={c.uid}
                    onClick={() => toggle(c.uid)}
                    className={[
                      "relative rounded-xl border text-left grid place-items-center",
                      active
                        ? "border-emerald-400/70 bg-emerald-500/10"
                        : "border-white/10 bg-white/5",
                    ].join(" ")}
                    style={{
                      padding: 6,
                      width: "calc(var(--card) + 12px)",
                      height: "calc(var(--cardH) + 12px)",
                    }}
                    title="Click to select / deselect"
                  >
                    {/* fixed-size holder so CardView can't collapse */}
                    <div style={{ width: "var(--card)", height: "var(--cardH)" }}>
                      <CardView
                        card={c}
                        zone={zone}
                        idx={i}
                        readOnly
                        catalog={catalog}
                        onDragStart={() => {}}
                        onSetRot={() => {}}
                        // IMPORTANT: no-op so no hover state is created in the modal
                        setHoverCard={() => {}}
                      />
                    </div>

                    {/* checkbox indicator */}
                    <div className="absolute top-1 left-1 w-4 h-4 rounded border border-white/30 bg-black/50" />
                    {active && (
                      <div className="absolute top-[5px] left-[6px] w-2 h-2 rounded bg-emerald-400" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer actions */}
        {!readOnly && (
          <div className="p-3 border-t border-white/10 flex flex-wrap gap-2">
            {DESTS.filter((d) => d !== zone).map((d) => (
              <button
                key={d}
                onClick={() => moveTo(d)}
                disabled={sel.size === 0}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 disabled:bg-emerald-900/40 hover:bg-emerald-500 border border-emerald-400 text-black font-semibold"
              >
                Move to {ZONE_NAME[d]} ({sel.size})
              </button>
            ))}
            <div className="ml-auto text-xs opacity-70 self-center">
              Tip: Click cards to select/deselect. Enter filters to search through the <b>Deck</b>.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
