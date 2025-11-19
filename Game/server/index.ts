// server/index.ts
import { WebSocketServer, WebSocket } from "ws";
import { randomBytes } from "crypto";


type Seat = "A" | "B";
type Player = { id: string; ws: WebSocket; room: string; seat: Seat; name: string; alive: boolean };
type Room = { A?: Player; B?: Player; spectators?: Set<WebSocket> };

const PORT = 8080;
const wss = new WebSocketServer({
  port: PORT,
  perMessageDeflate: {
    zlibDeflateOptions: { level: 6 },
    clientNoContextTakeover: true,
    serverNoContextTakeover: true,
    threshold: 512,
  },
});

const rooms = new Map<string, Room>();

/** Generic sender. If allowDrop is true, we may drop when socket is congested. */
function send(ws: WebSocket, msg: any, allowDrop = false) {
  if (ws.readyState !== WebSocket.OPEN) return;
  if (allowDrop && ws.bufferedAmount > 256 * 1024) return; // selective drop on congestion
  try { ws.send(JSON.stringify(msg)); } catch {}
}

/** Broadcast roster to players + spectators */
function broadcastRoom(roomId: string) {
  const r = rooms.get(roomId);
  if (!r) return;
  const roster = [r.A, r.B]
    .filter(Boolean)
    .map(p => ({ id: (p as Player).id, name: (p as Player).name, seat: (p as Player).seat }));
  for (const p of [r.A, r.B]) if (p) send(p.ws, { type: "roster", room: roomId, roster }, /*allowDrop*/ false);
  if (r.spectators) for (const s of r.spectators) send(s, { type: "roster", room: roomId, roster }, false);
}

function generateUniqueRoomId(): string {
  let id: string;
  do { id = randomBytes(16).toString("hex"); } while (rooms.has(id));
  return id;
}

/** Periodic room cleanup (delete empty rooms) */
setInterval(() => {
  for (const [id, r] of rooms) {
    const hasPlayers = !!(r.A || r.B);
    const hasSpectators = !!(r.spectators && r.spectators.size);
    if (!hasPlayers && !hasSpectators) rooms.delete(id);
  }
}, 60_000);

/** ---- Coalesced ZONES flushing (latest-wins, ~30 FPS) ---- */
type ZonesPayload = { type: "zones"; fromSeat: Seat; zones: any; seq?: number };

const latestZones = new WeakMap<WebSocket, ZonesPayload>();
const ticking = new WeakSet<WebSocket>();

function scheduleFlush(to: WebSocket) {
  if (ticking.has(to)) return;
  ticking.add(to);
  setTimeout(() => {
    ticking.delete(to);
    const payload = latestZones.get(to);
    if (!payload) return;
    // zones are heavy; send with congestion-aware drop
    send(to, payload, /*allowDrop*/ true);
    latestZones.delete(to);
  }, 33); // ~30 FPS
}

wss.on("connection", (ws) => {
  let me: Player | null = null;

  // Heartbeat: mark alive on connect & on pong
  (ws as any).isAlive = true;
  ws.on("pong", () => { (ws as any).isAlive = true; if (me) me.alive = true; });

  send(ws, { type: "hello" }, false);

  ws.on("message", (raw) => {
    let msg: any;
    try { msg = JSON.parse(String(raw)); } catch { return; }

    // --- CREATE ---
    if (msg.type === "create") {
      const roomId = generateUniqueRoomId();
      if (!rooms.has(roomId)) rooms.set(roomId, {});
      send(ws, { type: "created", room: roomId }, false);
      return;
    }

    // --- JOIN ---
    if (msg.type === "join") {
      const roomId = String(msg.room || "").trim();
      const requested = String(msg.seat || "").toUpperCase(); // "AUTO" | "A" | "B" | "SPECTATOR"
      const name = (String(msg.name || "").trim() || "Player").slice(0, 24);
      if (!roomId) return send(ws, { type: "error", reason: "room required" }, false);

      const room = rooms.get(roomId) || {};
      rooms.set(roomId, room);

      const pickAuto = (): Seat | "spectator" => (!room.A ? "A" : !room.B ? "B" : "spectator");

      let seat: Seat | "spectator";
      if (requested === "A" || requested === "B") seat = requested;
      else if (requested === "AUTO") seat = pickAuto();
      else seat = "spectator";

      if (seat === "spectator") {
        if (!room.spectators) room.spectators = new Set();
        room.spectators.add(ws);
        send(ws, { type: "joined", room: roomId, id: `Spectator-${Math.random().toString(36).slice(2,7)}`, role: "spectator", name }, false);
        broadcastRoom(roomId);
        return;
      }

      if (room[seat]) return send(ws, { type: "error", reason: `Seat ${seat} is occupied` }, false);

      const id = `Player-${Math.random().toString(36).slice(2, 7)}`;
      me = { id, ws, room: roomId, seat, name, alive: true };

      room[seat] = me;
      rooms.set(roomId, room);

      send(ws, { type: "joined", room: roomId, id, seat, name }, false);
      broadcastRoom(roomId);
      return;
    }

    // --- ZONES relay (coalesced + backpressure-aware) ---
    if (msg.type === "zones" && me) {
      const room = rooms.get(me.room);
      if (!room) return;
      const payload: ZonesPayload = { type: "zones", fromSeat: me.seat, zones: msg.zones, seq: msg.seq };

      const push = (sock: WebSocket) => {
        latestZones.set(sock, payload);   // overwrite previous -> latest wins
        scheduleFlush(sock);
      };

      const otherSeat: Seat = me.seat === "A" ? "B" : "A";
      const other = room[otherSeat];
      if (other) push(other.ws);
      if (room.spectators) for (const s of room.spectators) push(s);
      return;
    }
  });

  ws.on("close", () => {
    if (!me) {
      // Maybe a spectator
      for (const [id, r] of rooms) {
        if (r.spectators && r.spectators.delete(ws)) {
          if (!r.spectators.size) delete r.spectators;
          broadcastRoom(id);
          break;
        }
      }
      return;
    }
    const room = rooms.get(me.room);
    if (!room) return;
    if (room[me.seat]?.id === me.id) room[me.seat] = undefined;
    rooms.set(me.room, room);
    broadcastRoom(me.room);
  });
});

/** Heartbeat sweep: terminate dead sockets */
setInterval(() => {
  wss.clients.forEach((ws: any) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  });
}, 30_000);

console.log(`WS relay on ws://wsserv.rembestgirl.synology.me:${PORT}`);