import React, { useEffect, useMemo, useRef, useLayoutEffect, useState } from "react";
import usePageZoom from "../../hooks/usePageZoom";
import Zone from "./Zone";
import HoverPreview from "./HoverPreview";
import SearchModal from "./SearchModal";
import DeckBox from "./DeckBox";
import CardView from "./CardView";
import { Card, CardInfo, ZoneKey, isStage, shuffle, lookupCardInfo, isClimaxMeta } from "../../utils/cards";
import { jsonUrlsCandidates, setKeyFromId, pickCode, codeAliases, splitId } from "../../utils/ids";
import { DND_MIME, DECK_MAX, STORAGE_KEY } from "../../config/constants";
import { createPortal } from "react-dom";
import { collectSetKeysFromIds } from "../../utils/deckParse";
import CardMetaPane from "./CardMetaPane";
import ConfirmBox from "../ui/ConfirmBox";
import MarkMenu from "../ui/MarkMenu";

function setKeyFromCode(code: string): string {
  const p = splitId(code.toUpperCase());
  if (p) return p.setUnd;                // "AAA_BBB"
  const k = setKeyFromId(code);          // try our normal path
  if (k) return k;
  const m = code.toUpperCase().match(/^([A-Z0-9]{1,6})\/([A-Z0-9]{1,4})/);
  return m ? `${m[1]}_${m[2]}` : code.toUpperCase();
}

function idsFrom(zs: Record<string, Card[] | undefined>): string[] {
  const ids: string[] = [];
  for (const k in zs) {
    const arr = zs[k];
    if (Array.isArray(arr)) for (const c of arr) ids.push(c.id);
  }
  return ids;
}

export type LayoutMode = "vertical" | "horizontal";

const makeUID = (() => { let n = 0; return () => `${Date.now().toString(36)}_${(n++).toString(36)}`; })();

type WSPlayfieldProps = {
  readOnly?: boolean;
  externalZones?: Record<ZoneKey, Card[]> | null;
  onZonesChange?: (z: Record<ZoneKey, Card[]>) => void;
  layout: "vertical" | "horizontal";
  side: "left" | "right";
};

const setCardRot = (
  z: ZoneKey, uid: string, rot: 0 | 90 | 180,
  setZonesFn: React.Dispatch<React.SetStateAction<Record<ZoneKey, Card[]>>>
) => {
  setZonesFn(prev => {
    const next = { ...prev, [z]: [...prev[z]] };
    const i = next[z].findIndex(c => c.uid === uid);
    if (i !== -1) next[z][i] = { ...next[z][i], rot };
    return next;
  });
};



function WSPlayfield({ readOnly = false, externalZones, onZonesChange, layout }: WSPlayfieldProps) {
  const [panelRoot, setPanelRoot] = React.useState<HTMLElement | null>(null);
  const pageZoom = usePageZoom();

  // measure untransformed content for horizontal rotation math
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [natural, setNatural] = React.useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const update = () => setNatural({ w: el.offsetWidth, h: el.offsetHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => { ro.disconnect(); window.removeEventListener("resize", update); };
  }, [layout, externalZones, pageZoom]);

  // All cards from loaded sets
  const [catalog, setCatalog] = useState<Record<string, CardInfo>>({});
  const [setOrderIndex, setSetOrderIndex] = useState<Record<string, Record<string, number>>>({});

  const [loadingSets, setLoadingSets] = useState<Set<string>>(new Set());

  // Local zones (your board)
  const [zones, setZones] = useState<Record<ZoneKey, Card[]>>({
    CENTER_L: [], CENTER_C: [], CENTER_R: [],
    BACK_L: [], BACK_R: [],
    CLIMAX: [], LEVEL: [], CLOCK: [],
    STOCK: [], WAITING_ROOM: [], MEMORY: [],
    DECK: [], HAND: [],
    DECK_TEMP: [],
  });

  const viewZones = externalZones ?? zones;
  useEffect(() => { if (!readOnly && onZonesChange) onZonesChange(zones); }, [zones, readOnly, onZonesChange]);

  // ----- data loading helpers -----
  const loadSets = async (setKeys: string[]) => {
    // unique keys
    const keys = Array.from(new Set(setKeys.filter(Boolean)));
    if (keys.length === 0) return;

    // filter out sets that are already loaded or currently loading
    const toLoad = keys.filter(k => {
      if (loadingSets.has(k)) return false;              // already being fetched
      if (setOrderIndex[k]) return false;               // already set in state
      if (loadedSetsRef.current.has(k)) return false;   // immediate guard
      return true;
    });
    if (toLoad.length === 0) return;

    // mark as loading immediately to prevent races
    setLoadingSets(prev => new Set([...prev, ...toLoad]));

    const tryFetch = async (url: string) => {
      try {
        // allow browser cache to be used when available (avoid revalidation round-trips)
        const r = await fetch(url, { cache: "force-cache" });
        if (!r.ok) return null;
        return await r.json();
      } catch {
        return null;
      }
    };

    const fetchSetAny = async (setKey: string) => {
      for (const cand of jsonUrlsCandidates(setKey)) {
        const data = await tryFetch(cand.url);
        if (data) return { lang: cand.lang, data };
      }
      return { lang: "EN" as const, data: null };
    };

    const results = await Promise.all(
      toLoad.map(async (setKey) => ({ setKey, ...(await fetchSetAny(setKey)) }))
    );

    const nextCatalog: Record<string, (CardInfo & { __lang?: "EN" | "JP" })> = {};
    const nextOrder: Record<string, Record<string, number>> = {};
    results.forEach(({ setKey, lang, data }) => {
      if (!data) return;
      const orderForSet: Record<string, number> = {};
      let idx = 0;
      if (Array.isArray(data)) {
        data.forEach((raw: any) => {
          const code = pickCode(raw);
          if (!code) return;
          const up = code.toUpperCase();
          const meta = { ...raw, __lang: lang } as any;
          idx += 1;
          orderForSet[up] = idx;
          nextCatalog[up] = meta;
          for (const a of codeAliases(up)) if (!nextCatalog[a]) nextCatalog[a] = meta;
        });
      } else if (data && typeof data === "object") {
        Object.entries<any>(data).forEach(([maybeCode, raw]) => {
          const code = (pickCode({ code: maybeCode, ...raw }) || maybeCode).toUpperCase();
          if (!code) return;
          const meta = { ...raw, __lang: lang } as any;
          idx += 1;
          orderForSet[code] = idx;
          nextCatalog[code] = meta;
          for (const a of codeAliases(code)) if (!nextCatalog[a]) nextCatalog[a] = meta;
        });
      }
      if (idx > 0) nextOrder[setKey] = orderForSet;
    });

    // merge into state
    setCatalog(prev => ({ ...prev, ...nextCatalog }));
    Object.keys(nextOrder).forEach(k => loadedSetsRef.current.add(k));
    setSetOrderIndex(prev => {
      const merged: typeof prev = { ...prev };
      for (const k of Object.keys(nextOrder)) merged[k] = nextOrder[k];
      return merged;
    });

    // remove loading flags for these keys
    setLoadingSets(prev => {
      const s = new Set(prev);
      for (const k of toLoad) s.delete(k);
      return s;
    });
  };


  // minimal dedupe: only call loadSets when the *set of keys* actually changes
  const lastRequestedKeysRef = React.useRef<string | null>(null);
  const loadedSetsRef = React.useRef<Set<string>>(new Set());

  useEffect(() => {
    const ids: string[] = [];
    (Object.keys(viewZones) as ZoneKey[]).forEach(z => viewZones[z].forEach(c => ids.push(c.id)));

    const keys = collectSetKeysFromIds(ids).filter(Boolean);
    keys.sort(); // stable order so signature is comparable

    const sig = keys.join("|");
    if (sig && sig !== lastRequestedKeysRef.current) {
      lastRequestedKeysRef.current = sig;
      loadSets(keys);
    }
    // clear the signature when there are no keys so future loads can trigger
    if (keys.length === 0) lastRequestedKeysRef.current = null;

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewZones]);


  // simple LRU-ish trim of catalog by set
  const MAX_SETS_IN_MEMORY = 6;
  const trimTimer = React.useRef<number | null>(null);
  const lastUsedRef = React.useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const inUseIds = idsFrom(viewZones);
    const keysInUse = new Set(collectSetKeysFromIds(inUseIds));
    if (keysInUse.size) {
      const now = Date.now();
      keysInUse.forEach(k => {
        const prevTs = lastUsedRef.current.get(k) ?? 0;
        if (now > prevTs) lastUsedRef.current.set(k, now);
      });
    }
    if (trimTimer.current) window.clearTimeout(trimTimer.current);
    trimTimer.current = window.setTimeout(() => {
      setCatalog((prev) => {
        const loadedSets = new Set<string>();
        for (const code in prev) loadedSets.add(setKeyFromCode(code));
        if (loadedSets.size <= MAX_SETS_IN_MEMORY) return prev;

        const evictable: Array<{ k: string; ts: number }> = [];
        loadedSets.forEach(k => { if (!keysInUse.has(k)) evictable.push({ k, ts: lastUsedRef.current.get(k) ?? 0 }); });
        evictable.sort((a, b) => a.ts - b.ts);

        const needToEvict = Math.max(0, loadedSets.size - MAX_SETS_IN_MEMORY);
        const toEvict = new Set(evictable.slice(0, needToEvict).map(e => e.k));
        if (toEvict.size === 0) return prev;

        const next: typeof prev = {};
        for (const code in prev) if (!toEvict.has(setKeyFromCode(code))) next[code] = prev[code];
        return next;
      });
    }, 400);
    return () => { if (trimTimer.current) { window.clearTimeout(trimTimer.current); trimTimer.current = null; } };
  }, [viewZones]);

  // persist local zones (your board)
  useEffect(() => {
    if (!readOnly) {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      try { const p = JSON.parse(raw); if (p?.zones) setZones(p.zones); } catch { }
    }
  }, [readOnly]);
  useEffect(() => { if (!readOnly) localStorage.setItem(STORAGE_KEY, JSON.stringify({ zones })); }, [zones, readOnly]);

  const [hoverCard, setHoverCard] = useState<Card | null>(null);
  const [pinnedCard, setPinnedCard] = useState<Card | null>(null);
  // Centralized confirm modal state
  const [confirm, setConfirm] = useState<{
    open: boolean;
    title: string;
    message: string;
    confirmText: string;
    onConfirm: () => void;
  }>({
    open: false,
    title: "",
    message: "",
    confirmText: "Sure",
    onConfirm: () => { },
  });

  const ask = (opts: Partial<typeof confirm>) =>
    setConfirm({
      open: true,
      title: opts.title ?? "Are you sure?",
      message: opts.message ?? "",
      confirmText: opts.confirmText ?? "Sure",
      onConfirm: opts.onConfirm ?? (() => { }),
    });

  useEffect(() => { if (hoverCard) setPinnedCard(hoverCard); }, [hoverCard]);
  const [damageValue, setDamageValue] = useState<number>(-1);

  // lock UI while applying damage/heal
  const [isResolving, setIsResolving] = React.useState(false);

  const [hasSeenPreview, setHasSeenPreview] = React.useState(false);
  React.useEffect(() => {
    // flip once when we first have something to show
    if ((hoverCard || pinnedCard) && !hasSeenPreview) setHasSeenPreview(true);
  }, [hoverCard, pinnedCard, hasSeenPreview]);

  const [searchZone, setSearchZone] = useState<ZoneKey | null>(null);

  const searchOpen = !!searchZone;

  const openSearch = (z: ZoneKey) => {
    const ids = (viewZones[z] ?? []).map(c => c.id);
    const keys = collectSetKeysFromIds(ids);
    if (keys.length) loadSets(keys);
    setSearchZone(z);
  };

  const draw = (n = 1) => {
    if (readOnly) return;
    setZones(z => { const d = [...z.DECK], h = [...z.HAND]; for (let i = 0; i < n; i++) { const c = d.shift(); if (c) h.push(c); } return { ...z, DECK: d, HAND: h }; });
  };
  const shuffleDeck = () => { if (readOnly) return; setZones(z => ({ ...z, DECK: shuffle(z.DECK) })); };


  const wait = (ms: number) => new Promise(res => setTimeout(res, ms));
  // yield one frame so React paints the previous setZones before we await 1s
  const raf = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

  /** Temporarily clear DECK_TEMP, run fn, then restore the previous temp pile. */
  const withTempIsolated = async (fn: () => Promise<void> | void) => {
    const prevTemp = (zonesRef.current?.DECK_TEMP ?? []).slice();
    setZones(z => ({ ...z, DECK_TEMP: [] }));
    await raf();
    try {
      await fn();
    } finally {
      setZones(z => ({ ...z, DECK_TEMP: prevTemp }));
      await raf();
    }
  };

  /**
 * Refresh: shuffle Waiting Room into Deck, then resolve a 1pt "refresh damage".
 * That 1pt is its own damage instance (can cancel) and does NOT cancel the original packet.
 */
  const doRefresh = async () => {
    // 1) Shuffle WR -> DECK
    setZones(z => {
      if (z.WAITING_ROOM.length === 0) return z;
      const newDeck = shuffle([...z.WAITING_ROOM]);
      return { ...z, DECK: newDeck, WAITING_ROOM: [] };
    });
    await raf();

    // 2) Animate and resolve the 1pt refresh damage in an isolated temp pile
    await withTempIsolated(async () => {
      let revealed: Card | undefined;

      // Reveal TOP -> DECK_TEMP
      setZones(z => {
        if (z.DECK.length === 0) return z;
        const deck = [...z.DECK];
        const temp = [...z.DECK_TEMP];
        revealed = deck.shift();
        if (revealed) temp.push(revealed);
        return { ...z, DECK: deck, DECK_TEMP: temp };
      });
      await raf();

      if (!revealed) return;

      // Show the card
      await wait(1000);

      // Climax check
      const meta = lookupCardInfo(catalog, revealed.id);
      const isClimax = !!(meta && isClimaxMeta(meta));

      // Finalize the single-card temp pile
      setZones(z => {
        if (z.DECK_TEMP.length === 0) return z;
        const moving = z.DECK_TEMP; // one card
        if (isClimax) {
          // Cancel ONLY the refresh point
          return { ...z, DECK_TEMP: [], WAITING_ROOM: [...z.WAITING_ROOM, ...moving] };
        } else {
          // Take the refresh point: top of Clock is index 0
          const toClockTopFirst = [...moving].reverse();
          return { ...z, DECK_TEMP: [], CLOCK: [...toClockTopFirst, ...z.CLOCK] };
        }
      });
      await raf();
    });
  };


  const applyDamage = async (amount: number) => {
    if (readOnly || amount <= 0) return;

    // Best-effort meta preload
    try {
      const deck0 = zonesRef.current?.DECK ?? [];
      const ids0 = deck0.slice(0, amount).map(c => c.id);
      const keys0 = collectSetKeysFromIds(ids0);
      if (keys0.length) await loadSets(keys0);
    } catch { }

    let climaxHit = false;

    for (let i = 0; i < amount; i++) {
      // Need a card but deck is empty → refresh then continue
      if ((zonesRef.current?.DECK?.length ?? 0) === 0) {
        if ((zonesRef.current?.WAITING_ROOM?.length ?? 0) === 0) break; // nothing to refresh from
        await doRefresh();
        await raf(); // ensure zonesRef syncs
        const topCardAfterRefresh = zonesRef.current?.DECK?.[0];
        if (topCardAfterRefresh) {
          const meta = lookupCardInfo(catalog, topCardAfterRefresh.id);
          if (meta && isClimaxMeta(meta)) {
            // The refresh deck’s top card is a climax – this means the refresh damage just canceled.
            // No damage was taken, but the next reveal will hit the same card and must cancel the packet.
            // Optional: mark a flag so the very next loop iteration auto-cancels.
          }
        }

        // Optional: preload meta post-refresh
        try {
          const remain = amount - i;
          const deckNow = zonesRef.current?.DECK ?? [];
          const ids2 = deckNow.slice(0, remain).map(c => c.id);
          const keys2 = collectSetKeysFromIds(ids2);
          if (keys2.length) await loadSets(keys2);
        } catch { }
      }

      let revealed: Card | undefined;

      // Reveal TOP -> DECK_TEMP (builds the original packet's pile)
      setZones(z => {
        if (z.DECK.length === 0) return z;
        const deck = [...z.DECK];
        const temp = [...z.DECK_TEMP];
        revealed = deck.shift();
        if (revealed) temp.push(revealed);
        return { ...z, DECK: deck, DECK_TEMP: temp };
      });
      await raf();

      if (!revealed) break;

      // Show it
      await wait(1000);

      // Climax check on the original packet
      const meta = lookupCardInfo(catalog, revealed.id);
      const isClimax = !!(meta && isClimaxMeta(meta));
      if (isClimax) {
        climaxHit = true;
        break;
      }
    }

    // Finalize the original packet
    setZones(z => {
      if (z.DECK_TEMP.length === 0) return z;
      const moving = z.DECK_TEMP;
      if (climaxHit) {
        return { ...z, DECK_TEMP: [], WAITING_ROOM: [...z.WAITING_ROOM, ...moving] };
      } else {
        const toClockTopFirst = [...moving].reverse();
        return { ...z, DECK_TEMP: [], CLOCK: [...toClockTopFirst, ...z.CLOCK] };
      }
    });
  };



  /**
   * Apply "heal": move the TOP card of CLOCK to WAITING_ROOM.
   * If value > 1, do it that many times (capped by CLOCK length).
   * @param amount number of heals to perform (>= 1)
   */
  const applyHeal = (amount: number) => {
    if (readOnly || amount <= 0) return;

    setZones(z => {
      if (z.CLOCK.length === 0) return z;
      let remaining = Math.min(amount, z.CLOCK.length);
      const clock = [...z.CLOCK];
      const wr = [...z.WAITING_ROOM];
      while (remaining > 0 && clock.length > 0) {
        // Top of CLOCK is the last pushed? We render as a splay but treat index 0 as top
        // Keep consistent with your existing splay: take the "top" visually from leftmost index 0
        const topClock = clock[0];
        clock.splice(0, 1);
        wr.push(topClock);
        remaining--;
      }
      return { ...z, CLOCK: clock, WAITING_ROOM: wr };
    });
  };

  /** Handler for the button based on current spinner value */
  const onApplyDamageHeal = async () => {
    const v = damageRef.current;          // <- always the latest value
    if (v === 0 || isResolving) return;

    setIsResolving(true);
    try {
      if (v < 0) {
        await applyDamage(Math.abs(v));
      } else {
        applyHeal(v);
      }
    } finally {
      setIsResolving(false);
    }
  };



  // ---- Updated helpers ----

  // Clear hand: move all hand cards to the BOTTOM of the deck
  const clearHandToBottom = () => {
    if (readOnly) return;
    setZones(z => {
      if (z.HAND.length === 0) return z;
      return { ...z, HAND: [], DECK: [...z.DECK, ...z.HAND] };
    });
  };

  // Clear+Shuffle: move hand to bottom, then shuffle the whole deck
  const clearHandToBottomAndShuffle = () => {
    if (readOnly) return;
    setZones(z => {
      const merged = [...z.DECK, ...z.HAND];
      return { ...z, HAND: [], DECK: shuffle(merged) };
    });
  };

  // Shuffle all WAITING_ROOM back into top of DECK (unchanged)
  const shuffleWaitingRoomIntoDeck = () => {
    if (readOnly) return;
    setZones(z => {
      if (z.WAITING_ROOM.length === 0) return z;
      const moved = shuffle([...z.WAITING_ROOM]);
      return { ...z, WAITING_ROOM: [], DECK: [...moved, ...z.DECK] };
    });
  };

  // Stock “pay” helpers (unchanged)
  const payTopFromStock = () => {
    if (readOnly) return;
    setZones(z => {
      if (z.STOCK.length === 0) return z;
      const stock = [...z.STOCK];
      const top = stock[stock.length - 1];
      stock.splice(stock.length - 1, 1);
      return { ...z, STOCK: stock, WAITING_ROOM: [...z.WAITING_ROOM, top] };
    });
  };

  const payBottomFromStock = () => {
    if (readOnly) return;
    setZones(z => {
      if (z.STOCK.length === 0) return z;
      const stock = [...z.STOCK];
      const bottom = stock[0];
      stock.splice(0, 1);
      return { ...z, STOCK: stock, WAITING_ROOM: [...z.WAITING_ROOM, bottom] };
    });
  };

  // ---- Deck Mill helpers (updated to move cards to HAND) ----

  // Mill Top: remove the top card from DECK and move it to HAND
  const millTopFromDeck = () => {
    if (readOnly) return;
    setZones(z => {
      if (z.DECK.length === 0) return z;
      const deck = [...z.DECK];
      const top = deck[0]; // top of deck is index 0 (matches draw)
      deck.splice(0, 1);
      return { ...z, DECK: deck, HAND: [...z.HAND, top] };
    });
  };

  // Mill Bottom: remove the bottom card from DECK and move it to HAND
  const millBottomFromDeck = () => {
    if (readOnly) return;
    setZones(z => {
      if (z.DECK.length === 0) return z;
      const deck = [...z.DECK];
      const bottom = deck[deck.length - 1];
      deck.splice(deck.length - 1, 1);
      return { ...z, DECK: deck, HAND: [...z.HAND, bottom] };
    });
  };


  // ---- New helpers ----
  const clearHand = () => {
    if (readOnly) return;
    setZones(z => ({ ...z, HAND: [] }));
  };

  const confirmAnd = (msg: string, fn: () => void) => {
    // Simple confirm; if you want a custom modal later we can swap this out
    if (window.confirm(msg)) fn();
  };

  // “Clear/Shuffle” -> confirm then shuffle deck
  const confirmShuffleDeck = () =>
    confirmAnd("Are you sure you want to shuffle the deck?", () => shuffleDeck());

  // “Clear Hand” -> confirm then clear hand
  const confirmClearHand = () =>
    confirmAnd("Are you sure you want to clear your hand?", () => clearHand());


  const moveCardByUID = (from: ZoneKey, to: ZoneKey, uid: string, index?: number) => {
    if (readOnly) return;
    setZones((z) => {
      const src = [...z[from]];
      const i = src.findIndex((c) => c.uid === uid);
      if (i === -1) return z;

      let [card] = src.splice(i, 1);
      if (isStage(from) && !isStage(to)) card = { ...card, rot: 0 };

      if (from === to) {
        const insertAt = index ?? src.length;
        const adj = insertAt > i ? insertAt - 1 : insertAt;
        src.splice(adj, 0, card);
        return { ...z, [from]: src };
      }

      const dst = [...z[to]];
      if (to === "DECK" && index == null) {
        dst.splice(0, 0, card);              // place on top
        return { ...z, [from]: src, [to]: dst };
      } else {
        dst.splice(index ?? dst.length, 0, card);
        return { ...z, [from]: src, [to]: dst };
      }
    });
  };

  // Helper: is this card a Climax?
  const isClimaxId = (id: string) => {
    const meta = lookupCardInfo(catalog, id);
    return !!(meta && isClimaxMeta(meta));
  };

  // Helper: get a card by uid from zones (source can be `zonesRef.current` inside handlers)
  const getCardByUID = (zs: Record<ZoneKey, Card[]>, z: ZoneKey, uid: string) =>
    (zs[z] || []).find(c => c.uid === uid);


  const onDragEnter = (e: React.DragEvent) => { if (readOnly) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; };
  const onDragOver = (e: React.DragEvent) => { if (readOnly) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; };
  const onDropZone = (to: ZoneKey, targetIndex?: number | null) => (e: React.DragEvent) => {
    if (readOnly) return;
    e.preventDefault();
    setHoverCard(null);

    const raw = e.dataTransfer.getData(DND_MIME) || e.dataTransfer.getData("text/plain");
    if (!raw) return;

    try {
      const { uid, from } = JSON.parse(raw) as { uid: string; from: ZoneKey };

      // --- NEW: legality guard — no Climax on Stage (Center/Back) ---
      // Use the *live* snapshot so it's accurate during DnD.
      const zs = zonesRef.current ?? zones;
      const moving = getCardByUID(zs, from, uid);
      if (moving) {
        const isIllegal = isStage(to) && isClimaxId(moving.id);
        if (isIllegal) {
          // Optional: user feedback
          // You can swap alert() with a toast UI if you have one.
          console.warn("Blocked: Climax cards cannot be placed on Center/Back Stage.");
          return; // hard-block the drop
        }
      }
      // --------------------------------------------------------------

      // Special CLOCK reorder path
      if (to === "CLOCK" && typeof targetIndex === "number") {
        moveCardByUID(from, to, uid, targetIndex);
      } else {
        moveCardByUID(from, to, uid);
      }
    } catch {
      /* ignore bad payloads */
    }
  };


  const onCardDragStart = (payload: { uid: string; from: ZoneKey }, e: React.DragEvent, visualEl: HTMLDivElement | null) => {
    const s = JSON.stringify(payload);
    e.dataTransfer.setData(DND_MIME, s);
    e.dataTransfer.setData("text/plain", s);
    e.dataTransfer.effectAllowed = "move";
    if (visualEl) e.dataTransfer.setDragImage(visualEl, 40, 56);
    const clear = () => setHoverCard(null);
    window.addEventListener("dragend", clear, { once: true });
  };

  // Global card sizing used by board + hand (80×112, 12px gap)
  const CARD_VARS: React.CSSProperties = {
    ["--card" as any]: "80px",
    ["--cardH" as any]: "112px",
    ["--gap" as any]: "12px",
  };

  // WSPlayfield.tsx (near other state)
  const [markMenu, setMarkMenu] = useState<{ open: boolean; scope: "CENTER" | "BACK" | null }>({ open: false, scope: null });

  // Helper to collect targets by scope
  const collectMarkTargets = React.useCallback(() => {
    const t: Array<{ zone: ZoneKey; card: Card }> = [];
    if (markMenu.scope === "CENTER") {
      (["CENTER_L", "CENTER_C", "CENTER_R"] as ZoneKey[]).forEach(z => {
        (zones[z] ?? []).forEach(card => t.push({ zone: z, card }));
      });
    } else if (markMenu.scope === "BACK") {
      (["BACK_L", "BACK_R"] as ZoneKey[]).forEach(z => {
        (zones[z] ?? []).forEach(card => t.push({ zone: z, card }));
      });
    }
    return t;
  }, [markMenu.scope, zones]);

  const applyMarkUpdates = (updates: Array<{ uid: string; next: number }>) => {
    if (readOnly || updates.length === 0) return;
    const map = new Map(updates.map(u => [u.uid, u.next]));
    setZones(prev => {
      const next: typeof prev = { ...prev };
      (Object.keys(prev) as ZoneKey[]).forEach(z => {
        const arr = prev[z];
        if (!Array.isArray(arr) || arr.length === 0) return;
        let changed = false;
        const copy = arr.map(c => {
          const n = map.get(c.uid);
          if (n == null) return c;
          changed = true;
          return { ...c, marks: Math.max(0, Math.min(99, n)) };
        });
        if (changed) next[z] = copy;
      });
      return next;
    });
  };

  // ---------- BoardCore: aligned panels, headerless Zones, right column stack ----------
  const BoardCore = () => {
    // one place to control the uniform panel height for the small panels
    const SMALL_PANEL_H = `calc(var(--cardH) + var(--gap) * 2 + 24px)`;
    // ⬇️ wider gaps so rotate buttons fit between cards
    const STAGE_GAP = `calc(var(--card) * 1.0)`;
    const SIDE_W = `calc(var(--card) * 1.8 + var(--gap) * 3)`;
    const SIDE_W_ROW1 = `calc(var(--card) * 1.8 + var(--gap) * 3)`; // keep your current size for CLIMAX/MEMORY row
    const SIDE_W_ROW2 = `calc(var(--card) * 1.6 + var(--gap) * 3)`; // a bit narrower for STOCK/DECK
    const DOUBLE_SMALL_PANEL_H = `calc((var(--cardH) + var(--gap) * 2 + 24px) * 2 + var(--gap) + 16px)`;
    const THREE_CARDS_W = `calc(var(--card) * 3 + var(--gap) * 2)`; // ≈ 3 cards wide

    const Panel: React.FC<React.PropsWithChildren<{
      title?: React.ReactNode;
      right?: React.ReactNode;
      minH?: string
      style?: React.CSSProperties;
    }>> =
      ({ title, right, minH = SMALL_PANEL_H, children }) => (
        <section className="rounded-2xl border border-white/10 bg-white/5 p-[var(--gap)]"
          style={{ minHeight: minH }}>
          {(title || right) && (
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs uppercase tracking-wide text-white/70">{title}</div>
              {right}
            </div>
          )}
          {children}
        </section>
      );

    return (
      <main
        className="relative w-full rounded-3xl border border-white/10 bg-gradient-to-b from-slate-800/40 to-slate-950/60"
        style={{ ...CARD_VARS, padding: "var(--gap)" }}
      >
        <div className="relative grid" style={{ gap: "var(--gap)" }}>

          {/* ===== Row 1: STOCK | CENTER STAGE (centered) | MEMORY ===== */}
          <div
            className="grid items-start"
            style={{ gridTemplateColumns: `${SIDE_W_ROW1} 1fr ${SIDE_W_ROW1}`, gap: "var(--gap)" }}
          >
            {/* STOCK (left) */}
            <Panel
              title={<>CLIMAX — {viewZones.CLIMAX.length}</>}
              right={!readOnly && (
                <button
                  className="px-2 py-1 text-xs rounded-lg bg-white/10 hover:bg-white/20 border border-white/10"
                  onClick={() => setMarkMenu({ open: true, scope: "CENTER" })}
                  title="Mark cards on Center Stage"
                >
                  Mark
                </button>
              )}
            >
              <div className="rotate-90">
                <Zone
                  headerless
                  z="CLIMAX"
                  zones={zones}
                  zonesToRender={viewZones}
                  readOnly={readOnly}
                  onDragEnter={onDragEnter}
                  onDragOver={onDragOver}
                  onDropZone={onDropZone}
                  onDraw={draw}
                  catalog={catalog}
                  onCardDragStart={onCardDragStart}
                  onSetCardRot={(z0, uid, rot) => setCardRot(z0, uid, rot, setZones)}
                  setHoverCard={setHoverCard}
                  landscape
                />
              </div>
            </Panel>

            {/* CENTER STAGE (center, width = 3 slots + spacing) */}
            <Panel
              title={<>CENTER STAGE — {viewZones.CENTER_L.length + viewZones.CENTER_C.length + viewZones.CENTER_R.length}</>}
              minH={SMALL_PANEL_H}
              right={
                // ⬅️ 2) Temporary button like “Search”
                !readOnly && (
                  <button
                    className="px-2 py-1 text-xs rounded-lg bg-white/10 hover:bg-white/20 border border-white/10"
                    onClick={() => setMarkMenu({ open: true, scope: "CENTER" })}
                    title="Mark cards on Center Stage"
                  >
                    Mark
                  </button>
                )
              }
            >
              <div
                className="flex items-start justify-center"
                style={{ gap: STAGE_GAP }}
              >
                <Zone
                  headerless
                  z="CENTER_L"
                  rows={1}
                  cols={1}
                  zones={zones}
                  zonesToRender={viewZones}
                  readOnly={readOnly}
                  onDragEnter={onDragEnter}
                  onDragOver={onDragOver}
                  onDropZone={onDropZone}
                  onDraw={draw}
                  catalog={catalog}
                  onCardDragStart={onCardDragStart}
                  onSetCardRot={(z0, uid, rot) => setCardRot(z0, uid, rot, setZones)}
                  setHoverCard={setHoverCard}
                />
                <Zone
                  headerless
                  z="CENTER_C"
                  rows={1}
                  cols={1}
                  zones={zones}
                  zonesToRender={viewZones}
                  readOnly={readOnly}
                  onDragEnter={onDragEnter}
                  onDragOver={onDragOver}
                  onDropZone={onDropZone}
                  onDraw={draw}
                  catalog={catalog}
                  onCardDragStart={onCardDragStart}
                  onSetCardRot={(z0, uid, rot) => setCardRot(z0, uid, rot, setZones)}
                  setHoverCard={setHoverCard}
                />
                <Zone
                  headerless
                  z="CENTER_R"
                  rows={1}
                  cols={1}
                  zones={zones}
                  zonesToRender={viewZones}
                  readOnly={readOnly}
                  onDragEnter={onDragEnter}
                  onDragOver={onDragOver}
                  onDropZone={onDropZone}
                  onDraw={draw}
                  catalog={catalog}
                  onCardDragStart={onCardDragStart}
                  onSetCardRot={(z0, uid, rot) => setCardRot(z0, uid, rot, setZones)}
                  setHoverCard={setHoverCard}
                />
              </div>
            </Panel>

            {/* MEMORY (right) */}
            <Panel
              title={<>MEMORY — {viewZones.MEMORY.length}</>}
              right={
                !readOnly && (
                  <button
                    className="px-2 py-1 text-xs rounded-lg bg-white/10 hover:bg-white/20 border border-white/10"
                    onClick={() => openSearch("MEMORY")}
                  >Search</button>
                )
              }
            >
              <div className="rotate-90">
                <Zone
                  headerless
                  z="MEMORY"
                  zones={zones}
                  zonesToRender={viewZones}
                  readOnly={readOnly}
                  onDragEnter={onDragEnter}
                  onDragOver={onDragOver}
                  onDropZone={onDropZone}
                  onDraw={draw}
                  catalog={catalog}
                  onCardDragStart={onCardDragStart}
                  onSetCardRot={(z0, uid, rot) => setCardRot(z0, uid, rot, setZones)}
                  setHoverCard={setHoverCard}
                  onOpenSearch={openSearch}
                  landscape
                />
              </div>
            </Panel>
          </div>



          {/* ===== Board lower area (rows 1–3 in one grid) ===== */}
          <div
            className="grid items-start"
            style={{
              gridTemplateColumns: `1fr ${THREE_CARDS_W} 1fr`,
              gap: "var(--gap)",
            }}
          >
            {/* Row 1 — STOCK (1,1) */}
            <Panel
              title={<>STOCK — {viewZones.STOCK.length}</>}
              minH={SMALL_PANEL_H}
              right={
                !readOnly && (
                  <div className="flex gap-2">
                    <button
                      className="px-2 py-1 text-xs rounded-lg bg-white/10 hover:bg-white/20 border border-white/10"
                      onClick={payTopFromStock}
                      title="Move the top Stock card to Waiting Room"
                    >
                      Pay Top
                    </button>
                    <button
                      className="px-2 py-1 text-xs rounded-lg bg-white/10 hover:bg-white/20 border border-white/10"
                      onClick={payBottomFromStock}
                      title="Move the bottom Stock card to Waiting Room"
                    >
                      Pay Bot
                    </button>
                    <button
                      className="px-2 py-1 text-xs rounded-lg bg-white/10 hover:bg-white/20 border border-white/10"
                      onClick={() => openSearch("STOCK")}
                    >
                      Search
                    </button>
                  </div>
                )
              }

            >
              <Zone
                headerless
                z="STOCK"
                zones={zones}
                zonesToRender={viewZones}
                readOnly={readOnly}
                onDragEnter={onDragEnter}
                onDragOver={onDragOver}
                onDropZone={onDropZone}
                onDraw={draw}
                catalog={catalog}
                onCardDragStart={onCardDragStart}
                onSetCardRot={(z0, uid, rot) => setCardRot(z0, uid, rot, setZones)}
                setHoverCard={setHoverCard}
              />
            </Panel>

            {/* Row 1 — BACK STAGE (2,1) */}
            <Panel
              title={<>BACK STAGE — {viewZones.BACK_L.length + viewZones.BACK_R.length}</>}
              minH={SMALL_PANEL_H}
              right={
                !readOnly && (
                  <button
                    className="px-2 py-1 text-xs rounded-lg bg-white/10 hover:bg-white/20 border border-white/10"
                    onClick={() => setMarkMenu({ open: true, scope: "BACK" })}
                    title="Mark cards on Back Stage"
                  >
                    Mark
                  </button>
                )
              }
              // place in column 2, row 1
              // (grid-* inline so Tailwind doesn’t fight it)
              style={{ minHeight: SMALL_PANEL_H, gridColumn: "2", gridRow: "1" } as React.CSSProperties}
            >
              {/* BACK STAGE content (equal margins: left == between == right) */}
              <div
                className="mx-auto flex items-center justify-between"
                style={{
                  width: "calc(var(--card) * 2 + var(--gap) * 3)", // 2 cards + left + between + right gaps
                  height: "var(--cardH)",
                  padding: "1 var(--gap)", // creates the left/right gap
                }}
              >
                <div style={{ width: "var(--card)", height: "var(--cardH)" }}>
                  <Zone
                    headerless
                    z="BACK_L"
                    rows={1}
                    cols={1}
                    {...{
                      zones, zonesToRender: viewZones, readOnly,
                      onDragEnter, onDragOver, onDropZone, onDraw: draw, catalog,
                      onCardDragStart, setHoverCard,
                      onSetCardRot: (z0: ZoneKey, uid: string, rot: 0 | 90 | 180) =>
                        setCardRot(z0, uid, rot, setZones),
                    }}
                  />
                </div>

                <div style={{ width: "var(--card)", height: "var(--cardH)" }}>
                  <Zone
                    headerless
                    z="BACK_R"
                    rows={1}
                    cols={1}
                    {...{
                      zones, zonesToRender: viewZones, readOnly,
                      onDragEnter, onDragOver, onDropZone, onDraw: draw, catalog,
                      onCardDragStart, setHoverCard,
                      onSetCardRot: (z0: ZoneKey, uid: string, rot: 0 | 90 | 180) =>
                        setCardRot(z0, uid, rot, setZones),
                    }}
                  />
                </div>
              </div>

            </Panel>

            {/* Row 1 — DECK (3,1) */}
            <Panel
              title={<>DECK — {viewZones.DECK.length}</>}
              minH={SMALL_PANEL_H}
              right={
                !readOnly && (
                  <div className="flex gap-2">
                    <button
                      className="px-2 py-1 text-xs rounded-lg bg-white/10 hover:bg-white/20 border border-white/10"
                      onClick={millTopFromDeck}
                      title="Move the top card of your Deck to your hand"
                    >
                      Mill Top
                    </button>
                    <button
                      className="px-2 py-1 text-xs rounded-lg bg-white/10 hover:bg-white/20 border border-white/10"
                      onClick={millBottomFromDeck}
                      title="Move the bottom card of your Deck to your hand"
                    >
                      Mill Bot
                    </button>
                    <button
                      className="px-2 py-1 text-xs rounded-lg bg-white/10 hover:bg-white/20 border border-white/10"
                      onClick={() => openSearch("DECK")}
                    >
                      Search
                    </button>
                  </div>
                )
              }

              style={{ minHeight: SMALL_PANEL_H, gridColumn: "3", gridRow: "1" } as React.CSSProperties}
            >
              {/* Centered DECK with equal side margins (left == between == right) */}
              <div
                className="mx-auto flex items-center justify-between"
                style={{
                  width: "calc(var(--card) * 2 + var(--gap) * 3)", // 2 cards + left + between + right gaps
                  height: "var(--cardH)",
                  padding: "1 var(--gap)", // ← your spacing magic (keeps same inner feel as Back Stage)
                }}
              >
                <div style={{ width: "calc(var(--card))", height: "var(--cardH)" }}>
                  <DeckBox
                    bare
                    zones={viewZones}
                    readOnly={readOnly}
                    catalog={catalog}
                    onDraw={draw}
                    onOpenSearch={openSearch}
                    onDragEnter={onDragEnter}
                    onDragOver={onDragOver}
                    onDropZone={onDropZone}
                    onCardDragStart={onCardDragStart}
                    onSetCardRot={(z0, uid, rot) => setCardRot(z0, uid, rot, setZones)}
                    setHoverCard={setHoverCard}
                  />
                </div>

                {/* filler div for right “gap balance” — keeps total width consistent */}
                <div style={{ width: "var(--card)", height: "var(--cardH)" }}></div>
              </div>

            </Panel>

            {/* Row 2–3 — CARD PREVIEW (1,2) spanning 2 rows */}
            <section
              className="rounded-2xl border border-white/10 bg-white/5 p-0 flex flex-col"
              style={{ gridColumn: "1", gridRow: "2 / span 2", minHeight: DOUBLE_SMALL_PANEL_H }}
            >
              {/* Row 2–3 — CARD PREVIEW (1,2) spanning 2 rows */}
              <section
                className="rounded-2xl border border-white/10 bg-white/5 p-0 flex flex-col"
                style={{ gridColumn: "1", gridRow: "2 / span 2", minHeight: DOUBLE_SMALL_PANEL_H }}
              >
                {/* The slot that HoverPreview will portal into */}
                <div
                  id="preview-slot"
                  className="relative flex-1 w-full overflow-hidden" // no inner border/rounding
                >
                  {/* Overlay title over image */}
                  <div className="absolute left-2 top-2 z-[3] pointer-events-none">
                    <div className="text-xs uppercase tracking-wide text-white/85 drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]">
                      Card Preview
                    </div>
                  </div>

                  {/* Helper message: appears only once */}
                  {!hasSeenPreview && (
                    <div className="absolute inset-0 z-[2] pointer-events-none flex items-center justify-center">
                      <div className="text-white/70 text-[12px] tracking-wide px-2 py-1 rounded-md bg-black/30 backdrop-blur-sm">
                        Hover over a card to show card details
                      </div>
                    </div>
                  )}
                </div>


              </section>

              {/* The slot that HoverPreview will portal into */}
              <div id="preview-slot" className="relative flex-1 w-full overflow-hidden rounded-xl">
                {/* Helper text: centered, sits on top of the image, disappears forever after first preview */}
                {!hasSeenPreview && (
                  <div className="absolute inset-0 z-[2] pointer-events-none flex items-center justify-center">
                    <div className="text-white/70 text-[12px] tracking-wide px-2 py-1 rounded-md bg-black/30 backdrop-blur-sm">
                      Hover over a card to show card details
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* Row 2 — LEVEL (2,2) */}
            <section
              className="rounded-2xl border border-white/10 bg-white/5 p-[var(--gap)]"
              style={{ gridColumn: "2", gridRow: "2", minHeight: SMALL_PANEL_H }}

            >
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase tracking-wide text-white/70">
                  LEVEL — {viewZones.LEVEL.length}
                </div>
                {!readOnly && (
                  <button
                    className="px-2 py-1 text-xs rounded-lg bg-white/10 hover:bg-white/20 border border-white/10"
                    onClick={() => openSearch("WAITING_ROOM")}
                  >
                    Search
                  </button>
                )}
              </div>
              {/* allow slight overlap visually by keeping the natural width; no forced centering */}
              <Zone
                headerless
                z="LEVEL"
                rows={1}
                cols={1}
                {...{
                  zones, zonesToRender: viewZones, readOnly,
                  onDragEnter, onDragOver, onDropZone, onDraw: draw, catalog,
                  onCardDragStart, setHoverCard,
                  onSetCardRot: (z0: ZoneKey, uid: string, rot: 0 | 90 | 180) => setCardRot(z0, uid, rot, setZones)
                }}
              />
            </section>

            {/* Row 2 — WAITING ROOM (3,2) */}
            <section
              className="rounded-2xl border border-white/10 bg-white/5 p-[var(--gap)]"
              style={{ gridColumn: "3", gridRow: "2", minHeight: SMALL_PANEL_H }}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase tracking-wide text-white/70">
                  WAITING ROOM — {viewZones.WAITING_ROOM.length}
                </div>
                {!readOnly && (
                  <div className="flex gap-2">
                    <button
                      className="px-2 py-1 text-xs rounded-lg bg-white/10 hover:bg-white/20 border border-white/10"
                      onClick={shuffleWaitingRoomIntoDeck}
                      title="Shuffle all Waiting Room cards back into the top of the Deck"
                    >
                      Shuffle
                    </button>
                    <button
                      className="px-2 py-1 text-xs rounded-lg bg-white/10 hover:bg-white/20 border border-white/10"
                      onClick={() => openSearch("WAITING_ROOM")}
                    >
                      Search
                    </button>
                  </div>
                )}
              </div>

              <Zone
                headerless
                z="WAITING_ROOM"
                {...{
                  zones, zonesToRender: viewZones, readOnly,
                  onDragEnter, onDragOver, onDropZone, onDraw: draw, catalog,
                  onCardDragStart, setHoverCard, onOpenSearch: openSearch,
                  onSetCardRot: (z0: ZoneKey, uid: string, rot: 0 | 90 | 180) => setCardRot(z0, uid, rot, setZones)
                }}
              />
            </section>

            {/* Row 3 — CLOCK spanning columns 2–3 */}
            <section
              className="rounded-2xl border border-white/10 bg-white/5 p-[var(--gap)]"
              style={{ gridColumn: "2 / 4", gridRow: "3", minHeight: SMALL_PANEL_H }}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase tracking-wide text-white/70">
                  CLOCK — {viewZones.CLOCK.length}
                </div>

                {/* Damage / Heal controls — same sizing as other zone buttons, no textbox */}
                <div className="flex items-center gap-2">
                  {/* Main action */}
                  {(() => {
                    const v = damageValue;
                    const isZero = v === 0;
                    const isHeal = v > 0;
                    const label = isZero ? "Heal/DMG" : isHeal ? `Heal ${v}` : `Damage ${Math.abs(v)}`;
                    const tint =
                      isZero
                        ? "bg-white/5 border-white/10 text-white/50 cursor-not-allowed"
                        : isHeal
                          ? "bg-emerald-500/10 hover:bg-emerald-500/15 border-emerald-400/30 text-emerald-200"
                          : "bg-red-500/10 hover:bg-red-500/15 border-red-400/30 text-red-200";
                    return (
                      <button
                        disabled={isZero || isResolving}
                        onClick={onApplyDamageHeal}
                        className={`px-2 py-1 text-xs rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${tint}`}
                      >
                        {label}
                      </button>
                    );
                  })()}

                  {/* Decrement (toward Damage) */}
                  <button
                    onClick={() =>
                      setDamageValue(v => {
                        const nv = v - 1;
                        damageRef.current = nv; // <- immediate ref sync
                        return nv;
                      })
                    }
                    disabled={isResolving}
                    className="px-2 py-1 text-xs rounded-lg border bg-white/5 hover:bg-white/10 border-white/10 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Decrease (toward Damage)"
                  >
                    −
                  </button>

                  <button
                    onClick={() =>
                      setDamageValue(v => {
                        const nv = v + 1;
                        damageRef.current = nv; // <- immediate ref sync
                        return nv;
                      })
                    }
                    disabled={isResolving}
                    className="px-2 py-1 text-xs rounded-lg border bg-white/5 hover:bg-white/10 border-white/10 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Increase (toward Heal)"
                  >
                    +
                  </button>

                </div>
              </div>

              {/* full width across both middle + right columns */}
              <div>
                <Zone
                  headerless
                  z="CLOCK"
                  rows={1}
                  cols={6}
                  {...{
                    zones, zonesToRender: viewZones, readOnly,
                    onDragEnter, onDragOver, onDropZone, onDraw: draw, catalog,
                    onCardDragStart, setHoverCard,
                    onSetCardRot: (z0: ZoneKey, uid: string, rot: 0 | 90 | 180) => setCardRot(z0, uid, rot, setZones)
                  }}
                />
              </div>
            </section>
          </div>
        </div>
      </main>
    );
  };


  // ---------- rotation wrapper ----------
  const rotationClass =
    layout === "horizontal"
      ? (externalZones ? "-rotate-90" : "rotate-90")
      : (externalZones ? "rotate-180" : "");

  const rot = externalZones ? -90 : 90;

  const board =
    layout === "horizontal" ? (
      <div
        className="relative inline-block"
        style={{ width: natural.h || 0, height: natural.w || 0 }}
      >
        <div className="absolute top-0 left-0 will-change-transform origin-top-left"
          style={{
            transform: rot === 90
              ? "rotate(90deg) translateY(-100%)"
              : "rotate(-90deg) translateX(-100%)",
          }}
        >
          <div ref={contentRef}>
            {BoardCore()}
          </div>
        </div>
      </div>
    ) : (
      <div className="relative block w-full">
        <div className={`transform-gpu ${externalZones ? "rotate-180" : ""} origin-center`}>
          <div ref={contentRef} className="w-full">
            {BoardCore()}
          </div>
        </div>
      </div>
    );

  // width measuring for horizontal portals
  const [clusterWidth, setClusterWidth] = React.useState<number | null>(null);



  React.useLayoutEffect(() => {
    if (layout !== "horizontal") return;
    const el = document.getElementById("cluster-wrapper");
    if (!el) return;
    const update = () => setClusterWidth(el.getBoundingClientRect().width);
    const raf = requestAnimationFrame(update);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener("resize", update); };
  }, [layout]);
  React.useEffect(() => { if (layout !== "horizontal") setClusterWidth(null); }, [layout]);

  React.useEffect(() => {
    function onImported(e: any) {
      const { entries } = e.detail as { name: string; entries: { id: string; count: number }[]; raw: string };

      // Build cards, cap at DECK_MAX (consistent with your importDeck)
      let deck: Card[] = [];
      for (const ent of entries) {
        for (let i = 0; i < ent.count; i++) deck.push({ uid: `${Date.now()}_${Math.random().toString(36).slice(2)}`, id: ent.id });
      }
      if (deck.length > DECK_MAX) deck = deck.slice(0, DECK_MAX);

      // Make sure sets are loaded so images resolve
      const setKeys = Array.from(new Set(deck.map(c => setKeyFromId(c.id)).filter(Boolean))) as string[];
      (async () => {
        if (setKeys.length) await loadSets(setKeys);
        setZones(z => ({
          ...z,
          DECK: shuffle(deck),
          HAND: [],
          WAITING_ROOM: [],
          STOCK: [],
          CLOCK: [],
          LEVEL: [],
          MEMORY: [],
          CENTER_L: [],
          CENTER_C: [],
          CENTER_R: [],
          BACK_L: [],
          BACK_R: [],
          CLIMAX: [],
          DECK_TEMP: [],
        }));
      })();
    }
    window.addEventListener("ws-import-deck", onImported as any);
    return () => window.removeEventListener("ws-import-deck", onImported as any);
  }, []); // eslint-disable-line

  // keep a live snapshot of zones for read-only access
  const zonesRef = React.useRef(zones);
  React.useEffect(() => { zonesRef.current = zones; }, [zones]);

  // keep a live snapshot of damageValue to avoid stale reads after ± clicks
  const damageRef = React.useRef(damageValue);
  React.useEffect(() => { damageRef.current = damageValue; }, [damageValue]);

  React.useEffect(() => {
    // slight defer to ensure it's in the DOM even on first mount
    const id = "preview-slot";
    const tick = requestAnimationFrame(() => {
      setPanelRoot(document.getElementById(id));
    });
    return () => cancelAnimationFrame(tick);
    // rerun when layout changes or after board reflows
  }, [layout]);

  // portals
  const handHost = typeof window !== "undefined" ? document.getElementById("hand-slot") : null;

  const extrasWidth =
    layout === "horizontal"
      ? (clusterWidth ?? null)
      : null;

  const centerExtras = layout === "vertical" ? "mx-auto" : "";

  // Use the same size as board slots
  const HAND_CARD_VARS: React.CSSProperties = {
    ["--card" as any]: "80px",
    ["--cardH" as any]: "112px",
  };

  const HandSection = !readOnly && (
    <section
      className={`mt-3 box-border rounded-2xl bg-white/5 border border-white/10 ${centerExtras}`}
      style={{ ...CARD_VARS, width: extrasWidth ?? undefined, padding: "var(--gap)" }}
    >
      <h2 className="font-semibold mb-2">Hand — {zones.HAND.length}</h2>
      <div
        onDragEnter={!readOnly ? onDragEnter : undefined}
        onDragOver={!readOnly ? onDragOver : undefined}
        onDrop={!readOnly ? onDropZone("HAND") : undefined}
        className="flex flex-wrap border border-white/10 bg-black/20 rounded-xl overflow-x-hidden"
        style={{
          gap: "var(--gap)",
          minHeight: "calc(var(--cardH) + var(--gap))",
          padding: "var(--gap)",
        }}
      >
        {zones.HAND.length === 0 && (
          <div
            className="rounded-xl border-2 border-dashed border-white/20 bg-black/10"
            style={{ width: "var(--card)", height: "var(--cardH)" }}
          />
        )}
        {zones.HAND.map((c, i) => (
          <div key={c.uid} style={{ width: "var(--card)", height: "var(--cardH)" }}>
            <CardView
              card={c}
              zone="HAND"
              idx={i}
              readOnly={readOnly}
              catalog={catalog}
              onDragStart={onCardDragStart}
              onSetRot={(rot: 0 | 90 | 180) => setCardRot("HAND", c.uid, rot, setZones)}
              setHoverCard={setHoverCard}
            />
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between">
        {/* Left group: Draw (muted) */}
        <div className="flex gap-2">
          <button onClick={() => draw(1)} className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10">
            Draw 1
          </button>
          <button onClick={() => draw(5)} className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10">
            Draw 5
          </button>
        </div>

        {/* Right group: Clear Hand & Clear/Shuffle (muted buttons, confirm dialog is colorful) */}
        <div className="flex gap-2">
          <button
            onClick={() =>
              ask({
                title: "Clear Hand",
                message: "Move all cards from your hand to the bottom of your deck?",
                confirmText: "Sure",
                onConfirm: () => {
                  setConfirm(c => ({ ...c, open: false }));
                  clearHandToBottom();
                },
              })
            }
            className="px-3 py-1.5 rounded-xl border border-rose-400/30 bg-rose-500/10 hover:bg-rose-500/20 text-white/90 transition-colors"
            title="Move all cards from hand to bottom of deck"
          >
            Clear Hand
          </button>

          <button
            onClick={() =>
              ask({
                title: "Clear / Shuffle",
                message:
                  "Move all cards from your hand to the bottom of your deck and then shuffle the deck?",
                confirmText: "Sure",
                onConfirm: () => {
                  setConfirm(c => ({ ...c, open: false }));
                  clearHandToBottomAndShuffle();
                },
              })
            }
            className="px-3 py-1.5 rounded-xl border border-amber-400/30 bg-amber-400/10 hover:bg-amber-400/20 text-white/90 transition-colors"
            title="Clear hand to bottom, then shuffle deck"
          >
            Clear/Shuffle
          </button>
        </div>
      </div>


      <CardMetaPane
        card={hoverCard ?? pinnedCard}
        catalog={catalog}
      />


    </section>
  );


  const outerClass =
    layout === "horizontal"
      ? "flex-none w-full px-0 py-4"
      : "w-full px-4 py-4";

  const closeSearch = () => setSearchZone(null);

  return (
    <div className="relative block w-full" style={CARD_VARS}>
      <div className={outerClass}>
        {board}
        {!readOnly && (
          layout === "horizontal" && handHost
            ? createPortal(HandSection, handHost)
            : HandSection
        )}

        <footer className="text-xs text-white/50 pt-2">Weiss Schwarz Virtual Tabletop, made by Feliciacos</footer>
      </div>
      <HoverPreview
        hoverCard={hoverCard}
        catalog={catalog}
        pageZoom={pageZoom}
        portalRoot={panelRoot}
        mode="panel"
      />

      <ConfirmBox
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        confirmText={confirm.confirmText}
        onConfirm={confirm.onConfirm}
        onCancel={() => setConfirm(c => ({ ...c, open: false }))}
      />

      <SearchModal
        open={searchOpen}
        zone={searchZone}
        readOnly={readOnly}
        cards={searchZone ? (viewZones[searchZone] ?? []) : []}
        catalog={catalog}
        onClose={closeSearch}
        onMoveSelected={({ from, to, uids }) => {
          if (readOnly) return;

          // --- NEW: pre-validate the selection ---
          const zs = zonesRef.current ?? zones;
          const anyIllegal =
            isStage(to) &&
            uids
              .map(uid => getCardByUID(zs, from, uid))
              .filter((c): c is Card => !!c)
              .some(c => isClimaxId(c.id));

          if (anyIllegal) {
            console.warn("Blocked: Climax cards cannot be placed on Center/Back Stage.");
            // Optional: show a nicer UI message instead of console.warn
            return;
          }
          // --------------------------------------

          setZones(z => {
            const src = [...z[from]];
            const dst = [...z[to]];
            const moving: Card[] = [];

            for (const uid of uids) {
              const i = src.findIndex(c => c.uid === uid);
              if (i !== -1) { const [c] = src.splice(i, 1); moving.push(c); }
            }
            if (!moving.length) return z;

            if (to === "DECK") {
              // Put on TOP (keep your current behavior)
              return { ...z, [from]: src, [to]: [...moving, ...dst] };
            }
            return { ...z, [from]: src, [to]: [...dst, ...moving] };
          });
          closeSearch();
        }}
      />
      {/* Marking menu */}
      <MarkMenu
        open={markMenu.open}
        title={markMenu.scope === "CENTER" ? "Mark – Center Stage" : markMenu.scope === "BACK" ? "Mark – Back Stage" : "Mark"}
        targets={collectMarkTargets()}
        onClose={() => setMarkMenu({ open: false, scope: null })}
        onChangeMarks={applyMarkUpdates}
      />
    </div>
  );
}

export default WSPlayfield;
