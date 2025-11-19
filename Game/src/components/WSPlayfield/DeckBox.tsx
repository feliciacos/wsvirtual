// src/components/WSPlayfield/DeckBox.tsx
import React from "react";
import { Card, ZoneKey } from "../../utils/cards";
import { ClosedStack, FaceUpStack } from "./Stacks";
import CardView from "./CardView";

type Props = {
  zones: Record<ZoneKey, Card[]>;
  readOnly: boolean;

  // actions / handlers
  onDraw?: (n?: number) => void;
  onOpenSearch?: (z: ZoneKey) => void;
  onDragEnter?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDropZone: (z: ZoneKey) => (e: React.DragEvent) => void;

  // card helpers
  catalog: Record<string, any>;
  onCardDragStart: Parameters<typeof CardView>[0]["onDragStart"];
  onSetCardRot: (z: ZoneKey, uid: string, rot: 0 | 90 | 180) => void;
  setHoverCard: (c: Card | null) => void;

  /** When true, render without DeckBox's own header/border. */
  bare?: boolean;

  /** When false, don't render the Temp (DECK_TEMP) pile. Defaults to true. */
  showTemp?: boolean;
};

const DeckBox: React.FC<Props> = ({
  zones,
  readOnly,
  onDraw,
  onOpenSearch,
  onDragEnter,
  onDragOver,
  onDropZone,
  catalog,
  onCardDragStart,
  onSetCardRot,
  setHoverCard,
  bare = false,
  showTemp = true,
}) => {
  const deck = zones.DECK ?? [];
  const temp = zones.DECK_TEMP ?? [];

  const allowEnter = !readOnly ? onDragEnter : undefined;
  const allowOver = !readOnly ? onDragOver : undefined;
  const dropDeck = !readOnly ? onDropZone("DECK") : undefined;
  const dropTemp = !readOnly ? onDropZone("DECK_TEMP") : undefined;

  /** Core content: facedown deck stack + (optional) face-up temp stack side-by-side */
  const content = (
    <div className="flex items-center" style={{ gap: "var(--gap)" }}>
      {/* Deck stack (left) */}
      <div
        className="flex items-center justify-center"
        style={{ width: "var(--card)", height: "var(--cardH)" }}
        onDragEnter={allowEnter}
        onDragOver={allowOver}
        onDrop={dropDeck}
      >
        <ClosedStack
          count={deck.length}
          title="Deck"
          onClick={!readOnly ? () => onDraw?.(1) : undefined}
          onDragEnter={allowEnter}
          onDragOver={allowOver}
          onDrop={dropDeck}
          draggableTop={!readOnly && deck.length > 0}
          onDragStartTop={(e) => {
            if (readOnly || deck.length === 0) return;
            // Top of deck is index 0 in this app
            onCardDragStart({ uid: deck[0].uid, from: "DECK" }, e, null);
          }}
        />
      </div>

      {/* Temp pile (right) */}
      {showTemp && (
        <div
          className="flex items-center justify-center"
          style={{ width: "var(--card)", height: "var(--cardH)" }}
          onDragEnter={allowEnter}
          onDragOver={allowOver}
          onDrop={dropTemp}
        >
          <FaceUpStack
            cards={temp}
            z="DECK_TEMP"
            readOnly={readOnly}
            catalog={catalog}
            onDragEnter={allowEnter}
            onDragOver={allowOver}
            onDrop={dropTemp}
            onDragStart={onCardDragStart}
            onSetRot={onSetCardRot}
            setHoverCard={setHoverCard}
          />
        </div>
      )}
    </div>
  );

  if (bare) return content;

  return (
    <section
      className="rounded-2xl border border-white/10 bg-white/5 p-[var(--gap)]"
      style={{ minHeight: `calc(var(--cardH) + var(--gap) * 2 + 24px)` }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase tracking-wide text-white/70">
          DECK — {deck.length}
        </div>
        {!readOnly && (
          <button
            className="px-2 py-1 text-xs rounded-lg bg-white/10 hover:bg-white/20 border border-white/10"
            onClick={() => onOpenSearch?.("DECK")}
            title="Search Deck"
          >
            Search
          </button>
        )}
      </div>
      {content}
    </section>
  );
};

export default DeckBox;
