// src/net/useRoom.ts
import { useEffect, useRef, useState } from "react";

export type ZoneKey =
  | "CENTER_L" | "CENTER_C" | "CENTER_R"
  | "BACK_L" | "BACK_R"
  | "CLIMAX" | "LEVEL" | "CLOCK"
  | "STOCK" | "WAITING_ROOM" | "MEMORY"
  | "DECK" | "HAND";

type Card = { uid: string; id: string; name?: string; rot?: 0 | 90 | 180 };
export type ZonesPayload = Record<ZoneKey, Card[]>;

type Seat = "A" | "B";
type Role = "player" | "spectator";
type RosterEntry = { id: string; name: string; seat: Seat };

export function generateRoomId(bytes = 16): string {
  try {
    const a = new Uint8Array(bytes);
    crypto.getRandomValues(a);
    return Array.from(a).map(x => x.toString(16).padStart(2, "0")).join("");
  } catch {
    let s = ""; for (let i = 0; i < bytes; i++) s += Math.floor(Math.random()*256).toString(16).padStart(2,"0");
    return s;
  }
}

type UseRoomOpts = { room: string; playerName: string };

export const WS_URL =
  import.meta.env.VITE_WS_URL ??
    `${location.protocol === 'https:' ? 'wss' : 'ws'}://wsserv.rembestgirl.synology.me`;

export function useRoom({ room, playerName }: UseRoomOpts) {
  const [status, setStatus] = useState<"connecting" | "open" | "closed">("connecting");
  const [players, setPlayers] = useState<RosterEntry[]>([]);
  const [myId, setMyId] = useState("");
  const [myName, setMyName] = useState(playerName);
  const [role, setRole] = useState<Role>("player");
  const [mySeat, setMySeat] = useState<Seat | null>(null);
  const [opponentZones, setOpponentZones] = useState<ZonesPayload | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!room) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    setStatus("connecting");
    setMyId(""); setMySeat(null); setRole("player"); setMyName(playerName);

    ws.onopen = () => {
      setStatus("open");
      ws.send(JSON.stringify({ type: "join", room, seat: "AUTO", name: playerName }));
    };

    ws.onerror = (ev) => console.warn("WS error", ev);
    ws.onclose = () => setStatus("closed");

    ws.onmessage = (e) => {
      if (wsRef.current !== ws) return;
      let msg: any; try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === "hello") return;

      if (msg.type === "error") {
        setRole("spectator"); setMySeat(null);
        return;
      }
      if (msg.type === "joined") {
        setMyId(msg.id || "");
        if (msg.seat === "A" || msg.seat === "B") { setMySeat(msg.seat); setRole("player"); }
        else if (msg.role === "spectator") { setMySeat(null); setRole("spectator"); }
        if (msg.name) setMyName(String(msg.name));
        return;
      }
      if (msg.type === "roster") {
        const roster: RosterEntry[] = Array.isArray(msg.roster) ? msg.roster : [];
        setPlayers(roster);
        return;
      }
      if (msg.type === "zones") {
        setOpponentZones(msg.zones || null);
        return;
      }
    };

    return () => { if (wsRef.current === ws) wsRef.current = null; try { ws.close(); } catch {} };
  }, [room, playerName]);

  const sendZoneState = (zones: ZonesPayload) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || role !== "player") return;
    ws.send(JSON.stringify({ type: "zones", zones }));
  };

  const isFull = players.length >= 2;

  return {
    status, isFull,
    players,
    myId, myName, mySeat, role,
    sendZoneState,
    opponentZones,
  };
}
