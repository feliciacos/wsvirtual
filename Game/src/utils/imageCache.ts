// src/utils/imageCache.ts
type Entry = { img: HTMLImageElement; last: number };
const MAX = 150; // tune
const cache = new Map<string, Entry>();

export function getImage(url: string): HTMLImageElement {
  const now = Date.now();
  let e = cache.get(url);
  if (!e) {
    const img = new Image();
    img.loading = "lazy";
    img.decoding = "async" as any;
    img.src = url;
    e = { img, last: now };
    cache.set(url, e);
  }
  e.last = now;
  return e.img;
}

export function sweepImages() {
  if (cache.size <= MAX) return;
  // remove coldest
  const arr = [...cache.entries()].sort((a,b)=>a[1].last-b[1].last);
  for (let i = 0; i < arr.length - MAX; i++) cache.delete(arr[i][0]);
}

// run every 45s
setInterval(sweepImages, 45_000);