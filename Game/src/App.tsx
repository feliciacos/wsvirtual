import React, { useEffect, useState } from "react";
import { useRoom, ZonesPayload, WS_URL } from "./net/useRoom";
import WSPlayfield from "./components/WSPlayfield";
import ImportDeckModal from "./components/ui/ImportDeckModal";
import SettingsMenu from "./components/ui/SettingsMenu";
import { useDeckWallpaper } from "./hooks/useDeckWallpaper";
import { dominantSetFromEntries } from "./utils/deckSets";

/* =========================
   Cookie helpers
========================= */
function setCookie(name: string, value: string, days = 365) {
  const d = new Date();
  d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${d.toUTCString()}; path=/; SameSite=Lax`;
}
function getCookie(name: string) {
  const m = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/[-./^$*+?()[\\]{}|\\\\]/g, "\\$&")}=([^;]*)`)
  );
  return m ? decodeURIComponent(m[1]) : "";
}

const LAYOUT_KEY = "ws_layout_mode"; // 'vertical' | 'horizontal'

/* =========================
   Opponent zones normalizer
========================= */
type AnyZones = Record<string, any>;
function normalizeOpponentZones(z: AnyZones | null): AnyZones | null {
  if (!z) return null;
  return {
    DECK_TEMP: Array.isArray(z.DECK_TEMP) ? z.DECK_TEMP : [],
    ...z,
  };
}

/* =========================
   Create / Join Menu
========================= */
function JoinMenu(props: { onEnter: (roomId: string, playerName: string) => void }) {
  const [mode, setMode] = useState<"create" | "join">("create");
  const [roomInput, setRoomInput] = useState("");
  const [playerName, setPlayerName] = useState(getCookie("ws_name") || "");

  const handleCreate = () => {
    const name = (playerName.trim() || "Player").slice(0, 24);
    setCookie("ws_name", name);

    const ws = new WebSocket(WS_URL);
    ws.onopen = () => ws.send(JSON.stringify({ type: "create" }));
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "created" && msg.room) {
          ws.close();
          props.onEnter(msg.room, name);
        }
      } catch { }
    };
    ws.onerror = () => { try { ws.close(); } catch { } };
  };

  const handleJoin = () => {
    const name = (playerName.trim() || "Player").slice(0, 24);
    setCookie("ws_name", name);
    const room = roomInput.trim().toLowerCase();
    if (!room) return;
    props.onEnter(room, name);
  };

  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-slate-900 via-slate-950 to-black text-white">
      <div className="w-[28rem] rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4">
        <h1 className="text-lg font-semibold">Weiss Schwarz — Online Table</h1>

        <label className="block text-sm">
          Player name
          <input
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            className="mt-1 w-full rounded-lg bg-black/40 border border-white/10 px-2 py-1 outline-none"
            placeholder="e.g. KurumiEnjoyer"
            maxLength={24}
          />
        </label>

        <div className="flex gap-2">
          <button
            className={`px-3 py-1.5 rounded-xl border ${mode === "create" ? "bg-slate-800" : "bg-white/10"}`}
            onClick={() => setMode("create")}
          >
            Create room
          </button>
          <button
            className={`px-3 py-1.5 rounded-xl border ${mode === "join" ? "bg-slate-800" : "bg-white/10"}`}
            onClick={() => setMode("join")}
          >
            Join room
          </button>
        </div>

        {mode === "join" && (
          <label className="block text-sm">
            Room ID
            <input
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value.replace(/[^0-9a-f]/gi, ""))}
              className="mt-1 w-full rounded-lg bg-black/40 border border-white/10 px-2 py-1 outline-none font-mono"
              placeholder="paste 32-char hex id…"
            />
          </label>
        )}

        <div className="flex justify-end">
          {mode === "create" ? (
            <button
              onClick={handleCreate}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10"
            >
              Create & enter
            </button>
          ) : (
            <button
              onClick={handleJoin}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10"
            >
              Join
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* =========================
   Room Screen
========================= */
function RoomScreen({ roomId, playerName }: { roomId: string; playerName: string }) {
  const [showSettings, setShowSettings] = React.useState(false);
  const { status, isFull, players, myId, myName, mySeat, role, sendZoneState, opponentZones } =
    useRoom({ room: roomId, playerName });

  const youAreSpectator = role === "spectator";

  // Layout FIRST (avoid “layout before init”)
  const [layout, setLayout] = useState<"vertical" | "horizontal">(
    () => (localStorage.getItem(LAYOUT_KEY) as any) === "horizontal" ? "horizontal" : "vertical"
  );
  useEffect(() => { try { localStorage.setItem(LAYOUT_KEY, layout); } catch { } }, [layout]);

  // wallpaper hook (note: pass current layout)
  const wp = useDeckWallpaper(layout);

  // keep your lastEntries state to pass dominant set into wp.pickFor
  const [lastEntries, setLastEntries] = useState<{ id: string; count: number }[] | null>(null);

  // Show import modal when entering if not spectating
  const [showImport, setShowImport] = useState(false);
  useEffect(() => { if (!youAreSpectator) setShowImport(true); }, [youAreSpectator]);

  // Track my zones to sync to server
  const [myZones, setMyZones] = useState<ZonesPayload | null>(null);
  useEffect(() => {
    if (!myZones) return;
    const t = setTimeout(() => sendZoneState(myZones), 40);
    return () => clearTimeout(t);
  }, [myZones, sendZoneState]);

  const playersLabel = players.length
    ? players.map((p) => `${p.name}(${p.seat})`).join(", ")
    : "—";

  return (
    <div
      className="min-h-screen text-white"

      style={
        wp.enabled && wp.bgUrl
          ? {
            backgroundImage: `linear-gradient(rgba(5,10,25,${(wp.opacity / 100) * 0.85}), rgba(5,10,25,${(wp.opacity / 100)})), url(${wp.bgUrl})`,
            backgroundSize: wp.fit,
            backgroundPosition: wp.position,
            backgroundAttachment: "fixed",
          }
          : { backgroundColor: "#0b1220" }
      }
    >
      {/* Import deck modal */}
      <ImportDeckModal
        open={showImport && !youAreSpectator}
        onClose={() => setShowImport(false)}
        onReady={({ name, entries, raw }) => {
          window.dispatchEvent(new CustomEvent("ws-import-deck", { detail: { name, entries, raw } }));
          setLastEntries(entries);
          // set wallpaper theme from dominant set (this will also scan thumbnails)
          wp.pickFor(dominantSetFromEntries(entries));
          setShowImport(false);
        }}
      />

      <div
        className="w-full mx-auto p-3 md:p-4 space-y-4"

      >
        <header className="flex items-center justify-between text-sm opacity-80">
          <div className="space-x-2 truncate">
            <span>Room: <b className="font-mono">{roomId}</b></span>
            <span>· Status: <b>{status}{isFull ? " (full)" : ""}</b></span>
            <span>· Players: {playersLabel}</span>
            <span>· You: <b>{myName || myId || "…"}</b>{mySeat ? ` / seat ${mySeat}` : ""}{youAreSpectator ? " / spectator" : ""}</span>
          </div>
          <button
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/10"
            onClick={() => setShowSettings(true)}
            title="Open settings"
          >
            Settings
          </button>
        </header>

        {/* Settings menu (Board tab includes Import + Change View + Wallpaper picker) */}
        <SettingsMenu
          open={showSettings}
          onClose={() => setShowSettings(false)}
          layout={layout}
          setLayout={setLayout}
          openImport={() => { setShowSettings(false); setShowImport(true); }}
          wp={{
            enabled: wp.enabled,
            setEnabled: wp.setEnabled,
            fit: wp.fit,
            setFit: wp.setFit,
            position: wp.position,
            setPosition: wp.setPosition,
            opacity: wp.opacity,
            setOpacity: wp.setOpacity,
            autoSelect: wp.autoSelect,
            setAutoSelect: wp.setAutoSelect,
            images: wp.images,
            selectedIdx: wp.selectedIdx,
            pickIndex: wp.pickIndex,
            // NEW:
            customUrls: wp.customUrls,
            selectedCustom: wp.selectedCustom,
            setCustomUrl: wp.setCustomUrl,
            customEnabled: wp.customEnabled,
            setCustomEnabled: wp.setCustomEnabled,
          }}
        />

        {layout === "vertical" ? (
          /* Stacked vertical boards */
          <div className="w-full grid gap-4 items-stretch">
            <div className="w-full rounded-3xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-white/70 mb-2">Opponent</div>
              {opponentZones ? (
                <WSPlayfield
                  readOnly
                  side="right"
                  layout="vertical"
                  externalZones={normalizeOpponentZones(opponentZones) as any}
                />
              ) : (
                <div className="text-white/60 text-sm">Waiting for opponent…</div>
              )}
            </div>

            <div className="w-full rounded-3xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-white/70 mb-2">{youAreSpectator ? "You (spectating)" : "You"}</div>
              <WSPlayfield
                readOnly={youAreSpectator}
                side="left"
                layout="vertical"
                onZonesChange={setMyZones as any}
              />
            </div>
          </div>
        ) : (
          /* Horizontal face-to-face */
          <div className="w-full">
            <div id="cluster-wrapper" className="w-fit inline-flex items-start gap-2">
              <WSPlayfield
                readOnly={youAreSpectator}
                side="left"
                layout="horizontal"
                onZonesChange={setMyZones as any}
              />
              {opponentZones ? (
                <WSPlayfield
                  readOnly
                  side="right"
                  layout="horizontal"
                  externalZones={normalizeOpponentZones(opponentZones) as any}
                />
              ) : (
                <div className="p-6 rounded-3xl border border-white/10 bg-white/5 text-white/60 text-sm h-full grid place-items-center">
                  Waiting for opponent…
                </div>
              )}
            </div>

            {!youAreSpectator && (
              <div className="mt-4 space-y-4">
                <div id="hand-slot" />
                <div id="import-slot" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* =========================
   App root
========================= */
function App() {
  const url = new URL(window.location.href);
  const initialRoom = (url.searchParams.get("room") || "").toLowerCase();
  const initialName = getCookie("ws_name") || "";

  const [roomId, setRoomId] = useState<string>(initialRoom);
  const [playerName, setPlayerName] = useState<string>(initialName);

  return roomId ? (
    <RoomScreen roomId={roomId} playerName={playerName || "Player"} />
  ) : (
    <JoinMenu
      onEnter={(id, name) => {
        setRoomId(id);
        setPlayerName(name);
        const params = new URLSearchParams(location.search);
        params.set("room", id);
        history.replaceState(null, "", `?${params.toString()}`);
      }}
    />
  );
}

export default App;
