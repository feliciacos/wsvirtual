// src/components/ui/JoinMenu.tsx
import React, { useMemo, useState } from "react";
import { generateRoomId } from "../../net/useRoom";

type Props = {
  onEnter: (roomId: string, seatPreference?: "A" | "B" | "auto") => void;
};

export default function JoinMenu({ onEnter }: Props) {
  const [mode, setMode] = useState<"create" | "join">("create");
  const [roomInput, setRoomInput] = useState("");
  const [seatPref, setSeatPref] = useState<"auto" | "A" | "B">("auto");

  const createdId = useMemo(() => generateRoomId(16), []);

  const handleGo = () => {
    const roomId = mode === "create" ? createdId : roomInput.trim().toLowerCase();
    if (!roomId) return;
    onEnter(roomId, seatPref);
  };

  return (
    <div className="max-w-md mx-auto p-6 rounded-2xl bg-slate-900/70 text-white space-y-4 border border-slate-700">
      <h2 className="text-xl font-bold">Weiss Schwarz — Online Table</h2>

      <div className="flex gap-4">
        <button
          className={`px-3 py-2 rounded-xl border ${mode === "create" ? "bg-slate-800" : "bg-slate-700/40"}`}
          onClick={() => setMode("create")}
        >Create room</button>
        <button
          className={`px-3 py-2 rounded-xl border ${mode === "join" ? "bg-slate-800" : "bg-slate-700/40"}`}
          onClick={() => setMode("join")}
        >Join room</button>
      </div>

      {mode === "create" ? (
        <div className="space-y-2">
          <label className="block text-sm opacity-80">Room ID (share this):</label>
          <div className="font-mono text-lg break-all p-2 rounded-lg bg-black/30 border border-slate-700">
            {createdId}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block text-sm opacity-80">Enter Room ID</label>
          <input
            className="w-full px-3 py-2 rounded-lg bg-black/30 border border-slate-700 font-mono"
            placeholder="paste 32-char hex id…"
            value={roomInput}
            onChange={(e) => setRoomInput(e.target.value.replace(/[^0-9a-f]/gi, ""))}
          />
        </div>
      )}

      <div className="space-y-2">
        <label className="block text-sm opacity-80">Seat preference</label>
        <div className="flex gap-2">
          {(["auto","A","B"] as const).map(s => (
            <button
              key={s}
              className={`px-3 py-1 rounded-lg border ${seatPref===s ? "bg-slate-800" : "bg-slate-700/40"}`}
              onClick={() => setSeatPref(s)}
            >{s.toUpperCase()}</button>
          ))}
        </div>
        <p className="text-xs opacity-70">
          Auto will pick an available seat; if taken, it automatically tries the other. If both are taken you’ll join as a spectator.
        </p>
      </div>

      <button
        className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 transition border border-emerald-400"
        onClick={handleGo}
      >
        {mode === "create" ? "Create & enter" : "Join"}
      </button>
    </div>
  );
}
