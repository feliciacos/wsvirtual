import React from "react";
import {
  Card,
  CardInfo,
  ZoneKey,
  isStage,
  lookupCardInfo,
  isClimaxMeta,
} from "../../utils/cards";
import { imageUrlCandidatesFromId, colorToBorder, ICONS } from "../../utils/images";

type Props = {
  card: Card;
  zone: ZoneKey;
  idx: number;
  readOnly: boolean;
  catalog: Record<string, CardInfo>;
  onDragStart: (
    payload: { uid: string; from: ZoneKey },
    e: React.DragEvent,
    visualEl: HTMLDivElement | null
  ) => void;
  onSetRot: (rot: 0 | 90 | 180) => void;
  setHoverCard: (c: Card | null) => void;
  /** True when the *slot* itself is landscape (e.g., your rotated CLIMAX/MEMORY panels). */
  slotLandscape?: boolean;
};

const CardView: React.FC<Props> = ({
  card, zone, idx, readOnly, catalog, onDragStart, onSetRot, setHoverCard,
  slotLandscape = false,
}) => {
  const visualRef = React.useRef<HTMLDivElement>(null);

  const meta = lookupCardInfo(catalog, card.id) ?? null;
  const cardBorder = colorToBorder(meta?.color);
  const rot = card.rot ?? 0;

  // Climax cards are landscape; rotate the image inside portrait slots.
  // If the slot is already landscape (because the panel was rotated), rotate -90 instead.
  const isClimaxCard = isClimaxMeta(meta);
  const innerRotate = isClimaxCard ? (slotLandscape ? -90 : 90) : 0;

  // image sources
  const candidates = React.useMemo(
    () => imageUrlCandidatesFromId(card.id, catalog as any),
    [card.id, catalog]
  );
  const [candIdx, setCandIdx] = React.useState(0);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => { setCandIdx(0); setFailed(false); }, [card.id, candidates.length]);

  const src = candidates[candIdx] ?? "";

  // marks
  const marks = card.marks ?? 0;
  const showMarks = marks > 0;

  return (
    <div
      className="relative select-none"
      style={{ width: "100%", height: "100%" }}
      title={card.id}
      draggable={!readOnly}
      onDragStart={
        readOnly ? undefined : (e) => onDragStart({ uid: card.uid, from: zone }, e, visualRef.current)
      }
      onMouseEnter={() => setHoverCard(card)}
      onMouseLeave={() => setHoverCard(null)}
    >
      <div
        ref={visualRef}
        className="absolute inset-0 rounded-xl shadow-md bg-black overflow-hidden cursor-grab active:cursor-grabbing transition-transform border-2"
        style={{ transform: `rotate(${rot}deg)`, transformOrigin: "50% 50%", borderColor: cardBorder }}
      >
        {!failed ? (
          innerRotate !== 0 ? (
            /* Rotated inner wrapper: swap width/height using the same CSS vars your slots use.
               This avoids first-render letterboxing and fills the card perfectly. */
            <div
              className="absolute left-1/2 top-1/2 will-change-transform"
              style={{
                width: "var(--cardH,112px)",   // swapped
                height: "var(--card,80px)",     // swapped
                transform: `translate(-50%, -50%) rotate(${innerRotate}deg)`,
                transformOrigin: "50% 50%",
              }}
            >
              <img
                src={src}
                alt={card.id}
                draggable={false}
                className="w-full h-full object-cover select-none pointer-events-none"
                onError={() => {
                  if (candIdx < candidates.length - 1) setCandIdx(i => i + 1);
                  else setFailed(true);
                }}
              />
            </div>
          ) : (
            <img
              src={src}
              alt={card.id}
              draggable={false}
              className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none"
              onError={() => {
                if (candIdx < candidates.length - 1) setCandIdx(i => i + 1);
                else setFailed(true);
              }}
            />
          )
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-slate-700 to-slate-900" />
        )}

        <div className="absolute bottom-1 left-1 text-[10px] text-white/90 drop-shadow">#{idx + 1}</div>

        {showMarks && (
          <div
            className="absolute bottom-1 right-1 rounded-full min-w-5 h-5 px-1 flex items-center justify-center text-[11px] font-semibold
                       bg-amber-500/90 text-black shadow-md pointer-events-none select-none"
            style={{ lineHeight: "1" }}
            title={`${marks} mark${marks === 1 ? "" : "s"}`}
          >
            {marks}
          </div>
        )}
      </div>

      {isStage(zone) && !readOnly && (
        <div className="absolute left-[-2.6rem] top-1/2 -translate-y-1/2 flex flex-col gap-1 z-10">
          <button
            className="w-6 h-6 rounded-md border border-white/20 bg-black/70 hover:bg-black/80 overflow-hidden"
            title="Stand (0°)"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onSetRot(0); }}
          >
            <img src={ICONS.stand} alt="Stand" className="w-full h-full object-contain pointer-events-none" />
          </button>
          <button
            className="w-6 h-6 rounded-md border border-white/20 bg-black/70 hover:bg-black/80 overflow-hidden"
            title="Rest (90°)"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onSetRot(90); }}
          >
            <img src={ICONS.rest} alt="Rest" className="w-full h-full object-contain pointer-events-none" />
          </button>
          <button
            className="w-6 h-6 rounded-md border border-white/20 bg-black/70 hover:bg-black/80 overflow-hidden"
            title="Reverse (180°)"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onSetRot(180); }}
          >
            <img src={ICONS.reverse} alt="Reverse" className="w-full h-full object-contain pointer-events-none" />
          </button>
        </div>
      )}
    </div>
  );
};

export default CardView;
