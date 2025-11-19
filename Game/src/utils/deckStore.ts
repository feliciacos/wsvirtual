// src/utils/deckStore.ts
const INDEX_COOKIE = "wsdeck_index"; // JSON array of deck names

function setCookie(name: string, value: string, days = 365) {
  const d = new Date(); d.setTime(d.getTime() + days*24*60*60*1000);
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${d.toUTCString()}; path=/; SameSite=Lax`;
}
function getCookie(name: string) {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/[-./^$*+?()[\]{}|\\]/g,"\\$&")}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : "";
}

function keyFor(name: string) {
  const base = btoa(unescape(encodeURIComponent(name))).replace(/=+$/,"").replace(/\+/g,"-").replace(/\//g,"_");
  return `wsdeck_${base}`;
}

export function listDeckNames(): string[] {
  try {
    const raw = getCookie(INDEX_COOKIE);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr as string[] : [];
  } catch { return []; }
}
function writeIndex(names: string[]) {
  const unique = Array.from(new Set(names));
  setCookie(INDEX_COOKIE, JSON.stringify(unique), 365);
}

export function loadDeck(name: string): string | null {
  const txt = getCookie(keyFor(name));
  return txt || null;
}

export function saveDeck(name: string, text: string) {
  const cleanName = name.trim().slice(0, 80) || "Untitled Deck";
  setCookie(keyFor(cleanName), text, 365);
  const names = listDeckNames();
  if (!names.includes(cleanName)) names.push(cleanName);
  writeIndex(names);
  return cleanName;
}
