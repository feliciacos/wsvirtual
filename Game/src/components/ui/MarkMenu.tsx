// src/components/ui/MarkMenu.tsx
import React from "react";
import { Card, ZoneKey } from "../../utils/cards";
import CardView from "../WSPlayfield/CardView";

type Target = { zone: ZoneKey; card: Card };

type MarkMenuProps = {
  open: boolean;
  title?: string;
  targets: Target[]; // cards we’re marking (usually CENTER_* or BACK_*)
  onClose: () => void;
  onChangeMarks: (updates: Array<{ uid: string; next: number }>) => void;
};

const clamp = (v: number) => Math.max(0, Math.min(99, v | 0));

const MarkMenu: React.FC<MarkMenuProps> = ({ open, title = "Mark cards", targets, onClose, onChangeMarks }) => {
  const any = targets.length > 0;

  const bulk = (delta: number) => {
    if (!any) return;
    const updates = targets.map(t => {
      const cur = t.card.marks ?? 0;
      return { uid: t.card.uid, next: clamp(cur + delta) };
    });
    onChangeMarks(updates);
  };
  const bulkClear = () => {
    if (!any) return;
    const updates = targets.map(t => ({ uid: t.card.uid, next: 0 }));
    onChangeMarks(updates);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-end md:items-center justify-center bg-black/40 p-3">
      <section className="w-full max-w-2xl rounded-2xl border border-white/10 bg-slate-900/95 backdrop-blur p-3 md:p-4">
        <header className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white/90">{title}</h3>
          <div className="flex gap-2">
            <button
              className="px-2 py-1 text-xs rounded-lg border bg-white/5 hover:bg-white/10 border-white/10"
              onClick={() => bulk(+1)}
              disabled={!any}
            >+1 All</button>
            <button
              className="px-2 py-1 text-xs rounded-lg border bg-white/5 hover:bg-white/10 border-white/10"
              onClick={() => bulk(-1)}
              disabled={!any}
            >−1 All</button>
            <button
              className="px-2 py-1 text-xs rounded-lg border bg-rose-500/10 hover:bg-rose-500/20 border-rose-400/30 text-rose-200"
              onClick={bulkClear}
              disabled={!any}
            >Clear All</button>
            <button
              className="px-2 py-1 text-xs rounded-lg border bg-white/10 hover:bg-white/20 border-white/10"
              onClick={onClose}
            >Close</button>
          </div>
        </header>

        {targets.length === 0 ? (
          <div className="text-xs text-white/60">No cards here right now.</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {targets.map(({ card }) => {
              const count = card.marks ?? 0;
              const set = (n: number) => onChangeMarks([{ uid: card.uid, next: clamp(n) }]);
              return (
                <div key={card.uid} className="rounded-xl border border-white/10 bg-white/5 p-2">
                  <div className="w-full flex items-center justify-center">
                    {/* small preview – you already have CardView; reuse it mini-sized */}
                    <div style={{ width: 64, height: 90 }} className="relative">
                      <CardView
                        card={card}
                        zone={"CENTER_C" as ZoneKey} // not used for visuals here
                        idx={0}
                        readOnly={true}
                        catalog={{}}
                        onDragStart={() => {}}
                        onSetRot={() => {}}
                        setHoverCard={() => {}}
                      />
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-white/70">Marks</span>
                    <div className="flex items-center gap-1">
                      <button
                        className="px-2 py-0.5 text-xs rounded-md border bg-white/5 hover:bg-white/10 border-white/10"
                        onClick={() => set(count - 1)}
                      >−</button>
                      <input
                        className="w-10 text-center text-xs rounded-md bg-black/30 border border-white/10 py-0.5"
                        value={count}
                        onChange={e => set(parseInt(e.target.value || "0", 10))}
                      />
                      <button
                        className="px-2 py-0.5 text-xs rounded-md border bg-white/5 hover:bg-white/10 border-white/10"
                        onClick={() => set(count + 1)}
                      >+</button>
                    </div>
                  </div>
                  <div className="mt-2 flex justify-end">
                    <button
                      className="px-2 py-1 text-xs rounded-lg border bg-rose-500/10 hover:bg-rose-500/20 border-rose-400/30 text-rose-200"
                      onClick={() => set(0)}
                    >Clear</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

export default MarkMenu;
