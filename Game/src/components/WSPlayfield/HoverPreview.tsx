// src/components/WSPlayfield/HoverPreview.tsx
import React from "react";
import { createPortal } from "react-dom";
import {
  Card,
  CardInfo,
  isClimaxMeta,
  lookupCardInfo,
} from "../../utils/cards";
import { imageUrlCandidatesFromId } from "../../utils/images";

type Props = {
  hoverCard: Card | null;
  catalog: Record<string, CardInfo>;
  pageZoom: number;
  portalRoot: HTMLElement | null;
  /** "panel" = pinned preview inside the panel slot, "floating" = classic hover overlay */
  mode?: "floating" | "panel";
};

export default function HoverPreview({
  hoverCard,
  catalog,
  pageZoom,
  portalRoot,
  mode = "panel",
}: Props) {
  // In panel mode, remember the last thing we hovered so it persists.
  const [pinned, setPinned] = React.useState<Card | null>(null);
  React.useEffect(() => {
    if (hoverCard) setPinned(hoverCard);
  }, [hoverCard]);

  const activeCard: Card | null =
    mode === "panel" ? hoverCard ?? pinned : hoverCard;

  const info = React.useMemo(
    () => (activeCard ? lookupCardInfo(catalog, activeCard.id) ?? null : null),
    [activeCard, catalog]
  );

  const isClimax = isClimaxMeta(info);

  // Build EN→JP, png→jpg, multi-filename candidates
  const candidates = React.useMemo(
    () => (activeCard ? imageUrlCandidatesFromId(activeCard.id, catalog as any) : []),
    [activeCard, catalog]
  );

  // Advance through candidates on <img> error
  const [idx, setIdx] = React.useState(0);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    setIdx(0);
    setFailed(false);
  }, [activeCard?.id, candidates.length]);

  if (!activeCard || !portalRoot) return null;

  const src = candidates[idx] ?? "";

  // =========================
  // PANEL MODE (edge-to-edge)
  // =========================
  if (mode === "panel") {
    return createPortal(
      <div className="absolute inset-0">
        {!failed ? (
          <img
            src={src}
            alt={activeCard.id}
            className="w-full h-full object-contain select-none pointer-events-none"
            draggable={false}
            onError={() => {
              if (idx < candidates.length - 1) setIdx((i) => i + 1);
              else setFailed(true);
            }}
          />
        ) : (
          <div className="w-full h-full" />
        )}
      </div>,
      portalRoot
    );
  }

  // =========================
  // FLOATING MODE (overlay)
  // =========================
  return createPortal(
    <div
      className="fixed z-[1000] w-[33rem] max-w-[95vw] rounded-2xl bg-slate-900/90 backdrop-blur shadow-2xl p-3 pointer-events-none border-2"
      style={{
        top: "max(env(safe-area-inset-top, 0px), 0.5rem)",
        left: "max(env(safe-area-inset-left, 0px), 0.5rem)",
        transformOrigin: "top left",
        transform: `scale(${1 / pageZoom}) translateZ(0)`,
        willChange: "transform",
        width: isClimax ? "46rem" : "33rem",
      }}
    >
      <div className="rounded-xl overflow-hidden border border-white/10 mb-3">
        {!failed ? (
          <img
            src={src}
            alt={activeCard.id}
            className="w-full h-auto object-contain"
            draggable={false}
            onError={() => {
              if (idx < candidates.length - 1) setIdx((i) => i + 1);
              else setFailed(true);
            }}
          />
        ) : (
          <div className="w-full h-[28rem] bg-gradient-to-br from-slate-700 to-slate-900" />
        )}
      </div>

      {/* Floating metadata (kept from original) */}
      <div className="text-xs text-white/90 space-y-2 pointer-events-none">
        <div className="text-sm font-semibold">
          {info?.name ?? activeCard.id}
        </div>

        {info && (
          <div className="grid grid-cols-3 gap-x-3 gap-y-1 leading-tight">
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
            {(() => {
              const t = Array.isArray(info?.trigger)
                ? info!.trigger.join(", ")
                : info?.trigger ?? "";
              return t ? (
                <div className="col-span-3">
                  <span className="text-white/60">Trigger:</span> {t}
                </div>
              ) : null;
            })()}
            {(() => {
              const attrs = Array.isArray(info?.attributes)
                ? (info!.attributes as string[]).join(" · ")
                : info?.attributes ?? "";
              return attrs ? (
                <div className="col-span-3">
                  <span className="text-white/60">Attributes:</span> {attrs}
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
        )}

        {Array.isArray(info?.ability) && info!.ability.length > 0 ? (
          <div className="mt-1">
            <div className="text-white/60">Ability:</div>
            <ul className="list-disc list-inside space-y-1 text-[11px]">
              {info!.ability.map((line: string, i: number) => (
                <li key={i} className="whitespace-pre-wrap">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ) : info?.text || info?.effect ? (
          <div className="mt-2 text-[11px] leading-snug whitespace-pre-wrap text-white/85">
            {info.text ?? info.effect}
          </div>
        ) : null}
      </div>
    </div>,
    portalRoot
  );
}
