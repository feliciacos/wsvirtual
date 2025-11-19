import React from "react";
import { useDeckWallpaper } from "../../hooks/useDeckWallpaper";

export default function WallpaperPicker({
  layout,          // "vertical" | "horizontal"
  setKey,          // dominant set key, e.g. "DAL"
}: {
  layout: "vertical" | "horizontal";
  setKey: string | null;
}) {
  const {
    bgUrl,
    images,
    pickIndex,
    setCustomUrl,
    customUrls,
    selectedCustom,
    enabled,
    setEnabled,
  } = useDeckWallpaper(layout);

  if (!setKey) {
    return <div className="text-white/60 text-sm">No dominant set found for this deck.</div>;
  }

  const orient = layout === "vertical" ? "Vertical" : "Horizontal";

  return (
    <div className="space-y-2">
      <div className="text-sm text-white/70">Deck theme: <b>{setKey}</b> — {orient}</div>

      {images.length ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
          {images.map((u, i) => (
            <button
              key={u}
              onClick={() => pickIndex(i)}
              className={[
                "relative aspect-[16/10] rounded-xl overflow-hidden border",
                selectedCustom ? "border-white/10 hover:border-white/30" : (bgUrl === u ? "border-emerald-300" : "border-white/10 hover:border-white/30"),
              ].join(" ")}
              title="Select wallpaper"
            >
              <img loading="lazy" src={u} alt="" className="absolute inset-0 w-full h-full object-cover" />
            </button>
          ))}
        </div>
      ) : (
        <div className="text-white/60 text-sm">No wallpapers found for {setKey}/{orient}.</div>
      )}

      {/* Custom URL input */}
      <div className="pt-2">
        <CustomUrl
          onChoose={(url) => {
            pickIndex(null);
            setCustomUrl(url.trim());
            if (!enabled) setEnabled(true);
          }}
        />
      </div>

      {/* Custom thumbnails */}
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
        {customUrls.map((src) => (
          <button
            key={src}
            onClick={() => {
              setCustomUrl(src);
              if (!enabled) setEnabled(true);
            }}
            className={[
              "relative aspect-[16/10] rounded-xl overflow-hidden border",
              selectedCustom === src ? "border-emerald-300" : "border-white/10 hover:border-white/30",
            ].join(" ")}
            title={src}
          >
            <img loading="lazy" src={src} alt="" className="absolute inset-0 w-full h-full object-cover" />
          </button>
        ))}
      </div>
      {customUrls.length === 0 && (
        <div className="text-xs text-white/60">Paste a URL above to add it here.</div>
      )}
    </div>
  );
}

function CustomUrl({ onChoose }: { onChoose: (url: string) => void }) {
  const [url, setUrl] = React.useState("");
  return (
    <div className="flex gap-2 items-center">
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        className="flex-1 px-2 py-1 rounded-lg bg-black/40 border border-white/10 outline-none text-sm"
        placeholder="https://… or /Images/Wallpapers/SET/Vertical/1.jpg"
      />
      <button
        className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 text-sm"
        onClick={() => {
          const v = url.trim();
          if (v) onChoose(v);
        }}
      >
        Use URL
      </button>
    </div>
  );
}
