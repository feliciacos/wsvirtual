// Works with files under /public/Images/wallpapers/{SET}/{Vertical|Horizontal}/{N}.jpg

export async function probeImage(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Discover sequential wallpapers: 1.jpg, 2.jpg, ... up to `max`,
 * accepting gaps but stopping after a few consecutive misses.
 */
export async function listPublicWallpapers(
  setKey: string,
  layout: "vertical" | "horizontal",
  max = 30
): Promise<string[]> {
  const orient = layout === "vertical" ? "Vertical" : "Horizontal";
  const base = `/Images/Wallpapers/${setKey}/${orient}`;
  const urls: string[] = [];
  let misses = 0;

  for (let i = 1; i <= max && misses < 5; i++) {
    const url = `${base}/${i}.jpg`;
    if (await probeImage(url)) {
      urls.push(url);
      misses = 0;
    } else {
      misses++;
    }
  }
  return urls;
}
