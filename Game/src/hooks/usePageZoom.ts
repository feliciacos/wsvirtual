// src/hooks/usePageZoom.ts
import { useEffect, useRef, useState } from "react";

export default function usePageZoom() {
  const baseDPR = useRef<number>(window.devicePixelRatio || 1);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const vv = window.visualViewport;

    const compute = () => {
      const vvScale = vv?.scale;
      if (vvScale && vvScale !== 1) {
        setZoom(vvScale);
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      setZoom(dpr / baseDPR.current);
    };

    compute();
    vv?.addEventListener("resize", compute);
    window.addEventListener("resize", compute);
    window.addEventListener("orientationchange", compute);

    return () => {
      vv?.removeEventListener("resize", compute);
      window.removeEventListener("resize", compute);
      window.removeEventListener("orientationchange", compute);
    };
  }, []);

  return zoom;
}
