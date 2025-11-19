import React from "react";
import type { Orientation } from "../../hooks/useDeckWallpaper";

type Props = {
  open: boolean;
  onClose: () => void;

  // board tab
  layout: Orientation;
  setLayout: (l: Orientation) => void;
  openImport: () => void;

  // wallpaper tab (state supplied by the hook)
  wp: {
    enabled: boolean;
    setEnabled: (v: boolean) => void;

    fit: "cover" | "contain" | "auto";
    setFit: (v: "cover" | "contain" | "auto") => void;

    position: "center" | "top" | "bottom" | "left" | "right";
    setPosition: (v: "center" | "top" | "bottom" | "left" | "right") => void;

    opacity: number; // 0..100
    setOpacity: (v: number) => void;

    autoSelect: boolean;
    setAutoSelect: (v: boolean) => void;

    images: string[];
    selectedIdx: number | null;
    pickIndex: (i: number | null) => void;

    // custom controls
    customUrls: string[];
    selectedCustom: string | null;
    setCustomUrl: (url: string) => void;
    customEnabled: boolean;
    setCustomEnabled: (use: boolean) => void;
  };
};

export default function SettingsMenu({
  open,
  onClose,
  layout,
  setLayout,
  openImport,
  wp,
}: Props) {
  const [tab, setTab] = React.useState<"board" | "wallpaper" | "theming">("board");

  React.useEffect(() => {
    if (open) setTab((t) => t); // keep last tab
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        className="w-[min(52rem,95vw)] max-h-[90vh] overflow-hidden rounded-2xl border border-white/10 bg-slate-900 text-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="text-base font-semibold">Settings</div>
          <button onClick={onClose} className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 border border-white/10">Close</button>
        </div>

        <div className="grid grid-cols-[12rem_1fr]">
          {/* Sidebar */}
          <nav className="border-r border-white/10 p-2 space-y-1 bg-black/20">
            <Tab label="Board" active={tab === "board"} onClick={() => setTab("board")} />
            <Tab label="Wallpaper" active={tab === "wallpaper"} onClick={() => setTab("wallpaper")} />
            <Tab label="Theming" active={tab === "theming"} onClick={() => setTab("theming")} />
          </nav>

          {/* Panels */}
          <section className="p-4 overflow-y-auto" style={{ maxHeight: "calc(90vh - 52px)" }}>
            {tab === "board" && (
              <div className="space-y-4">
                <Section title="Board actions">
                  <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 mb-2">
                    <div className="text-amber-300 text-sm font-medium">Warning</div>
                    <p className="text-amber-200/90 text-sm mt-1">
                      Changing these settings will wipe your board.
                    </p>
                  </div>

                  <div className="grid gap-3">
                    <div>
                      <div className="text-sm mb-1 font-medium">Import Deck</div>
                      <button
                        onClick={openImport}
                        className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10"
                      >
                        Open Import
                      </button>
                      <div className="text-xs text-white/60 mt-1">Use this to change the current deck.</div>
                    </div>

                    <div>
                      <div className="text-sm mb-1 font-medium">Change View</div>
                      <div className="flex items-center gap-3">
                        <Toggle
                          checked={layout === "horizontal"}
                          onChange={(v) => setLayout(v ? "horizontal" : "vertical")}
                          leftLabel="Vertical"
                          rightLabel="Horizontal"
                        />
                      </div>
                      <div className="text-xs text-white/60 mt-1">
                        Toggle the game layout (current: {layout}).
                      </div>
                    </div>
                  </div>
                </Section>
              </div>
            )}

            {tab === "wallpaper" && (
              <div className="space-y-4">
                <Section title="Wallpaper controls">
                  <div className="flex items-center justify-between gap-4">
                    <Toggle
                      checked={wp.enabled}
                      onChange={wp.setEnabled}
                      leftLabel="Disabled"
                      rightLabel="Enable wallpaper"
                    />
                  </div>

                  <div className={`grid grid-cols-1 md:grid-cols-3 gap-3 mt-3 ${!wp.enabled ? "opacity-50 pointer-events-none" : ""}`}>
                    <label className="text-sm">
                      <div className="mb-1 text-white/80">Fit</div>
                      <select
                        className="w-full rounded-lg bg-black/40 border border-white/10 px-2 py-1 outline-none"
                        value={wp.fit}
                        onChange={(e) => wp.setFit(e.target.value as any)}
                      >
                        <option value="cover">cover (default)</option>
                        <option value="contain">contain</option>
                        <option value="auto">auto</option>
                      </select>
                    </label>
                    <label className="text-sm">
                      <div className="mb-1 text-white/80">Position</div>
                      <select
                        className="w-full rounded-lg bg-black/40 border border-white/10 px-2 py-1 outline-none"
                        value={wp.position}
                        onChange={(e) => wp.setPosition(e.target.value as any)}
                      >
                        <option value="center">center</option>
                        <option value="top">top</option>
                        <option value="bottom">bottom</option>
                        <option value="left">left</option>
                        <option value="right">right</option>
                      </select>
                    </label>
                    <label className="text-sm">
                      <div className="mb-1 text-white/80">Overlay / opacity</div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={wp.opacity}
                        onChange={(e) => wp.setOpacity(parseInt(e.target.value || "0", 10))}
                        className="w-full"
                      />
                      <div className="text-xs text-white/60 mt-1">{wp.opacity}%</div>
                    </label>
                  </div>
                </Section>

                {/* Deck-themed */}
                <Section title="Deck-themed wallpaper">
                  <div className={`${!wp.enabled ? "opacity-50 pointer-events-none" : ""} space-y-3`}>
                    <Toggle
                      checked={wp.autoSelect}
                      onChange={wp.setAutoSelect}
                      leftLabel="Manual"
                      rightLabel="Auto select"
                    />
                    {!wp.autoSelect && (
                      <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
                        {wp.images.map((src, i) => (
                          <button
                            key={src}
                            onClick={() => wp.pickIndex(i)}
                            className={[
                              "relative aspect-[5/3] rounded-lg overflow-hidden border",
                              wp.selectedCustom ? "border-white/15 hover:border-white/30"
                                : (wp.selectedIdx === i ? "border-cyan-400" : "border-white/15 hover:border-white/30"),
                            ].join(" ")}
                            title={src}
                          >
                            <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" />
                          </button>
                        ))}
                        {wp.images.length === 0 && (
                          <div className="text-sm text-white/60">No wallpapers found for the current deck/set.</div>
                        )}
                      </div>
                    )}
                  </div>
                </Section>

                {/* Custom wallpaper */}
                <Section title="Custom wallpaper">
                  {/* Show the switch always; disable it if main off OR auto-select on. */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Toggle
                        checked={wp.customEnabled}
                        onChange={(use) => {
                          if (!wp.enabled || wp.autoSelect) return; // disabled
                          wp.setCustomEnabled(use);
                        }}
                        leftLabel="Off"
                        rightLabel="Use custom"
                        disabled={!wp.enabled || wp.autoSelect}
                      />
                    </div>

                    {/* Only show the input + thumbnails when:
                        - wallpaper enabled
                        - NOT auto-select
                        - custom switch is ON */}
                    {wp.enabled && !wp.autoSelect && wp.customEnabled && (
                      <>
                        <div className="flex gap-2">
                          <CustomUrlInput
                            onUse={(url) => {
                              wp.setCustomUrl(url.trim());
                              if (!wp.enabled) wp.setEnabled(true);
                            }}
                          />
                        </div>

                        <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
                          {wp.customUrls.map((src) => (
                            <button
                              key={src}
                              onClick={() => {
                                wp.setCustomUrl(src);
                                if (!wp.enabled) wp.setEnabled(true);
                              }}
                              className={[
                                "relative aspect-[5/3] rounded-lg overflow-hidden border",
                                wp.selectedCustom === src ? "border-cyan-400" : "border-white/15 hover:border-white/30",
                              ].join(" ")}
                              title={src}
                            >
                              <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" />
                            </button>
                          ))}
                          {wp.customUrls.length === 0 && (
                            <div className="text-sm text-white/60">Paste a URL to add it here.</div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </Section>
              </div>
            )}

            {tab === "theming" && (
              <div className="space-y-4">
                <Section title="Theming">
                  <p className="text-sm text-white/80">Theme options (coming soon).</p>
                </Section>
              </div>
            )}
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-white/10 bg-black/30">
          <button onClick={onClose} className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10">Close</button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: React.PropsWithChildren<{ title: React.ReactNode }>) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-white/90 mb-2">{title}</h3>
      {children}
    </section>
  );
}

function Tab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={[
        "w-full text-left px-3 py-2 rounded-xl border",
        active ? "bg-white/10 border-white/20" : "bg-transparent border-transparent hover:bg-white/5",
      ].join(" ")}
    >
      <div className="text-sm text-white/90">{label}</div>
    </button>
  );
}

function Toggle({
  checked,
  onChange,
  leftLabel,
  rightLabel,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  leftLabel?: string;
  rightLabel?: string;
  disabled?: boolean;
}) {
  const handleClick = () => {
    if (disabled) return;
    onChange(!checked);
  };
  return (
    <div className={`flex items-center gap-2 ${disabled ? "opacity-50" : ""}`}>
      {leftLabel && <span className="text-xs text-white/70">{leftLabel}</span>}
      <button
        onClick={handleClick}
        className={[
          "relative inline-flex h-6 w-11 items-center rounded-full",
          disabled ? "bg-white/10 cursor-not-allowed" : (checked ? "bg-emerald-500/80" : "bg-white/20"),
        ].join(" ")}
      >
        <span
          className={[
            "inline-block h-5 w-5 transform rounded-full bg-white transition",
            checked ? "translate-x-6" : "translate-x-1",
          ].join(" ")}
        />
      </button>
      {rightLabel && <span className="text-xs text-white/70">{rightLabel}</span>}
    </div>
  );
}

function CustomUrlInput({ onUse }: { onUse: (url: string) => void }) {
  const [url, setUrl] = React.useState("");
  return (
    <>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://… or /Images/Wallpapers/SET/Vertical/1.jpg"
        className="flex-1 rounded-lg bg-black/40 border border-white/10 px-2 py-1 outline-none"
      />
      <button
        onClick={() => onUse(url)}
        className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10"
      >
        Use URL
      </button>
    </>
  );
}
