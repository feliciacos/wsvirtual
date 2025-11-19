// src/components/ui/AdminSettings.tsx
import React, { useEffect, useState } from "react";
import AdminDownloadPanel from "./AdminDownloadPanel";

export type AdminSettingsProps = {
  open?: boolean;
};

const AdminSettings: React.FC<AdminSettingsProps> = ({ open = true }) => {
  const [active, setActive] = useState<"Download" | "Temp">("Download");
  const [statusPct, setStatusPct] = useState<number | null>(null);
  const [totalsText, setTotalsText] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    // canonical status endpoint
    const STATUS_ENDPOINT = "/api/status-file";

    // fetch once on mount so UI is populated on load
    const fetchStatusOnce = async (): Promise<any | null> => {
      try {
        const resp = await fetch(STATUS_ENDPOINT, { cache: "no-store" });
        if (!resp.ok) return null;
        return await resp.json();
      } catch (e) {
        return null;
      }
    };

    (async () => {
      try {
        const j = await fetchStatusOnce();
        if (!mounted || !j) return;

        const pd = j.percent_details || {};
        const tf = j.totalfiles || {};

        if (pd?.totalpercent !== undefined && pd.totalpercent !== null) {
          const pct = Number(pd.totalpercent);
          if (!Number.isNaN(pct)) setStatusPct(Math.round(pct));
        }

        if (tf && Object.keys(tf).length > 0) {
          const engtotal = tf.engtotal ?? null;
          const engmissing = tf.engmissing ?? null;
          const jptotal = tf.jptotal ?? null;
          const jpmissing = tf.jpmissing ?? null;
          setTotalsText(`ENG ${engtotal ?? "—"} (missing ${engmissing ?? "—"})\nJP ${jptotal ?? "—"} (missing ${jpmissing ?? "—"})`);
        }

        if (j.timestamp) {
          setLastUpdate(String(j.timestamp));
        } else if (j.lastLog) {
          setLastUpdate(new Date().toISOString());
        }

        // dispatch same event AdminDownloadPanel listens for so it receives initial payload
        try {
          window.dispatchEvent(new CustomEvent("admin-status", { detail: j }));
        } catch (e) {
          // ignore
        }
      } catch (e) {
        // ignore initial load failures
      }
    })();

    const handler = (ev: any) => {
      if (!mounted) return;
      try {
        const partial = ev?.detail || {};
        const pd = partial.percent_details || {};
        const tf = partial.totalfiles || {};

        if (pd?.totalpercent !== undefined) {
          const pct = Number(pd.totalpercent);
          if (!Number.isNaN(pct)) setStatusPct(Math.round(pct));
        }

        if (tf && Object.keys(tf).length > 0) {
          const engtotal = tf.engtotal ?? null;
          const engmissing = tf.engmissing ?? null;
          const jptotal = tf.jptotal ?? null;
          const jpmissing = tf.jpmissing ?? null;
          setTotalsText(`ENG ${engtotal ?? "—"} (missing ${engmissing ?? "—"})\nJP ${jptotal ?? "—"} (missing ${jpmissing ?? "—"})`);
        }

        if (partial.timestamp) setLastUpdate(String(partial.timestamp));
        if (partial.lastLog) {
          setLastUpdate(new Date().toISOString());
        }
      } catch (e) {
        // ignore malformed events
      }
    };

    window.addEventListener("admin-status", handler);
    return () => {
      mounted = false;
      window.removeEventListener("admin-status", handler);
    };
  }, []);

  if (!open) return null;

  return (
    <div className="page-bg">
      <div className="modal-backdrop" role="dialog" aria-modal="true">
        <div className="modal-panel large" aria-label="Admin modal">
          <div className="modal-header">
            <h2 className="modal-title">Admin Settings</h2>
            <div style={{ marginLeft: "auto" }} className="small-muted">
              {statusPct !== null ? `Status — ${statusPct}%` : "Status — —"}
            </div>
          </div>

          <div className="modal-body">
            <aside className="sidebar" aria-label="Admin sidebar">
              <button
                className={`tab-btn ${active === "Download" ? "tab-active" : ""}`}
                onClick={() => setActive("Download")}
                type="button"
              >
                Download
              </button>

              <button
                className={`tab-btn ${active === "Temp" ? "tab-active" : ""}`}
                onClick={() => setActive("Temp")}
                type="button"
              >
                Temp
              </button>

              <div style={{ marginTop: 18 }}>
                <div className="sect-title small-muted">Status-file</div>
                <div className="helper-text small-muted">Polling /api/status-file (client polling starts after you trigger a download)</div>

                <div style={{ marginTop: 12 }} className="small-muted">Last update:</div>
                <div style={{ marginTop: 4, fontSize: 13, color: "rgba(255,255,255,0.85)" }}>
                  {lastUpdate ?? "—"}
                </div>

                <div style={{ marginTop: 12 }} className="small-muted">Totals:</div>
                <div style={{ marginTop: 6, fontSize: 13, color: "rgba(255,255,255,0.9)", whiteSpace: "pre-line" }}>
                  {totalsText ?? "—"}
                </div>
              </div>
            </aside>

            <section className="content" aria-live="polite">
              {active === "Download" ? (
                <AdminDownloadPanel />
              ) : (
                <div className="placeholder-empty" role="region" aria-label="Temp">
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>Temp</div>
                    <div className="small-muted">No download status shown here — reserved for temporary options.</div>
                  </div>
                </div>
              )}
            </section>
          </div>

          <div className="modal-footer-status">
            <div className="small-muted">Progress log</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminSettings;
