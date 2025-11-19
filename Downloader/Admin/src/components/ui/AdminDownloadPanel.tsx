// src/components/ui/AdminDownloadPanel.tsx
import React, { useEffect, useRef, useState } from "react";

type StatusJson = {
  percent?: number | string;
  timestamp?: string;
  lastLog?: string;
  state?: string;
  jobId?: string;
  totalfiles?: {
    engtotal?: number;
    jptotal?: number;
    engmissing?: number;
    jpmissing?: number;
  };
  percent_details?: {
    totalpercent?: number | string;
    totalpercenteng?: number | string;
    totalpercentjp?: number | string;
    currentpercent?: number | string;
    currentpercenteng?: number | string;
    currentpercentjp?: number | string;
  };
};

function ActionButton({
  children,
  onClick,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className="btn"
      onClick={onClick}
      disabled={disabled}
      type="button"
      style={{ marginRight: 8, marginBottom: 8 }}
    >
      {children}
    </button>
  );
}

function toSafeNumber(v: any): number {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return Math.round(n);
}

/**
 * helper: compute overlay percent given baseline (B) and current-run percent (C)
 * Overlay = B + (100 - B) * (C / 100)
 */
function computeOverlayPercent(baseline: number, current: number) {
  const B = Math.max(0, Math.min(100, baseline || 0));
  const C = Math.max(0, Math.min(100, current || 0));
  const rem = 100 - B;
  const overlay = B + (rem * (C / 100));
  return Math.max(0, Math.min(100, Math.round(overlay * 100) / 100)); // round to 2 decimals
}

export default function AdminDownloadPanel(): React.ReactElement {
  const [status, setStatus] = useState<StatusJson>({});
  const [running, setRunning] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [autoManifest, setAutoManifest] = useState<boolean>(true);

  const sseRef = useRef<EventSource | null>(null);
  const pollRef = useRef<number | null>(null);
  const [pollingEnabled, setPollingEnabled] = useState(false); // do NOT poll until user triggers

  const logsRef = useRef<string[]>([]);
  const [logsView, setLogsView] = useState<string[]>([]);
  const logBoxRef = useRef<HTMLDivElement | null>(null);
  const MAX_LOGS = 500;

  // throttle repeated status fetches
  const lastFetchRef = useRef<number>(0);
  const FETCH_MIN_MS = 600;

  // global guard to ensure only one polling interval runs across re-mounts/duplicates
  // attach to window so multiple component instances or hot-reloads don't start multiple pollers
  // @ts-ignore
  if (typeof window !== "undefined" && !(window as any).__admin_poll_lock) {
    // @ts-ignore
    (window as any).__admin_poll_lock = { active: false };
  }

  const pushLog = (line: string) => {
    if (!line) return;
    const arr = [line, ...logsRef.current];
    if (arr.length > MAX_LOGS) arr.length = MAX_LOGS;
    logsRef.current = arr;
    setLogsView([...arr]);
    requestAnimationFrame(() => {
      if (logBoxRef.current) logBoxRef.current.scrollTop = 0;
    });
  };

  const mergeStatus = (partial: Partial<StatusJson>) => {
    setStatus((prev) => {
      const next: StatusJson = { ...(prev || {}) };

      if (!partial) return next;

      if (partial.totalfiles) {
        next.totalfiles = { ...(prev?.totalfiles || {}), ...(partial.totalfiles || {}) };
      }

      if (partial.percent_details) {
        next.percent_details = { ...(prev?.percent_details || {}), ...(partial.percent_details || {}) };
      }

      for (const key of Object.keys(partial)) {
        if (key === "totalfiles" || key === "percent_details") continue;
        // @ts-ignore
        next[key] = (partial as any)[key];
      }

      // notify header/sidebar that listens for this event
      try {
        window.dispatchEvent(new CustomEvent("admin-status", { detail: partial }));
      } catch (e) {
        // ignore
      }

      return next;
    });
  };

  const fetchStatusFile = async (reportErrors = false) => {
    const now = Date.now();
    if (now - lastFetchRef.current < FETCH_MIN_MS) return null;
    lastFetchRef.current = now;

    // canonical authoritative endpoint only
    const endpoints = ["/api/status-file", "/status.json"];
    for (const ep of endpoints) {
      try {
        const resp = await fetch(ep, { cache: "no-store" });
        if (!resp.ok) {
          if (reportErrors) console.debug(`[status] ${ep} returned ${resp.status}`);
          continue;
        }
        const j: StatusJson = await resp.json();
        mergeStatus(j);
        if ((j.state || "").toLowerCase() === "running") setRunning(true);
        else setRunning(false);
        if (j.lastLog) pushLog(j.lastLog);
        if (reportErrors) console.debug(`[status] loaded from ${ep}`, j);
        return j;
      } catch (err) {
        if (reportErrors) console.debug(`[status] fetch ${ep} failed:`, err);
        continue;
      }
    }
    return null;
  };

  const startPolling = () => {
    if (!pollingEnabled) return;
    // check global guard
    // @ts-ignore
    const guard = window.__admin_poll_lock || { active: false };
    if (guard.active) {
      // another instance already created the poller — save our interval id but don't start a duplicate
      return;
    }
    // claim guard and start interval
    // @ts-ignore
    window.__admin_poll_lock.active = true;

    if (pollRef.current) return;
    // one immediate read then regular interval
    fetchStatusFile(false);
    pollRef.current = window.setInterval(() => fetchStatusFile(false), 2000);
  };

  const stopPolling = () => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    // release guard
    // @ts-ignore
    if (window.__admin_poll_lock) window.__admin_poll_lock.active = false;
  };

  const openSse = (id: string) => {
    if (!id) return;
    if (sseRef.current) {
      try {
        sseRef.current.close();
      } catch {}
      sseRef.current = null;
    }

    try {
      const es = new EventSource(`/api/progress/${encodeURIComponent(id)}`);
      sseRef.current = es;
      setJobId(id);
      setRunning(true);
      // SSE becomes primary stream for progress — stop the poller while attached
      stopPolling();

      es.addEventListener("progress", (ev: MessageEvent) => {
        try {
          let parsed: any;
          try {
            parsed = JSON.parse(ev.data);
          } catch {
            parsed = ev.data;
          }
          const p = (typeof parsed === "object" && typeof parsed.percent === "number") ? parsed.percent : Number(parsed);
          if (!Number.isNaN(p)) {
            const existingTotals = status.totalfiles || {};
            const engTotal = Number(existingTotals.engtotal || 0);
            const jpTotal = Number(existingTotals.jptotal || 0);

            const pd: any = { currentpercent: 0, currentpercenteng: 0, currentpercentjp: 0 };

            if (typeof parsed === "object" && parsed.lang === "ENG") {
              pd.currentpercenteng = Number(p);
            } else if (typeof parsed === "object" && parsed.lang === "JP") {
              pd.currentpercentjp = Number(p);
            } else if (typeof parsed === "object" && (parsed.currentpercenteng || parsed.currentpercentjp)) {
              if (parsed.currentpercenteng) pd.currentpercenteng = Number(parsed.currentpercenteng);
              if (parsed.currentpercentjp) pd.currentpercentjp = Number(parsed.currentpercentjp);
              if (parsed.currentpercent) pd.currentpercent = Number(parsed.currentpercent);
            } else {
              if (engTotal > 0 && jpTotal === 0) {
                pd.currentpercenteng = Number(p);
              } else if (jpTotal > 0 && engTotal === 0) {
                pd.currentpercentjp = Number(p);
              } else {
                pd.currentpercent = Number(p);
              }
            }
            mergeStatus({ percent_details: pd });
          }
        } catch (e) {}
      });

      es.addEventListener("log", (ev: MessageEvent) => {
        const txt = String(ev.data || "");
        mergeStatus({ lastLog: txt });
        pushLog(txt);
      });

      es.addEventListener("info", (ev: MessageEvent) => {
        try {
          const d = JSON.parse(ev.data);
          mergeStatus(d);
          if (d.state && String(d.state).toLowerCase() !== "running") setRunning(false);
        } catch {}
      });

      es.addEventListener("done", (ev: MessageEvent) => {
        try {
          const d = (() => {
            try {
              return JSON.parse(ev.data);
            } catch {
              return null;
            }
          })();
          if (d && typeof d === "object") {
            mergeStatus(d);
            const pdUpdate: any = {};
            if (d.currentpercenteng !== undefined || (d.percent_details && d.percent_details.currentpercenteng !== undefined)) {
              pdUpdate.currentpercenteng = 100;
            }
            if (d.currentpercentjp !== undefined || (d.percent_details && d.percent_details.currentpercentjp !== undefined)) {
              pdUpdate.currentpercentjp = 100;
            }
            if (Object.keys(pdUpdate).length === 0) pdUpdate.currentpercent = 100;
            mergeStatus({ percent_details: pdUpdate });
          } else {
            mergeStatus({ percent_details: { currentpercent: 100 } });
          }
        } catch {}
        setRunning(false);
        try {
          es.close();
        } catch {}
        sseRef.current = null;
        if (autoManifest) triggerManifest();
        if (pollingEnabled) startPolling();
      });

      es.onerror = () => {
        try {
          es.close();
        } catch {}
        sseRef.current = null;
        // when SSE errors, return to polling mode
        startPolling();
      };
    } catch (e) {
      startPolling();
    }
  };

  const tryAttachToRunningJob = async () => {
    try {
      const resp = await fetch("/api/download/status");
      if (!resp.ok) return;
      const json = await resp.json();
      const jobsArr = Array.isArray(json.jobs) ? json.jobs : (Array.isArray(json) ? json : (json.jobs ? json.jobs : []));
      if (!jobsArr || jobsArr.length === 0) return;
      const runningJob = jobsArr
        .slice()
        .reverse()
        .find((j: any) => j.state && String(j.state).toLowerCase() === "running")
        || jobsArr.slice().reverse().find((j: any) => j.state && String(j.state).toLowerCase() === "queued");
      if (runningJob && runningJob.jobId) {
        openSse(String(runningJob.jobId));
      }
    } catch (err) {
      console.debug("[job attach] /api/download/status failed:", err);
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const resp = await fetch("/api/settings");
        if (resp.ok) {
          const sj = await resp.json();
          if (mounted && typeof sj.autoManifest === "boolean") setAutoManifest(sj.autoManifest);
          try {
            localStorage.setItem("adminSettings", JSON.stringify(sj));
          } catch {}
        } else {
          const raw = localStorage.getItem("adminSettings");
          if (raw) {
            const parsed = JSON.parse(raw);
            if (mounted && typeof parsed.autoManifest === "boolean") setAutoManifest(parsed.autoManifest);
          }
        }
      } catch {}

      // single initial read ONCE (do not start polling)
      const loaded = await fetchStatusFile(true);
      if (!loaded) {
        console.debug("[status] no status.json loaded on mount");
      } else {
        if (mounted) {
          mergeStatus(loaded);
          if (loaded.lastLog) pushLog(loaded.lastLog);
          if ((loaded.state || "").toLowerCase() === "running") setRunning(true);
        }
      }

      await tryAttachToRunningJob();
      // DO NOT start polling automatically unless user triggers a download
    })();

    return () => {
      mounted = false;
      if (sseRef.current) try {
        sseRef.current.close();
      } catch {}
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Trigger download — ensure polling starts early to pick up server-written status.json
  const triggerDownload = async (type: "ENG" | "JP" | "BOTH" | "manifest") => {
    if (type !== "manifest") {
      logsRef.current = [];
      setLogsView([]);
    }
    setRunning(true);
    setJobId(null);

    // enable polling and start it immediately so we pick up status.json / totals as soon as it's created
    setPollingEnabled(true);
    startPolling();

    // immediate fetch to pick up any server-written totals just-before-run (best-effort)
    await fetchStatusFile(true);

    try {
      const resp = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      const text = await resp.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {}
      if (resp.status === 202 && json && json.jobId) {
        // open SSE for live updates (this will stop polling inside openSse)
        openSse(String(json.jobId));
      } else {
        // fallback: keep polling (already started)
      }
    } catch (e) {
      // on network error fallback to polling (already started)
      console.debug("[download] start error", e);
    }
  };

  const triggerManifest = async () => {
    try {
      await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "manifest" }),
      });
    } catch {}
  };

  const cancelJob = async () => {
    let id = jobId;
    if (!id) {
      try {
        const resp = await fetch("/api/download/status");
        if (resp.ok) {
          const obj = await resp.json();
          const jobsArr = Array.isArray(obj.jobs) ? obj.jobs : (Array.isArray(obj) ? obj : (obj.jobs ? obj.jobs : []));
          const runningJob = jobsArr.slice().reverse().find((j: any) => j.state && String(j.state).toLowerCase() === "running");
          if (runningJob && runningJob.jobId) id = runningJob.jobId;
        }
      } catch {}
    }
    if (!id) {
      pushLog("[client] no active job found to cancel");
      return;
    }
    try {
      const resp = await fetch(`/api/cancel/${encodeURIComponent(id)}`, { method: "POST" });
      if (resp.ok) {
        pushLog(`[client] cancel requested for ${id}`);
        setRunning(false);
        if (sseRef.current) try {
          sseRef.current.close();
        } catch {}
        sseRef.current = null;
        stopPolling();
      } else {
        pushLog(`[client] cancel failed: ${resp.status}`);
      }
    } catch (e) {
      pushLog(`[client] cancel error: ${String(e)}`);
    }
  };

  const saveAutoManifest = async (v: boolean) => {
    setAutoManifest(v);
    try {
      localStorage.setItem("adminSettings", JSON.stringify({ autoManifest: v }));
    } catch {}
    try {
      await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autoManifest: v }) });
    } catch {}
  };

  // -------------------------
  // Percent computation & fallback logic
  // -------------------------
  // derive counts from status.totalfiles (safe numeric)
  const engTotalFiles = Number(status.totalfiles?.engtotal || 0);
  const jpTotalFiles = Number(status.totalfiles?.jptotal || 0);
  const engMissing = Number(status.totalfiles?.engmissing || 0);
  const jpMissing = Number(status.totalfiles?.jpmissing || 0);

  const engCompleted = Math.max(0, engTotalFiles - engMissing);
  const jpCompleted = Math.max(0, jpTotalFiles - jpMissing);

  const overallTotalFiles = engTotalFiles + jpTotalFiles;
  // baseline total percent (prefer explicit from percent_details, else compute from totals)
  const baselineTotalPercent = toSafeNumber(
    status.percent_details?.totalpercent ??
      (overallTotalFiles ? Math.round(((engCompleted + jpCompleted) / overallTotalFiles) * 100) : 0)
  );

  // language-specific total percents (prefer explicit)
  const totalEng = Number(status.percent_details?.totalpercenteng ?? 0);
  const totalJp = Number(status.percent_details?.totalpercentjp ?? 0);

  // language-specific current percents (reported by SSE or status.json)
  const curEngReported = Number(status.percent_details?.currentpercenteng ?? status.percent_details?.currentpercent ?? 0);
  const curJpReported = Number(status.percent_details?.currentpercentjp ?? status.percent_details?.currentpercent ?? 0);

  // compute overlay percents
  const overlayEng = computeOverlayPercent(totalEng, curEngReported);
  const overlayJp = computeOverlayPercent(totalJp, curJpReported);

  // final values for UI bars:
  const totalPercent = baselineTotalPercent;
  const curTotalSafe = Math.max(0, Math.min(100, Math.round(((overlayEng * engTotalFiles) + (overlayJp * jpTotalFiles)) / (overallTotalFiles || 1)))); // not used visually by design

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <h3 style={{ margin: 0 }}>Get local copy of ENG / JP DB</h3>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <ActionButton onClick={() => triggerDownload("ENG")} disabled={running}>
            Download DB-ENG
          </ActionButton>
          <ActionButton onClick={() => triggerDownload("JP")} disabled={running}>
            Download DB-JP
          </ActionButton>
          <ActionButton onClick={() => triggerDownload("BOTH")} disabled={running}>
            Download Both
          </ActionButton>
          <ActionButton onClick={() => triggerDownload("manifest")} disabled={running}>
            Generate Manifest
          </ActionButton>
          <ActionButton onClick={cancelJob} disabled={!running && !jobId}>
            Cancel
          </ActionButton>
        </div>
      </div>

      <div style={{ marginTop: 12 }} className="setting-row">
        <input
          type="checkbox"
          id="autoManifest"
          checked={autoManifest}
          onChange={(e) => saveAutoManifest(e.target.checked)}
        />
        <label htmlFor="autoManifest" className="small-muted">
          Automatically generate manifest after download
        </label>
      </div>

      <div style={{ marginTop: 12 }} className="progress-row">
        <div style={{ fontWeight: 700 }}>Overall</div>
        <div className="small-muted">{totalPercent}%</div>
      </div>
      <div style={{ marginTop: 8 }} className="progress-track" aria-hidden>
        <div className={`progress-total ${totalPercent === 100 ? "complete" : ""}`} style={{ width: `${totalPercent}%` }} />
        {/* no overall running overlay by design; language bars show live progress */}
      </div>

      <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div style={{ fontWeight: 700 }}>ENG</div>
            <div className="small-muted">
              {running ? `running · ${overlayEng}%` : `idle · ${toSafeNumber(curEngReported)}%`}
            </div>
          </div>
          <div style={{ marginTop: 8 }} className="progress-track">
            <div className={`progress-total ${Math.round(totalEng) === 100 ? "complete" : ""}`} style={{ width: `${totalEng}%` }} />
            <div
              className={`progress-current ${overlayEng > totalEng && running ? "running" : ""}`}
              style={{ width: `${overlayEng}%` }}
            />
          </div>
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div style={{ fontWeight: 700 }}>JP</div>
            <div className="small-muted">
              {running ? `running · ${overlayJp}%` : `idle · ${toSafeNumber(curJpReported)}%`}
            </div>
          </div>
          <div style={{ marginTop: 8 }} className="progress-track">
            <div className={`progress-total ${Math.round(totalJp) === 100 ? "complete" : ""}`} style={{ width: `${totalJp}%` }} />
            <div
              className={`progress-current ${overlayJp > totalJp && running ? "running" : ""}`}
              style={{ width: `${overlayJp}%` }}
            />
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Progress Log</div>
        <div ref={logBoxRef} className="log-box" role="log" aria-live="polite">
          {logsView.length === 0 ? (
            <div style={{ color: "rgba(255,255,255,0.6)" }}>No log yet.</div>
          ) : (
            logsView.map((l, i) => (
              <div key={i} className="log-item">
                {l}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
