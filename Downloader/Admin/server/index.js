// server/index.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import bodyParser from "body-parser";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(bodyParser.json());

// ---- Simple permissive CORS for the API endpoints ----
function allowCors(req, res, next) {
  // adjust origin as needed for security; "*" is permissive for local dev
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
}
app.use("/api", allowCors);

// ---- Configuration: adjust if needed ----
const ADMIN_ROOT = path.resolve(__dirname, ".."); // Downloader/Admin
const SCRIPTS_DIR = path.join(ADMIN_ROOT, "Scripts");
const PYTHON = process.env.PYTHON || "python3"; // or "python"

// script paths (adjust if you moved files)
const WS_DOWNLOAD = path.join(SCRIPTS_DIR, "wsdownload.py");
const WS_DOWNLOAD_ENG = path.join(SCRIPTS_DIR, "WSDownload", "wsDownloadEng.py");
const WS_DOWNLOAD_JP = path.join(SCRIPTS_DIR, "WSDownload", "wsDownloadJp.py");
const GENERATE_MANIFEST = path.join(SCRIPTS_DIR, "Manifest", "generateManifest.py");

// where to persist settings
const SETTINGS_PATH = path.join(ADMIN_ROOT, "settings.json");

// Serve UI if built (your distribution folder)
const UI_DIST = path.join(ADMIN_ROOT, "dist");

// ---- utility helpers ----
const clients = new Map(); // jobId -> SSE response
const jobs = new Map();    // jobId -> job object

function makeJobId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sseSend(jobId, eventName, data) {
  const res = clients.get(jobId);
  if (!res || res.writableEnded) return;
  try {
    res.write(`event: ${eventName}\n`);
    const payload = (typeof data === "string") ? data : JSON.stringify(data);
    res.write(`data: ${payload}\n\n`);
  } catch (e) { /* ignore */ }
}

// ---- Helpers ----
function safeReadJson(p) {
  try {
    if (!fs.existsSync(p)) return null;
    const txt = fs.readFileSync(p, { encoding: "utf8" });
    return JSON.parse(txt);
  } catch (e) {
    return null;
  }
}

function safeWriteJson(p, obj) {
  try {
    fs.writeFileSync(p, JSON.stringify(obj, null, 2), { encoding: "utf8" });
    return true;
  } catch (e) {
    console.error("safeWriteJson error", e);
    return false;
  }
}

// Replace the existing getRepoStatusPath() with this improved version
function getRepoStatusPath() {
  // Candidate locations (ordered by preference).
  // ADMIN_ROOT is Downloader/Admin (per your index.js config).
  const candidates = [
    // Admin/status.json (your screenshot shows status.json here)
    path.join(ADMIN_ROOT, "status.json"),
    // ../status.json  -> Downloader/status.json (older assumptions)
    path.join(ADMIN_ROOT, "..", "status.json"),
    // ../Downloaded/status.json (possible alternate)
    path.join(ADMIN_ROOT, "..", "Downloaded", "status.json"),
    // ../../status.json (rare, but safe to check)
    path.join(ADMIN_ROOT, "..", "..", "status.json"),
  ];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        // return the first existing, canonical repo status path
        return p;
      }
    } catch (e) {
      // ignore filesystem errors for a candidate and continue
    }
  }
  return null;
}


// Provide a canonical /status.json route that mirrors /api/status-file (repo-authoritative)
// NOTE: This route must be defined BEFORE static serving so it cannot be shadowed by a
// build-time dist/status.json file inadvertently baked into the UI.
app.get("/status.json", (req, res) => {
  try {
    const statusPath = getRepoStatusPath();
    if (!statusPath) {
      return res.status(404).json({ error: "status file not found in repo Downloader folder" });
    }
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.sendFile(statusPath);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// Start job endpoint
app.post("/api/download", (req, res) => {
  try {
    const { type, outDir } = req.body || {};
    if (!type) return res.status(400).json({ error: "missing 'type' in body" });

    let scriptPath;
    const t = String(type).toLowerCase();
    if (t === "eng") scriptPath = WS_DOWNLOAD_ENG;
    else if (t === "jp") scriptPath = WS_DOWNLOAD_JP;
    else if (t === "both") scriptPath = WS_DOWNLOAD;
    else if (t === "manifest") scriptPath = GENERATE_MANIFEST;
    else return res.status(400).json({ error: "unknown type" });

    // verify script exists
    if (!fs.existsSync(scriptPath)) {
      return res.status(500).json({ error: `script not found: ${scriptPath}` });
    }

    // create job object and store early so cancel may be called
    const jobId = makeJobId();
    const normalizedType = String(type).toUpperCase();
    const job = { jobId, type: normalizedType, state: "queued", percent: 0, logs: [], child: null };
    jobs.set(jobId, job);

    // respond immediately with job metadata
    res.status(202).json({ jobId, progressUrl: `/api/progress/${jobId}` });

    // prepare spawn args — run python in unbuffered mode to avoid stdout buffering
    const spawnArgs = ["-u", scriptPath];
    if (outDir) spawnArgs.push("--out-dir", outDir);

    // ensure PYTHONUNBUFFERED=1 in env as extra guarantee
    const childEnv = { ...process.env, PYTHONUNBUFFERED: "1", OUT_DIR: outDir || process.env.OUT_DIR || "" };

    const child = spawn(PYTHON, spawnArgs, {
      cwd: SCRIPTS_DIR,
      env: childEnv,
      windowsHide: true
    });

    // attach child to job so we can cancel later
    job.child = child;
    job.state = "running";
    job.logs.push({ level: "info", text: `spawned ${scriptPath}` });
    console.log(`[job ${jobId}] spawned ${scriptPath} (PID: ${child.pid || "n/a"})`);
    // notify any listeners about the new job immediately
    sseSend(jobId, "info", { state: job.state, percent: job.percent, jobId });

    // line handling helper
    function handleLine(line) {
      if (!line) return;
      line = String(line).replace(/\r?\n$/, "");
      console.log(`[job ${jobId}] ${line}`);

      const progMatch = line.match(/^PROGRESS: ?(\d{1,3})/i);
      if (progMatch) {
        const pct = Math.min(100, Math.max(0, Number(progMatch[1])));
        job.percent = pct;
        job.logs.push({ level: "progress", text: line });
        sseSend(jobId, "progress", { percent: pct });
        return;
      }

      // handle other structured lines optionally (e.g., "done " prefix)
      job.logs.push({ level: "log", text: line });
      sseSend(jobId, "log", line);
    }

    // stream stdout
    let stdoutBuf = "";
    if (child.stdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdoutBuf += chunk;
        const parts = stdoutBuf.split(/\r?\n/);
        stdoutBuf = parts.pop();
        for (const p of parts) handleLine(p);
      });
      child.stdout.on("end", () => { if (stdoutBuf) { handleLine(stdoutBuf); stdoutBuf = ""; } });
    }

    // stream stderr
    let stderrBuf = "";
    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderrBuf += chunk;
        const parts = stderrBuf.split(/\r?\n/);
        stderrBuf = parts.pop();
        for (const p of parts) handleLine(p);
      });
      child.stderr.on("end", () => { if (stderrBuf) { handleLine(stderrBuf); stderrBuf = ""; } });
    }

    child.on("error", (err) => {
      job.state = "failed";
      const msg = `spawn error: ${String(err)}`;
      job.logs.push({ level: "error", text: msg });
      console.error(`[job ${jobId}] ${msg}`);
      sseSend(jobId, "done", { code: 1, error: String(err) });
    });

    child.on("close", (code, signal) => {
      // if a cancel was requested, we may see non-zero code or signal
      const prevState = job.state;
      job.state = (code === 0 && (!signal)) ? "done" : (job.state === "cancelled" ? "cancelled" : "failed");
      job.percent = 100;
      job.logs.push({ level: "info", text: `exited ${code}${signal ? ` signal=${signal}` : ""}` });
      console.log(`[job ${jobId}] exited ${code} ${signal || ""}`);
      sseSend(jobId, "done", { code, signal });
      // close SSE connection if present
      const resConn = clients.get(jobId);
      if (resConn) {
        try { resConn.end(); } catch (e) { /* ignore */ }
        clients.delete(jobId);
      }
      // cleanup
      try { job.child = null; } catch (e) { }
    });

  } catch (err) {
    console.error("failed to spawn job", err);
    res.status(500).json({ error: String(err) });
  }
});

// Cancel a running job gracefully
app.post("/api/cancel/:jobId", (req, res) => {
  const { jobId } = req.params;
  const j = jobs.get(jobId);
  if (!j) return res.status(404).json({ ok: false, error: "job not found" });
  if (!j.child) return res.status(400).json({ ok: false, error: "no process to cancel" });

  try {
    // attempt graceful termination first
    try {
      j.child.kill("SIGTERM");
      j.logs.push({ level: "info", text: "cancel requested (SIGTERM sent)" });
    } catch (e) {
      // if kill throws, still attempt force below
      j.logs.push({ level: "error", text: `cancel request failed: ${String(e)}` });
    }

    // after short delay, force-kill if still running
    setTimeout(() => {
      try {
        // if process still exists and hasn't exited, send SIGKILL
        if (j.child && !j.child.killed) {
          try {
            j.child.kill("SIGKILL");
            j.logs.push({ level: "info", text: "cancel forced (SIGKILL sent)" });
          } catch (e) {
            j.logs.push({ level: "error", text: `force-kill failed: ${String(e)}` });
          }
        }
      } catch (e) {
        // ignore
      }
    }, 4000);

    j.state = "cancelled";
    sseSend(jobId, "log", `[server] cancel requested for ${jobId}`);
    sseSend(jobId, "done", { code: 254, reason: "cancel_requested" });
    return res.json({ ok: true, jobId });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// SSE endpoint
app.get("/api/progress/:jobId", (req, res) => {
  const { jobId } = req.params;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders && res.flushHeaders();

  clients.set(jobId, res);

  const j = jobs.get(jobId);
  if (j) {
    // send initial info object
    sseSend(jobId, "info", { state: j.state, percent: j.percent, jobId: j.jobId });
  } else {
    sseSend(jobId, "info", { state: "unknown", percent: 0, jobId });
  }

  const keepAlive = setInterval(() => {
    try { res.write(": keepalive\n\n"); } catch (e) { /* ignore */ }
  }, 20000);

  req.on("close", () => {
    clearInterval(keepAlive);
    clients.delete(jobId);
  });
});

// Status endpoint (polled by some clients)
app.get("/api/download/status", (req, res) => {
  const { jobId, db } = req.query;

  // If a specific jobId is requested, return full job including logs
  if (jobId) {
    const j = jobs.get(String(jobId));
    if (!j) return res.status(404).json({ error: "job not found" });
    // don't attempt to serialize child property
    const copy = { ...j, child: undefined };
    return res.json(copy);
  }

  // If a "db" token is requested (ENG/JP), return a lightweight summary
  if (db) {
    const t = String(db).toUpperCase();

    // Look for the most recent matching job
    const match = Array.from(jobs.values()).reverse().find(j => j.type && String(j.type).toUpperCase().includes(t));
    if (!match) return res.status(404).json({ error: "no recent job for that db" });

    const LOG_PREVIEW_COUNT = 0; // keep small; SSE is main log path
    const summary = {
      jobId: match.jobId,
      type: match.type,
      state: match.state,
      percent: match.percent,
      ...(LOG_PREVIEW_COUNT > 0 ? { logs: (match.logs || []).slice(-LOG_PREVIEW_COUNT) } : {})
    };

    return res.json(summary);
  }

  // Default: return all jobs (admin)
  const out = Array.from(jobs.values()).map(j => ({ ...j, child: undefined }));
  return res.json({ jobs: out });
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

// serve the status.json file written by Python (if present)
// keep this for compatibility with clients that call /api/status-file
app.get("/api/status-file", (req, res) => {
  try {
    const statusPath = getRepoStatusPath();
    if (!statusPath) {
      return res.status(404).json({ error: "status file not found in repo Downloader folder" });
    }

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.sendFile(statusPath);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// Settings endpoints to persist simple UI preferences
app.get("/api/settings", (req, res) => {
  try {
    const s = safeReadJson(SETTINGS_PATH) || {};
    return res.json(s);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

app.post("/api/settings", (req, res) => {
  try {
    const json = req.body || {};
    safeWriteJson(SETTINGS_PATH, json);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// fallback to serving frontend index.html for SPA routes
if (fs.existsSync(UI_DIST)) {
  app.use(express.static(UI_DIST));
  app.get("/", (req, res) => res.sendFile(path.join(UI_DIST, "index.html")));
}

app.use((req, res) => {
  if (fs.existsSync(UI_DIST)) {
    return res.sendFile(path.join(UI_DIST, "index.html"));
  }
  res.status(404).send("Not found");
});

const PORT = process.env.PORT || 5174;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Admin API & UI server listening on http://0.0.0.0:${PORT}`);
});
