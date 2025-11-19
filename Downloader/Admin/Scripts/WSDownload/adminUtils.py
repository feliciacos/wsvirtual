# adminUtils.py
# helper shim used by admin scripts and to satisfy static analysis
import argparse
from pathlib import Path
import os
import sys
import json
from datetime import datetime
from typing import Optional, Dict, Any

def parse_common_args():
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("--out-dir", default=None)
    ns, _ = ap.parse_known_args()
    return ns, None

def _repo_downloader_root() -> Path:
    """
    Return the repo-mounted Downloader folder (Admin -> Downloader sibling).
    """
    try:
        here = Path(__file__).resolve().parent           # .../Downloader/Admin/Scripts
        downloader_root = here.parent.parent             # .../Downloader
        downloader_root.mkdir(parents=True, exist_ok=True)
        return downloader_root
    except Exception:
        alt = Path.cwd() / "Downloader"
        alt.mkdir(parents=True, exist_ok=True)
        return alt.resolve()

def get_out_dir(o: Optional[str]) -> str:
    """
    Resolve output root. Priority:
      1) explicit CLI --out-dir (o)
      2) repo-mounted Downloader folder (Admin -> Downloader sibling)
    NEVER use environment variables (DOWNLOADS_ROOT / OUT_DIR).
    """
    if o:
        return str(Path(o).expanduser().resolve())
    return str(_repo_downloader_root())

def log(msg: str) -> None:
    # use flush=True to avoid stdout buffering delays
    print("LOG:", msg, flush=True)

def report_progress(n: int) -> None:
    """
    Print PROGRESS: <n> (SSE/Node listener).
    IMPORTANT: do not write status.json from here (avoids generic currentpercent polluting overall).
    The caller should call write_status_file(...) explicitly with language-specific percent_details when needed.
    """
    try:
        pct = int(n)
    except Exception:
        pct = 0
    # ensure immediate flush so Node can parse it
    print(f"PROGRESS: {pct}", flush=True)

# --- Extended status writer ---
# Writes an atomic status.json with structure described in your spec.
def write_status_file(
    percent: Optional[int] = None,
    last_log: Optional[str] = None,
    state: Optional[str] = None,
    job_id: Optional[str] = None,
    totalfiles: Optional[Dict[str, int]] = None,
    percent_details: Optional[Dict[str, Any]] = None
) -> None:
    """
    Atomically write (or update) status.json in the repo Downloader folder only.
    - Does NOT create a top-level 'percent' key.
    - Merges provided data with existing file so keys are preserved.
    - Ensures percent_details and totalfiles keys exist and are numeric.
    - If a language run reaches 100% currentpercent, set that language's missing to 0 and update totalpercentXX.
    """
    try:
        out_dir = Path(get_out_dir(None))
        out_dir.mkdir(parents=True, exist_ok=True)
        status_path = out_dir / "status.json"
        tmp = out_dir / ".status.json.tmp"

        # load existing content if present
        data: Dict[str, Any] = {}
        if status_path.exists():
            try:
                data = json.loads(status_path.read_text(encoding="utf-8"))
            except Exception:
                data = {}

        # ensure structure for totalfiles
        tf = dict(data.get("totalfiles", {"engtotal": 0, "jptotal": 0, "engmissing": 0, "jpmissing": 0}))
        for k in ("engtotal", "jptotal", "engmissing", "jpmissing"):
            try:
                tf[k] = int(tf.get(k, 0) or 0)
            except Exception:
                tf[k] = 0

        # ensure structure for percent_details
        pd = dict(data.get("percent_details", {
            "totalpercent": 0.0,
            "totalpercenteng": 0.0,
            "totalpercentjp": 0.0,
            "currentpercent": 0.0,
            "currentpercenteng": 0.0,
            "currentpercentjp": 0.0
        }))
        for k in ("totalpercent", "totalpercenteng", "totalpercentjp", "currentpercent", "currentpercenteng", "currentpercentjp"):
            try:
                pd[k] = float(pd.get(k, 0.0) or 0.0)
            except Exception:
                pd[k] = 0.0

        # merge incoming totalfiles
        if totalfiles:
            for k in ("engtotal", "jptotal", "engmissing", "jpmissing"):
                if k in totalfiles:
                    try:
                        tf[k] = int(totalfiles[k])
                    except Exception:
                        tf[k] = 0

        # merge incoming percent_details
        if percent_details:
            for k in ("totalpercent", "totalpercenteng", "totalpercentjp", "currentpercent", "currentpercenteng", "currentpercentjp"):
                if k in percent_details:
                    try:
                        pd[k] = float(percent_details[k])
                    except Exception:
                        pd[k] = 0.0

        # legacy percent argument: map to currentpercent (do not write top-level percent)
        if percent is not None:
            try:
                pct = int(percent)
            except Exception:
                pct = 0
            pd["currentpercent"] = float(pct)

        # last_log / state / job_id merge
        if last_log is not None:
            data["lastLog"] = str(last_log)
        if state is not None:
            data["state"] = str(state)
        if job_id is not None:
            data["jobId"] = str(job_id)

        # -----------------------
        # Recompute language-specific and overall percentages
        # -----------------------
        try:
            engtotal = int(tf.get("engtotal", 0) or 0)
            engmissing = int(tf.get("engmissing", 0) or 0)
            jptotal = int(tf.get("jptotal", 0) or 0)
            jpmissing = int(tf.get("jpmissing", 0) or 0)

            eng_completed = max(0, engtotal - engmissing)
            jp_completed = max(0, jptotal - jpmissing)

            # totalpercenteng = fraction of ENG images that are present/completed
            if engtotal > 0:
                pd["totalpercenteng"] = float((eng_completed / engtotal) * 100.0)
            else:
                pd["totalpercenteng"] = 0.0

            # totalpercentjp = fraction of JP images that are present/completed
            if jptotal > 0:
                pd["totalpercentjp"] = float((jp_completed / jptotal) * 100.0)
            else:
                pd["totalpercentjp"] = 0.0

            # overall totalpercent is based on combined totals (ENG + JP)
            overall_total = engtotal + jptotal
            if overall_total > 0:
                pd["totalpercent"] = float(((eng_completed + jp_completed) / overall_total) * 100.0)
            else:
                pd["totalpercent"] = float(pd.get("totalpercent", 0.0))
        except Exception:
            # keep prior values if something goes wrong
            pass

        # If a language run completed (currentpercentXX >= 100), clear its missing & mark totals
        try:
            # ENG run finished
            if pd.get("currentpercenteng", 0.0) >= 99.999:
                if engtotal > 0:
                    tf["engmissing"] = 0
                    pd["totalpercenteng"] = 100.0
                # reset transient current percent for ENG to 0 (done)
                pd["currentpercenteng"] = 0.0

            # JP run finished
            if pd.get("currentpercentjp", 0.0) >= 99.999:
                if jptotal > 0:
                    tf["jpmissing"] = 0
                    pd["totalpercentjp"] = 100.0
                pd["currentpercentjp"] = 0.0

            # BOTH job finished (if caller set generic currentpercent >=100) — set both languages to complete if totals exist
            if pd.get("currentpercent", 0.0) >= 99.999:
                if engtotal > 0:
                    tf["engmissing"] = 0
                    pd["totalpercenteng"] = 100.0
                if jptotal > 0:
                    tf["jpmissing"] = 0
                    pd["totalpercentjp"] = 100.0
                pd["currentpercent"] = 0.0
                pd["currentpercenteng"] = 0.0
                pd["currentpercentjp"] = 0.0
                pd["totalpercent"] = 100.0 if (engtotal + jptotal) > 0 else pd.get("totalpercent", 0.0)
        except Exception:
            pass

        # write merged structure back (do NOT write a top-level 'percent' key)
        data["totalfiles"] = tf
        data["percent_details"] = pd
        data["timestamp"] = datetime.utcnow().isoformat() + "Z"

        # atomic write
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(status_path)
    except Exception:
        # best-effort: do not raise from status writer
        return

def print_result(msg: str, color: str = "", end: str = "\n") -> None:
    # original behaviour: log friendly message to stdout (flush to avoid buffering)
    log(msg)
    # also write last log line and set state to running
    try:
        write_status_file(last_log=msg, state="running")
    except Exception:
        pass

def fatal(msg: str, code: int = 1):
    # ensure immediate reporting and status write
    print("FATAL:", msg, flush=True)
    try:
        write_status_file(last_log=str(msg), state="failed")
    except Exception:
        pass
    sys.exit(code)
