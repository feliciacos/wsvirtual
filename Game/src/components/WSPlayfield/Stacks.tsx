// src/components/WSPlayfield/Stacks.tsx
import React from "react";
import CardView from "./CardView";
import { Card, ZoneKey } from "../../utils/cards";
import { CARD_BACK } from "../../config/constants";

export const EmptySlot = () => (
  <div
    className="rounded-xl border-2 border-dashed border-white/20 bg-black/10"
    style={{ width: "var(--card,80px)", height: "var(--cardH,112px)" }}
  />
);


// Face-up stacked pile (Waiting Room)
const FACEUP_FAN = { x: 10, y: 0, maxShown: 30 };

export const FaceUpStack: React.FC<{
  cards: Card[];
  z: ZoneKey;
  onDragEnter?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  readOnly: boolean;
  catalog: Record<string, any>;
  onDragStart: Parameters<typeof CardView>[0]["onDragStart"];
  onSetRot: (z: ZoneKey, uid: string, rot: 0 | 90 | 180) => void;
  setHoverCard: (c: Card | null) => void;
  slotLandscape?: boolean;  
}> = ({
  cards,
  z,
  onDragEnter,
  onDragOver,
  onDrop,
  readOnly,
  catalog,
  onDragStart,
  onSetRot,
  setHoverCard,
  slotLandscape = false,
}) => {
    const shown = Math.min(cards.length, FACEUP_FAN.maxShown);
    const width = 80 + Math.max(0, shown - 1) * FACEUP_FAN.x;

    return (
      <div
        className="relative h-28"
        style={{ width }}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {cards.length === 0 && <EmptySlot />}
        {cards.slice(0, shown).map((c, i) => (
          <div
            key={c.uid}
            className="absolute"
            style={{
              left: i * FACEUP_FAN.x,
              top: 0,
              width: "var(--card,80px)",
              height: "var(--cardH,112px)",
            }}
          >
            <CardView
              card={c}
              zone={z}
              idx={i}
              readOnly={readOnly}
              catalog={catalog}
              onDragStart={onDragStart}
              onSetRot={(rot) => onSetRot(z, c.uid, rot)}
              setHoverCard={setHoverCard}
              slotLandscape={slotLandscape}
            />
          </div>
        ))}

        {cards.length > shown && (
          <div className="absolute -top-2 -right-2 px-2 py-0.5 rounded-full bg-black/80 text-white text-[10px] border border-white/20">
            {cards.length}
          </div>
        )}
      </div>
    );
  };

/** Closed, face-down stack (e.g., Deck or Stock top). Now supports dragging the top card. */
export const ClosedStack: React.FC<{
  count: number;
  title: string;
  onClick?: () => void;
  onDragEnter?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;

  /** Enable dragging the top card (wrap will set the drag payload). */
  draggableTop?: boolean;
  /** Called when a drag starts so parent can set DnD data (e.g., top card uid/from zone). */
  onDragStartTop?: (e: React.DragEvent<HTMLButtonElement>) => void;
}> = ({
  count,
  title,
  onClick,
  onDragEnter,
  onDragOver,
  onDrop,
  draggableTop = false,
  onDragStartTop,
}) => {
    // Suppress accidental click after a drag operation
    const draggedRef = React.useRef(false);

    const handleClick = () => {
      if (draggedRef.current) {
        // A drag just happened; skip this click and clear flag.
        draggedRef.current = false;
        return;
      }
      onClick?.();
    };

    const handleDragStart = (e: React.DragEvent<HTMLButtonElement>) => {
      draggedRef.current = true;
      onDragStartTop?.(e);
    };

    const handleDragEnd = () => {
      // Ensure we clear the flag even if no click follows
      setTimeout(() => {
        draggedRef.current = false;
      }, 0);
    };

    return (
      <button
        title={`${title} — ${count}`}
        className="relative w-20 h-28 shrink-0 select-none active:scale-[0.98]"
        onClick={handleClick}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDrop={onDrop}
        // Only allow drag when enabled and there is at least one card
        draggable={draggableTop && count > 0}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <img
          src={CARD_BACK}
          alt={title}
          draggable={false}
          className="absolute inset-0 w-20 h-28 rounded-xl shadow-md border border-black/20 object-cover pointer-events-none"
        />
        {count > 0 && (
          <div className="absolute -top-2 -right-2 px-2 py-0.5 rounded-full bg-black/80 text-white text-[10px] border border-white/20">
            {count}
          </div>
        )}
      </button>
    );
  };
