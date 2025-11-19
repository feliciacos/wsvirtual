// src/config/constants.ts
export const STORAGE_KEY = "ws-proto-state-v4";

// Roots for card databases
export const PUBLIC_ROOT_EN = "/DB-ENG";
export const PUBLIC_ROOT_JP = "/DB-JP";

// Keep PUBLIC_ROOT for legacy (EN default)
export const PUBLIC_ROOT = PUBLIC_ROOT_EN;

export const TOP_INSERT_WINDOW = 3;

// drag & drop
export const DND_MIME = "application/x-ws-card";

// deck rules
export const DECK_MAX = 50;

// images / icons (these are your UI icons in /public/Images)
export const CARD_BACK = "/Images/Cards/card-back.png";
export const ICONS = {
  stand: "/Images/Icons/icon_stand.png",
  rest: "/Images/Icons/icon_rest.png",
  reverse: "/Images/Icons/icon_reverse.png",
} as const;

export const TRIGGER_ICON_ROOT = "/Images/Icons/Triggers";
export const TRIGGER_ICONS = {
  COMEBACK: `${TRIGGER_ICON_ROOT}/comeback.webp`,
  DRAW: `${TRIGGER_ICON_ROOT}/draw.webp`,
  GATE: `${TRIGGER_ICON_ROOT}/gate.webp`,
  POOL: `${TRIGGER_ICON_ROOT}/pool.webp`,
  RETURN: `${TRIGGER_ICON_ROOT}/return.webp`,
  SHOT: `${TRIGGER_ICON_ROOT}/shot.webp`,
  SOUL: `${TRIGGER_ICON_ROOT}/soul.webp`,
  TREASURE: `${TRIGGER_ICON_ROOT}/treasure.webp`,
} as const;

export const TRIGGER_ALIASES: Record<string, keyof typeof TRIGGER_ICONS> = {
  COMEBACK: "COMEBACK",
  DRAW: "DRAW",
  GATE: "GATE",
  POOL: "POOL",
  RETURN: "RETURN",
  SHOT: "SHOT",
  SOUL: "SOUL",
  SOULS: "SOUL",
  TREASURE: "TREASURE",
};