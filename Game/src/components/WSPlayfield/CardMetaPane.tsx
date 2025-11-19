// src/components/WSPlayfield/CardMetaPane.tsx
import React from "react";
import { TRIGGER_ICONS, TRIGGER_ALIASES } from "../../config/constants";
import { Card, CardInfo, lookupCardInfo } from "../../utils/cards";

type Props = {
  card: Card | null;
  catalog: Record<string, CardInfo>;
};

export default function CardMetaPane({ card, catalog }: Props) {
  const info = card ? (lookupCardInfo(catalog, card.id) ?? null) : null;

  // ---- Trigger parsing (icons + text) ----
  // Accepts: array (["SOUL","SOUL"]), string ("SOUL, SOUL"), or unknown field casing.
  const triggerTokens: string[] = React.useMemo(() => {
    if (!info) return [];
    const raw =
      (Array.isArray(info.trigger) ? info.trigger.join(",") : info?.trigger) ??
      // tolerate different keys that may appear in some DBs
      (info as any)?.Trigger ??
      "";

    return raw
      .toString()
      .split(/[,、]/) // Western/Japanese comma
      .map((s: string) => s.trim())
      .filter(Boolean);
  }, [info]);

  const triggerIcons: string[] = React.useMemo(() => {
    return triggerTokens
      .map((t) => TRIGGER_ALIASES[t.toUpperCase()]) // normalize to canonical key
      .map((k) => (k ? TRIGGER_ICONS[k] : ""))
      .filter(Boolean);
  }, [triggerTokens]);

  // What we show in the "Trigger:" text row
  const triggerText =
    triggerTokens.length > 0 ? triggerTokens.join(", ") : "";

  return (
    <section className="mt-3 rounded-2xl border border-white/10 bg-white/5">
      {/* header is relative so we can pin icons top-right */}
      <header className="relative px-3 py-2 border-b border-white/10">
        <div className="text-xs uppercase tracking-wide text-white/70">
          Card details
        </div>
        <div className="text-sm font-semibold truncate text-white/90">
          {info?.name ?? card?.id ?? "Hover a card to see details"}
        </div>

        {/* Trigger icons (top-right) */}
        {triggerIcons.length > 0 && (
          <div className="absolute right-3 top-2 flex items-center gap-1">
            {triggerIcons.map((src, i) => (
              <img
                key={`${src}-${i}`}
                src={src}
                alt={`Trigger ${i + 1}`}
                className="w-6 h-6 select-none pointer-events-none drop-shadow"
                draggable={false}
              />
            ))}
          </div>
        )}
      </header>

      <div className="px-3 py-2 max-h-56 overflow-y-auto text-[12px] leading-snug space-y-2">
        {!info ? (
          <div className="text-white/60">
            Hover a card anywhere to preview its data. The last hovered card
            stays here.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-x-3 gap-y-1">
              {info.level !== undefined && (
                <div>
                  <span className="text-white/60">Level:</span> {info.level}
                </div>
              )}
              {info.cost !== undefined && (
                <div>
                  <span className="text-white/60">Cost:</span> {info.cost}
                </div>
              )}
              {info.power !== undefined && (
                <div>
                  <span className="text-white/60">Power:</span> {info.power}
                </div>
              )}
              {info.soul !== undefined && (
                <div>
                  <span className="text-white/60">Soul:</span> {info.soul}
                </div>
              )}

              {/* Trigger text row (kept for clarity) */}
              {triggerText && (
                <div className="col-span-3">
                  <span className="text-white/60">Trigger:</span>{" "}
                  {triggerText}
                </div>
              )}

              {(() => {
                const attrs = Array.isArray(info.attributes)
                  ? (info.attributes as string[]).join(" · ")
                  : (info.attributes ?? "");
                return attrs ? (
                  <div className="col-span-3">
                    <span className="text-white/60">Attributes:</span>{" "}
                    {attrs}
                  </div>
                ) : null;
              })()}
              {info.type && (
                <div className="col-span-3">
                  <span className="text-white/60">Type:</span> {info.type}
                </div>
              )}
              {info.color && (
                <div className="col-span-3">
                  <span className="text-white/60">Color:</span> {info.color}
                </div>
              )}
            </div>

            {Array.isArray(info.ability) && info.ability.length > 0 ? (
              <div className="mt-1">
                <div className="text-white/60">Ability:</div>
                <ul className="list-disc list-inside space-y-1">
                  {info.ability.map((line: string, i: number) => (
                    <li key={i} className="whitespace-pre-wrap">
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            ) : info.text || info.effect ? (
              <div className="mt-2 whitespace-pre-wrap text-white/85">
                {info.text ?? info.effect}
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
