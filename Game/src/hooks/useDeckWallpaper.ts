import { useCallback, useEffect, useState } from "react";

export type Orientation = "vertical" | "horizontal";

/** Per-orientation saved data */
type PerOrientCustom = {
  urls: string[];
  selected: string | null; // selected custom url (overrides deck images)
  enabled: boolean;        // toggle to use custom in this orientation
};
type PerOrientIndex = {
  vertical: number | null;
  horizontal: number | null;
};

type Persist = {
  enabled: boolean;
  opacity: number;                       // 0..100
  fit: "cover" | "contain" | "auto";
  position: "center" | "top" | "bottom" | "left" | "right";
  autoSelect: boolean;                   // random from set on load
  lastSet: string | null;                // e.g. "DAL", "SFN"

  // Orientation-scoped selections
  selectedIdxBy: PerOrientIndex;         // chosen deck thumbnail per orientation
  customBy: {
    vertical: PerOrientCustom;
    horizontal: PerOrientCustom;
  };

  // --- legacy (migration fields) ---
  // selectedIdx?: number | null;
  // customUrls?: string[];
  // selectedCustom?: string | null;
};

const KEY = "ws_wallpaper_v1";

function loadPersist(): Persist {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) throw 0;
    const p = JSON.parse(raw);

    // --- migrations from older schema ---
    const legacySelectedIdx = (p.selectedIdx ?? null) as number | null;
    const legacyCustomUrls = Array.isArray(p.customUrls) ? (p.customUrls as string[]) : [];
    const legacySelectedCustom = typeof p.selectedCustom === "string" ? (p.selectedCustom as string) : null;

    const selectedIdxBy: PerOrientIndex = p.selectedIdxBy ?? {
      vertical: legacySelectedIdx,
      horizontal: legacySelectedIdx,
    };

    const customBy = p.customBy ?? {
      vertical: { urls: legacyCustomUrls, selected: legacySelectedCustom, enabled: !!legacySelectedCustom },
      horizontal: { urls: [], selected: null, enabled: false },
    };

    return {
      enabled: !!p.enabled,
      opacity: Math.min(100, Math.max(0, Number(p.opacity ?? 80))), // default 80%
      fit: (p.fit ?? "cover") as Persist["fit"],
      position: (p.position ?? "center") as Persist["position"],
      autoSelect: !!p.autoSelect,
      lastSet: p.lastSet ?? null,
      selectedIdxBy,
      customBy,
    };
  } catch {
    return {
      enabled: true,
      opacity: 80,
      fit: "cover",
      position: "center",
      autoSelect: false,
      lastSet: null,
      selectedIdxBy: { vertical: null, horizontal: null },
      customBy: {
        vertical: { urls: [], selected: null, enabled: false },
        horizontal: { urls: [], selected: null, enabled: false },
      },
    };
  }
}

function savePersist(p: Persist) {
  localStorage.setItem(KEY, JSON.stringify(p));
}

/**
 * Probe /Images/Wallpapers/<SET>/<Orient>/<n>.jpg and keep only those that actually load.
 * Using Image() avoids CORS/opaque responses and SPA 200-fallback issues.
 */
async function scanWallpapers(set: string, orient: Orientation, max = 50): Promise<string[]> {
  const base = `/Images/Wallpapers/${set}/${orient === "vertical" ? "Vertical" : "Horizontal"}`;
  const urls = Array.from({ length: max }, (_, i) => `${base}/${i + 1}.jpg`);

  const checks = urls.map(
    (u) =>
      new Promise<string | null>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(u);
        img.onerror = () => resolve(null);
        img.decoding = "async";
        img.loading = "eager";
        img.src = u;
      })
  );

  const res = await Promise.all(checks);
  return res.filter((u): u is string => !!u);
}

export function useDeckWallpaper(layout: Orientation) {
  const [persist, setPersist] = useState<Persist>(() => loadPersist());
  const [images, setImages] = useState<string[]>([]);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const o = layout; // shorthand for current orientation key

  // public setters
  const setEnabled = useCallback((v: boolean) => {
    setPersist((p) => {
      const next = { ...p, enabled: v };
      // If wallpaper disabled, also stop custom for both orientations (UI requirement)
      if (!v) {
        next.customBy = {
          vertical: { ...next.customBy.vertical, enabled: false, selected: null },
          horizontal: { ...next.customBy.horizontal, enabled: false, selected: null },
        };
      }
      savePersist(next);
      return next;
    });
  }, []);

  const setOpacity = useCallback((v: number) => {
    const clamped = Math.min(100, Math.max(0, v));
    setPersist((p) => {
      const next = { ...p, opacity: clamped };
      savePersist(next);
      return next;
    });
  }, []);

  const setFit = useCallback((v: Persist["fit"]) => {
    setPersist((p) => {
      const next = { ...p, fit: v };
      savePersist(next);
      return next;
    });
  }, []);

  const setPosition = useCallback((v: Persist["position"]) => {
    setPersist((p) => {
      const next = { ...p, position: v };
      savePersist(next);
      return next;
    });
  }, []);

  /** If turning ON autoSelect, force custom OFF for current orientation (and clear its selection). */
  const setAutoSelect = useCallback((v: boolean) => {
    setPersist((p) => {
      const next: Persist = {
        ...p,
        autoSelect: v,
        customBy: v
          ? {
              ...p.customBy,
              [o]: { ...p.customBy[o], enabled: false, selected: null }, // turn off & clear for this orientation
            }
          : p.customBy,
      };
      savePersist(next);
      return next;
    });
  }, [o]);

  /** Select a deck-provided thumbnail (per orientation). Clears any custom selection for this orientation. */
  const pickIndex = useCallback((i: number | null) => {
    setPersist((p) => {
      const next: Persist = {
        ...p,
        selectedIdxBy: { ...p.selectedIdxBy, [o]: i },
        customBy: {
          ...p.customBy,
          [o]: { ...p.customBy[o], selected: null, enabled: false },
        },
      };
      savePersist(next);
      return next;
    });
  }, [o]);

  /** Add/select a custom URL (per orientation). Clears deck selection for this orientation and enables custom. */
  const setCustomUrl = useCallback((url: string | null) => {
    setPersist((p) => {
      if (!url) {
        const next: Persist = {
          ...p,
          selectedIdxBy: { ...p.selectedIdxBy, [o]: null },
          customBy: { ...p.customBy, [o]: { ...p.customBy[o], selected: null, enabled: false } },
        };
        savePersist(next);
        return next;
      }
      const v = url.trim();
      const withoutDup = p.customBy[o].urls.filter((u) => u !== v);
      const next: Persist = {
        ...p,
        autoSelect: false, // adding a custom implicitly disables auto-select
        selectedIdxBy: { ...p.selectedIdxBy, [o]: null }, // clear deck selection
        customBy: {
          ...p.customBy,
          [o]: {
            urls: [v, ...withoutDup].slice(0, 50),
            selected: v,
            enabled: true,
          },
        },
      };
      savePersist(next);
      return next;
    });
    setBgUrl(url);
  }, [o]);

  /** Toggle using custom (per orientation). When disabling, clear selected custom for that orientation. */
  const setCustomEnabled = useCallback((use: boolean) => {
    setPersist((p) => {
      const next: Persist = {
        ...p,
        autoSelect: use ? false : p.autoSelect, // turning custom on should ensure auto-select is off
        customBy: {
          ...p.customBy,
          [o]: {
            ...p.customBy[o],
            enabled: use,
            selected: use ? p.customBy[o].selected : null, // clear selection when turning off
          },
        },
      };
      savePersist(next);
      return next;
    });
  }, [o]);

  /** Pick wallpapers for current orientation + set; respects custom selection & enabled. */
  const pickFor = useCallback(async (setCode: string | null) => {
    if (!setCode) {
      setImages([]);
      const cust = persist.customBy[o];
      setBgUrl(cust.enabled ? (cust.selected || null) : null);
      setPersist((p) => {
        const next = { ...p, lastSet: null, selectedIdxBy: { ...p.selectedIdxBy, [o]: null } };
        savePersist(next);
        return next;
      });
      return;
    }

    const list = await scanWallpapers(setCode, o);
    setImages(list);

    setPersist((p) => {
      // if custom is enabled for this orientation and a url is selected, always use it
      const cust = p.customBy[o];
      if (cust.enabled && cust.selected) {
        setBgUrl(cust.selected);
        const next = { ...p, lastSet: setCode };
        savePersist(next);
        return next;
      }

      let selectedIdx = p.selectedIdxBy[o];
      let nextUrl: string | null = null;

      if (list.length) {
        if (p.autoSelect || selectedIdx == null || selectedIdx >= list.length) {
          selectedIdx = Math.floor(Math.random() * list.length);
        }
        nextUrl = list[selectedIdx] ?? null;
      }
      setBgUrl(nextUrl);

      const next = {
        ...p,
        lastSet: setCode,
        selectedIdxBy: { ...p.selectedIdxBy, [o]: selectedIdx ?? null },
      };
      savePersist(next);
      return next;
    });
  }, [o, persist.customBy]);

  // Keep bgUrl in sync when selections change or when thumbnails list changes.
  useEffect(() => {
    const cust = persist.customBy[o];
    if (cust.enabled && cust.selected) {
      setBgUrl(cust.selected);
      return;
    }
    if (!images.length) {
      setBgUrl(null);
      return;
    }
    const idx = persist.selectedIdxBy[o];
    if (idx == null || idx >= images.length) {
      if (!persist.autoSelect) {
        setBgUrl(null);
        return;
      }
      // If autoSelect and index missing, pick a random one for this orientation
      const rnd = Math.floor(Math.random() * images.length);
      setBgUrl(images[rnd]);
      setPersist((p) => {
        const next = { ...p, selectedIdxBy: { ...p.selectedIdxBy, [o]: rnd } };
        savePersist(next);
        return next;
      });
      return;
    }
    setBgUrl(images[idx]);
  }, [images, persist.autoSelect, persist.selectedIdxBy, persist.customBy, o]);

  // When orientation changes, rescan deck wallpapers for current set (so Settings thumbnails update).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!persist.lastSet) {
        setImages([]);
        const cust = persist.customBy[o];
        setBgUrl(cust.enabled ? (cust.selected ?? null) : null);
        return;
      }
      const list = await scanWallpapers(persist.lastSet, o);
      if (!cancelled) setImages(list);
    })();
    return () => { cancelled = true; };
  }, [o, persist.lastSet]);

  // Public view for current orientation
  const customUrls = persist.customBy[o].urls;
  const selectedCustom = persist.customBy[o].selected;
  const customEnabled = persist.customBy[o].enabled;

  return {
    // data
    bgUrl,
    images,
    enabled: persist.enabled,
    opacity: persist.opacity,
    fit: persist.fit,
    position: persist.position,
    autoSelect: persist.autoSelect,
    selectedIdx: persist.selectedIdxBy[o],
    customUrls,
    selectedCustom,
    customEnabled,

    // actions
    setEnabled,
    setOpacity,
    setFit,
    setPosition,
    setAutoSelect,
    pickIndex,
    pickFor,
    setCustomUrl,
    setCustomEnabled,
  };
}
