// src/components/WSPlayfield/Zone.tsx
import React from "react";
import CardView from "./CardView";
import { ClosedStack, EmptySlot, FaceUpStack } from "./Stacks";
import { Card, ZoneKey } from "../../utils/cards";

type Props = {
  z: ZoneKey;
  zones: Record<ZoneKey, Card[]>;
  zonesToRender: Record<ZoneKey, Card[]>;
  readOnly: boolean;

  /** Hide the built-in Zone header & chrome (used when the parent panel already has a header) */
  headerless?: boolean;

  /** Back-compat: if someone passes variant="bare", treat it like headerless */
  variant?: "normal" | "bare";

  onOpenSearch?: (z: ZoneKey) => void;

  // dnd handlers
  onDragEnter?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;

  /** Drop handler; optional targetIndex lets zones handle swaps/insertions */
  onDropZone: (z: ZoneKey, targetIndex?: number | null) => (e: React.DragEvent) => void;

  // actions
  onDraw?: (n: number) => void;

  // visual
  rows?: number;
  cols?: number;
  /** When true, renders a simple flowing stack (used by some panels) */
  stack?: boolean;
  landscape?: boolean;

  // card view helpers
  catalog: Record<string, any>;
  onCardDragStart: Parameters<typeof CardView>[0]["onDragStart"];
  onSetCardRot: (z: ZoneKey, uid: string, rot: 0 | 90 | 180) => void;
  setHoverCard: (c: Card | null) => void;
};

function Zone({
  z, zones, zonesToRender, readOnly,
  onOpenSearch,
  onDragEnter, onDragOver, onDropZone,
  onDraw, rows = 1, cols = 1, stack = false,
  catalog, onCardDragStart, onSetCardRot, setHoverCard,
  headerless = false, variant = "normal",
  landscape = false,
}: Props) {
  const isBare = headerless || variant === "bare";

  // cards visible in this zone
  const cards: Card[] = zonesToRender[z] ?? [];

  const isDeck = z === "DECK";
  const isStock = z === "STOCK";
  const isWR = z === "WAITING_ROOM";
  const isMem = z === "MEMORY";
  const isTemp = z === "DECK_TEMP";

  // Splay layout for CLOCK & LEVEL
  const isClock = z === "CLOCK";
  const isLevel = z === "LEVEL";
  const isSplay = isClock || isLevel;
  const splayMax = isClock ? 7 : isLevel ? 3 : 0;      // visual capacity
  const splayOverlap = isClock ? 28 : 22;               // px overlap

  // Grid is everything else that isn't a custom renderer
  const isGrid = !isDeck && !isStock && !isWR && !isMem && !isTemp && !isSplay;

  const allowEnter = !readOnly ? onDragEnter : undefined;
  const allowDrop = !readOnly ? onDragOver : undefined;
  const parentDrop = !readOnly ? onDropZone(z) : undefined;

  // For real <div> elements
  const handleDropDiv: React.DragEventHandler<HTMLDivElement> | undefined = !readOnly
    ? (e) => { setHoverCard(null); parentDrop?.(e as unknown as React.DragEvent<Element>); }
    : undefined;

  // For components that expect DragEvent<Element>
  const handleDropAny: ((e: React.DragEvent<Element>) => void) | undefined = !readOnly
    ? (e) => { setHoverCard(null); parentDrop?.(e as any); }
    : undefined;

  const zoneLabel = (z0: ZoneKey) => ({
    CENTER_L: "Center L", CENTER_C: "Center C", CENTER_R: "Center R",
    BACK_L: "Back L", BACK_R: "Back R",
    CLIMAX: "Climax", LEVEL: "Level", CLOCK: "Clock",
    STOCK: "Stock", WAITING_ROOM: "Waiting Room", MEMORY: "Memory",
    DECK: "Deck", HAND: "Hand",
    DECK_TEMP: "Temp Deck",
  }[z0]);

  // Wrapper chrome (border/bg/padding) only if not bare
  const chromeClass = isBare ? "" : "rounded-2xl border border-white/10 bg-white/5 p-2";

  // CSS vars fallbacks so this file works even if the parent didn’t define them
  const CARD_W = "var(--card, 80px)";
  const CARD_H = "var(--cardH, 112px)";
  const GAP = "var(--gap, 12px)";

  return (
    <div className="flex flex-col gap-1">
      {/* Header is omitted when headerless/bare */}
      {!isBare && (
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wide text-white/70">
            {zoneLabel(z)} — {cards.length}
          </div>
          {!readOnly && (z === "DECK" || z === "WAITING_ROOM" || z === "STOCK" || z === "MEMORY") && (
            <button
              className="px-2 py-1 text-xs rounded-lg bg-white/10 hover:bg-white/20 border border-white/10"
              onClick={() => onOpenSearch?.(z)}
              title={`Search ${zoneLabel(z)}`}
            >
              Search
            </button>
          )}
        </div>
      )}

      <div
        onDragEnter={allowEnter}
        onDragOver={allowDrop}
        onDrop={handleDropDiv}
        className={chromeClass}
        style={
          isGrid
            ? {
              display: "grid",
              gridTemplateColumns: stack ? undefined : `repeat(${cols}, ${CARD_W})`,
              gridTemplateRows: stack ? undefined : `repeat(${rows}, ${CARD_H})`,
              gap: GAP,
              justifyItems: "center",
              alignItems: "center",
              minHeight: `calc(${CARD_H})`,
              justifyContent: "center",
              alignContent: "center",
            }
            : isSplay
              ? {
                position: "relative",
                display: "block",
                minHeight: `calc(${CARD_H})`,
                width: `calc(${CARD_W} + ${Math.max(Math.min(cards.length, splayMax) - 1, 0)} * (${CARD_W} - ${splayOverlap}px))`,
                overflow: "visible",
                // center LEVEL splay strip
                margin: isLevel ? "0 auto" : undefined,
              }
              : {
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minHeight: `calc(${CARD_H})`,
              }
        }
      >
        {/* Deck, Stock, Waiting Room have their own custom renderers */}
        {isDeck ? (
          <ClosedStack
            count={cards.length}
            title={zoneLabel(z)}
            onClick={!readOnly ? () => onDraw?.(1) : undefined}
            onDragEnter={allowEnter}
            onDragOver={allowDrop}
            onDrop={handleDropAny}
          />
        ) : isStock ? (
          <div
            className="cursor-grab active:cursor-grabbing"
            draggable={!readOnly && cards.length > 0}
            onDragStart={(e) => {
              if (readOnly || cards.length === 0) return;
              const top = cards[cards.length - 1];
              const payload = JSON.stringify({ uid: top.uid, from: "STOCK" });
              e.dataTransfer.setData("application/x-ws-card", payload);
              e.dataTransfer.setData("text/plain", payload);
              e.dataTransfer.effectAllowed = "move";
            }}
          >
            <ClosedStack
              count={cards.length}
              title={zoneLabel(z)}
              onDragEnter={allowEnter}
              onDragOver={allowDrop}
              onDrop={handleDropAny}
            />
          </div>
        ) : isWR ? (
          // WAITING ROOM: face-up STACK (not splayed) — show only the top card
          <div
            className="relative"
            onDragEnter={allowEnter}
            onDragOver={allowDrop}
            onDrop={handleDropAny}
            style={{ width: `calc(${CARD_W})`, height: `calc(${CARD_H})` }}
          >
            {cards.length === 0 ? (
              <EmptySlot />
            ) : (
              <CardView
                card={cards[cards.length - 1]}  // top card only
                zone={z}
                idx={cards.length - 1}
                readOnly={readOnly}
                catalog={catalog}
                onDragStart={onCardDragStart}
                onSetRot={(rot: 0 | 90 | 180) => onSetCardRot(z, cards[cards.length - 1].uid, rot)}
                setHoverCard={setHoverCard}
                slotLandscape={landscape}
              />
            )}
          </div>
        ) : isMem ? (
          // MEMORY: splayed FaceUpStack
          <FaceUpStack
            cards={cards}
            z={z}
            readOnly={readOnly}
            catalog={catalog}
            onDragEnter={allowEnter}
            onDragOver={allowDrop}
            onDrop={handleDropAny}
            onDragStart={onCardDragStart}
            onSetRot={onSetCardRot}
            setHoverCard={setHoverCard}
            slotLandscape={landscape}
          />
        ) : isTemp ? (
          // DECK_TEMP: face-up stack (shows each revealed card)
          <FaceUpStack
            cards={cards}
            z={z}
            readOnly={readOnly}
            catalog={catalog}
            onDragEnter={allowEnter}
            onDragOver={allowDrop}
            onDrop={handleDropAny}
            onDragStart={onCardDragStart}
            onSetRot={onSetCardRot}
            setHoverCard={setHoverCard}
            slotLandscape={landscape}
          />
        ) : isSplay ? (

          // ---------- SPLAY RENDERER (CLOCK & LEVEL) ----------
          <div
            onDragEnter={allowEnter}
            onDragOver={allowDrop}
            onDrop={handleDropDiv}
            style={{
              position: "relative",
              width: "100%", // visual width is set on wrapper above; this fills it
              height: `calc(${CARD_H})`,
            }}
          >
            {/* Empty placeholder when no cards */}
            {cards.length === 0 && (
              <div
                style={{
                  position: "absolute",
                  width: `calc(${CARD_W})`,
                  height: `calc(${CARD_H})`,
                  left: 0,
                  top: 0,
                }}
              >
                <EmptySlot />
              </div>
            )}

            {/* Splayed cards: rightmost on top (zIndex grows with i) */}
            {cards.slice(0, splayMax).map((c: Card, i: number) => (
              <div
                key={c.uid}
                onDragEnter={allowEnter}
                onDragOver={allowDrop}
                onDrop={
                  !readOnly
                    ? (e) => {
                      // signal “drop on card i”
                      setHoverCard(null);
                      onDropZone(z, i)(e);
                    }
                    : undefined
                }
                style={{
                  position: "absolute",
                  top: 0,
                  left: `calc(${i} * (${CARD_W} - ${splayOverlap}px))`,
                  width: `calc(${CARD_W})`,
                  height: `calc(${CARD_H})`,
                  zIndex: 1 + i,
                }}
              >
                <CardView
                  card={c}
                  zone={z}
                  idx={i}
                  readOnly={readOnly}
                  catalog={catalog}
                  onDragStart={onCardDragStart}
                  onSetRot={(rot: 0 | 90 | 180) => onSetCardRot(z, c.uid, rot)}
                  setHoverCard={setHoverCard}
                  slotLandscape={landscape}
                />
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* Grid cells */}
            {!stack &&
              Array.from({ length: rows * cols }).map((_, i: number) => (
                <div
                  key={i}
                  className="flex items-center justify-center overflow-visible"
                  onDragEnter={allowEnter}
                  onDragOver={allowDrop}
                  onDrop={handleDropDiv}
                  style={{ width: CARD_W as any, height: CARD_H as any }}
                >
                  {cards[i] ? (
                    <CardView
                      card={cards[i] as Card}
                      zone={z}
                      idx={i}
                      readOnly={readOnly}
                      catalog={catalog}
                      onDragStart={onCardDragStart}
                      onSetRot={(rot: 0 | 90 | 180) => onSetCardRot(z, (cards[i] as Card).uid, rot)}
                      setHoverCard={setHoverCard}
                      slotLandscape={landscape}
                    />
                  ) : (
                    <EmptySlot />
                  )}
                </div>
              ))}

            {/* Simple flowing stack (legacy) */}
            {stack && (
              <div
                className="col-span-8 flex flex-wrap gap-2"
                onDragEnter={allowEnter}
                onDragOver={allowDrop}
                onDrop={handleDropDiv}
                style={{ minHeight: CARD_H as any }}
              >
                {cards.length === 0 && <EmptySlot />}
                {cards.map((c: Card, i: number) => (
                  <CardView
                    key={c.uid}
                    card={c}
                    zone={z}
                    idx={i}
                    readOnly={readOnly}
                    catalog={catalog}
                    onDragStart={onCardDragStart}
                    onSetRot={(rot: 0 | 90 | 180) => onSetCardRot(z, c.uid, rot)}
                    setHoverCard={setHoverCard}
                    slotLandscape={landscape}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default Zone;
