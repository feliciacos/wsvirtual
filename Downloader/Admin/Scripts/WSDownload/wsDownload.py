#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# wsdownload.py — full downloader with --out-dir, --only, and progress reporting

from __future__ import annotations
import argparse
import hashlib
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import subprocess
from pathlib import Path
from typing import Dict, List, Tuple, Set, Optional
from urllib.parse import urlsplit, urlunsplit

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# --- robust admin utils import (try common locations) ---
HERE = Path(__file__).resolve().parent           # .../Downloader/Admin/Scripts/WSDownload
PARENT = HERE.parent                             # .../Downloader/Admin/Scripts
GRANDPARENT = PARENT.parent                      # .../Downloader/Admin

# Try several import locations so IDE/runtime can find adminUtils/admin_utils
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(PARENT))
sys.path.insert(0, str(GRANDPARENT))

try:
    # Preferred: adminUtils.py in Scripts folder (your server uses adminUtils naming)
    from adminUtils import parse_common_args, get_out_dir, log, report_progress, fatal, write_status_file
except Exception:
    try:
        # alternate: WSDownload/adminUtils.py
        from WSDownload.adminUtils import parse_common_args, get_out_dir, log, report_progress, fatal, write_status_file
    except Exception:
        try:
            # alternate underscore variant
            from admin_utils import parse_common_args, get_out_dir, log, report_progress, fatal, write_status_file  # type: ignore
        except Exception:
            # fallback shim so script still runs standalone
            def parse_common_args():
                return argparse.Namespace(out_dir=None), None
            def get_out_dir(o):
                return o or str(GRANDPARENT / "Downloaded")
            def log(s): print("LOG:", s)
            def report_progress(n):
                # print both friendly log and explicit PROGRESS marker
                print(f"PROGRESS: {int(n)}")
            def fatal(msg, code=1):
                print("FATAL:", msg)
                sys.exit(code)
            def write_status_file(*a, **k):
                # noop fallback so callers can always call it
                return

# -------- Tunables (same as before) --------
DEFAULT_THREADS = 3
DEFAULT_DELAY = 0.5
DEFAULT_TIMEOUT = 20
SKIP_MESSAGE = False

ENG_REPO = "https://github.com/CCondeluci/WeissSchwarz-ENG-DB"
JP_REPO  = "https://github.com/CCondeluci/WeissSchwarz-JP-DB"

# Resolve root: This file is in .../Scripts/WSDownload, so go up to Scripts as ROOT
ROOT = Path(__file__).resolve().parent.parent   # .../Downloader/Admin/Scripts
TEMP_DIR = ROOT / "temp"
ENG_TEMP = TEMP_DIR / "ws-eng"
JP_TEMP  = TEMP_DIR / "ws-jp"

# Default OUT PARENT: go one level up from Scripts into the sibling "Downloaded" folder
DEFAULT_OUT_PARENT = ROOT.parent / "Downloaded"
DEFAULT_DB_ENG_ROOT = DEFAULT_OUT_PARENT / "DB-ENG"
DEFAULT_DB_JP_ROOT  = DEFAULT_OUT_PARENT / "DB-JP"

# Color fallback (we intentionally avoid colorama dependency here)
GREEN = RED = YELL = GREY = CYAN = RESET = ""

def print_section(title: str) -> None:
    log(f"== {title} ==")

def print_result(msg: str, color: str = "", end: str = "\n") -> None:
    log(msg)

# -------- Utilities --------
def md5_file(p: Path) -> str:
    h = hashlib.md5()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

def safe_mkdir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)

def run(cmd: List[str], cwd: Path | None = None) -> Tuple[int, str, str]:
    proc = subprocess.Popen(
        cmd, cwd=str(cwd) if cwd else None,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    )
    out, err = proc.communicate()
    return proc.returncode, out, err

def fresh_clone(repo_url: str, dest: Path) -> None:
    if dest.exists():
        shutil.rmtree(dest)
    safe_mkdir(dest.parent)
    print_result(f"Cloning {repo_url} → {dest}")
    code, out, err = run(["git", "clone", "--depth", "1", repo_url, str(dest)])
    if code != 0:
        print_result(f"Git clone failed: {err.strip()}", RED)
        fatal("git clone failed", 1)

def sync_db_folder(temp_repo: Path, dest_json_root: Path) -> Tuple[int, int, int, Set[str], Set[str]]:
    """
    Copy <temp_repo>/DB/*.json -> dest_json_root
    Returns (new, updated, unchanged, new_set_stems, updated_set_stems)
    """
    src = temp_repo / "DB"
    if not src.exists():
        print_result(f"ERROR: {src} not found in cloned repo.", RED)
        return (0, 0, 0, set(), set())

    safe_mkdir(dest_json_root)
    new = updated = unchanged = 0
    new_sets: Set[str] = set()
    upd_sets: Set[str] = set()

    for p in sorted(src.glob("*.json")):
        target = dest_json_root / p.name
        stem = p.stem
        if not target.exists():
            shutil.copy2(p, target)
            new += 1
            new_sets.add(stem)
        else:
            src_hash = md5_file(p)
            dst_hash = md5_file(target)
            if src_hash != dst_hash:
                shutil.copy2(p, target)
                updated += 1
                upd_sets.add(stem)
            else:
                unchanged += 1

    return new, updated, unchanged, new_sets, upd_sets

# -------- URL helpers --------
def alternate_urls(u: str) -> List[str]:
    alts: List[str] = []
    sp = urlsplit(u)
    path = sp.path

    if "/wp/wp-content/images/cardimages/" in path:
        alts.append(urlunsplit(sp._replace(path=path.replace("/wp/wp-content/images/cardimages/",
                                                             "/cardlist/cardimages/"))))
    if "/cardlist/cardimages/" in path:
        alts.append(urlunsplit(sp._replace(path=path.replace("/cardlist/cardimages/",
                                                             "/wp/wp-content/images/cardimages/"))))

    idx = path.lower().find("/cardimages/")
    if idx != -1:
        prefix = path[:idx+len("/cardimages/")]
        suffix = path[idx+len("/cardimages/"):]
        lower_path = prefix + suffix.lower()
        if lower_path != path:
            alts.append(urlunsplit(sp._replace(path=lower_path)))

    # dedupe preserving order
    seen = set()
    uniq: List[str] = []
    for a in alts:
        if a not in seen:
            uniq.append(a); seen.add(a)
    return uniq

def try_autorun_manifest():
    """
    Look for Admin/settings.json and, if autoManifest is true, spawn generateManifest.py.
    Pass DOWNLOADS_ROOT or OUT_DIR into the manifest's environment so it finds the DBs in Docker.
    """
    try:
        this_file = Path(__file__).resolve()
        ws_dir = this_file.parent            # .../Scripts/WSDownload
        scripts_dir = ws_dir.parent          # .../Scripts
        admin_root = scripts_dir.parent      # .../Admin
        settings_path = admin_root / "settings.json"

        auto_manifest = False
        if settings_path.exists():
            try:
                s = json.loads(settings_path.read_text(encoding="utf-8"))
                auto_manifest = bool(s.get("autoManifest", False))
            except Exception:
                auto_manifest = False

        if not auto_manifest:
            return

        # prefer explicit DOWNLOADS_ROOT env variable (set in docker compose), else try admin_root/Downloaded
        downloads_root = os.environ.get("DOWNLOADS_ROOT") or os.environ.get("OUT_DIR") or str(admin_root / "Downloaded")

        manifest_script = scripts_dir / "Manifest" / "generateManifest.py"
        if not manifest_script.exists():
            print(f"[auto-manifest] manifest script not found at {manifest_script}")
            return

        python_bin = sys.executable or "python3"
        child_env = dict(os.environ)
        # tell the manifest generator where the DBs are mounted
        child_env["DOWNLOADS_ROOT"] = downloads_root
        child_env["OUT_DIR"] = os.environ.get("OUT_DIR", "")  # preserve existing if present

        # spawn detached so manifest runs independently
        try:
            p = subprocess.Popen([python_bin, "-u", str(manifest_script)],
                                 cwd=str(manifest_script.parent),
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 env=child_env)
            print(f"[auto-manifest] spawned {manifest_script} (PID: {p.pid})")
        except Exception as e:
            print(f"[auto-manifest] failed to spawn manifest: {e}")

    except Exception as e:
        print(f"[auto-manifest] unexpected error: {e}")
    """
    Look for Admin/settings.json (Admin/settings.json relative to Scripts folder)
    and, if autoManifest is true, spawn the generateManifest.py script.
    """
    try:
        # Derive Admin root from this WSDownload file location:
        # wsDownload.py is in Scripts/WSDownload/, so go up three levels to Admin:
        this_file = Path(__file__).resolve()
        ws_dir = this_file.parent            # .../Scripts/WSDownload
        scripts_dir = ws_dir.parent          # .../Scripts
        admin_root = scripts_dir.parent      # .../Admin
        settings_path = admin_root / "settings.json"

        auto_manifest = False
        if settings_path.exists():
            try:
                s = json.loads(settings_path.read_text(encoding="utf-8"))
                auto_manifest = bool(s.get("autoManifest", False))
            except Exception:
                # fallback to false on parse error
                auto_manifest = False

        if not auto_manifest:
            # nothing to do
            return

        # locate generateManifest.py
        manifest_script = scripts_dir / "Manifest" / "generateManifest.py"
        if not manifest_script.exists():
            # log if you have a logging function; otherwise print
            try:
                print(f"[auto-manifest] manifest script not found at {manifest_script}")
            except Exception:
                pass
            return

        # spawn python to run the generator (non-blocking)
        try:
            python_bin = sys.executable or "python3"
            # -u to ensure unbuffered python output
            p = subprocess.Popen([python_bin, "-u", str(manifest_script)], cwd=str(manifest_script.parent),
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=dict(**os.environ, PYTHONUNBUFFERED="1"))
            # optional: print the PID to the logs
            try:
                print(f"[auto-manifest] spawned {manifest_script} (PID: {p.pid})")
            except Exception:
                pass
            # don't wait — let it run; you can optionally read its stdout in background or detach
        except Exception as e:
            try:
                print(f"[auto-manifest] failed to spawn manifest: {e}")
            except Exception:
                pass

    except Exception as e:
        try:
            print(f"[auto-manifest] unexpected error: {e}")
        except Exception:
            pass
        
# -------- Extraction helpers --------
URL_RE = re.compile(r'https?://[^\s"\']+', re.IGNORECASE)
IMG_EXT_RE = re.compile(r'\.(?:jpg|jpeg|png)(?:\?.*)?$', re.IGNORECASE)
CODE_RE = re.compile(r'(?i)\b([A-Z0-9]{1,6})/([A-Z0-9]{1,4})-([A-Z0-9]{1,5})\b')

def ext_from_url(u: str) -> str:
    path = urlsplit(u).path.lower()
    if path.endswith(".jpeg"):
        return ".jpeg"
    if path.endswith(".jpg"):
        return ".jpg"
    if path.endswith(".png"):
        return ".png"
    m = IMG_EXT_RE.search(path)
    if m:
        ext = m.group(0)
        q = ext.find("?")
        return ext[:q] if q != -1 else ext
    return ".png"

def find_image_url_in_card(card: dict) -> Optional[str]:
    for k in ("image", "Image", "img", "Img", "imageUrl", "ImageUrl", "imageURL", "ImageURL"):
        v = card.get(k)
        if isinstance(v, str) and (IMG_EXT_RE.search(v.lower()) or "/cardimages/" in v):
            return v
    for v in card.values():
        if isinstance(v, str) and (IMG_EXT_RE.search(v.lower()) or "/cardimages/" in v):
            if v.startswith("http://") or v.startswith("https://"):
                return v
    return None

def find_code_in_card(card: dict, key_hint: Optional[str]=None) -> Optional[str]:
    if key_hint and isinstance(key_hint, str):
        m = CODE_RE.search(key_hint)
        if m:
            return f"{m.group(1).upper()}/{m.group(2).upper()}-{m.group(3).upper()}"
    for k in ("code", "CardCode", "cardCode", "id", "ID", "number", "Number"):
        v = card.get(k)
        if isinstance(v, str):
            m = CODE_RE.search(v)
            if m:
                return f"{m.group(1).upper()}/{m.group(2).upper()}-{m.group(3).upper()}"
    for v in card.values():
        if isinstance(v, str):
            m = CODE_RE.search(v)
            if m:
                return f"{m.group(1).upper()}/{m.group(2).upper()}-{m.group(3).upper()}"
    return None

def canonical_set_key_from_json_first_code(json_path: Path, fallback_stem: str) -> str:
    try:
        with json_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        def walk_first_code(node) -> Optional[str]:
            if isinstance(node, dict):
                for k in ("code", "CardCode", "cardCode", "id", "ID", "number", "Number"):
                    v = node.get(k)
                    if isinstance(v, str):
                        m = CODE_RE.search(v)
                        if m:
                            return f"{m.group(1).upper()}_{m.group(2).upper()}"
                for v in node.values():
                    got = walk_first_code(v)
                    if got: return got
            elif isinstance(node, list):
                for v in node:
                    got = walk_first_code(v)
                    if got: return got
            elif isinstance(node, str):
                m = CODE_RE.search(node)
                if m:
                    return f"{m.group(1).upper()}_{m.group(2).upper()}"
            return None
        got = walk_first_code(data)
        if got: return got
    except Exception:
        pass
    try:
        text = json_path.read_text(encoding="utf-8", errors="ignore")
        m = CODE_RE.search(text)
        if m:
            return f"{m.group(1).upper()}_{m.group(2).upper()}"
    except Exception:
        pass
    return fallback_stem

def extract_pairs_from_json(json_path: Path) -> List[Tuple[str, str]]:
    pairs: List[Tuple[str, str]] = []

    def push(card: dict, key_hint: Optional[str]=None):
        code = find_code_in_card(card, key_hint)
        if not code:
            return
        m = CODE_RE.search(code)
        if not m:
            return
        sid = m.group(3).upper()
        url = find_image_url_in_card(card)
        if not url:
            return
        pairs.append((sid, url))

    try:
        with json_path.open("r", encoding="utf-8") as f:
            data = json.load(f)

        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict):
                    push(item)
        elif isinstance(data, dict):
            for k, v in data.items():
                if isinstance(v, dict):
                    push(v, key_hint=k)
                elif isinstance(v, list):
                    for it in v:
                        if isinstance(it, dict):
                            push(it)
    except Exception:
        pass

    return pairs

def harvest_pairs_by_set(json_root: Path) -> Tuple[Dict[str, List[Tuple[str, str]]], Dict[str, str]]:
    mapping: Dict[str, List[Tuple[str, str]]] = {}
    stem_to_canon: Dict[str, str] = {}
    json_files = sorted(json_root.glob("*.json"))
    for jf in json_files:
        stem = jf.stem
        canon = canonical_set_key_from_json_first_code(jf, stem)
        stem_to_canon[stem] = canon
        pairs = extract_pairs_from_json(jf)
        if pairs:
            mapping.setdefault(canon, []).extend(pairs)
    return mapping, stem_to_canon

# -------- Downloading (with progress) --------
def build_session(timeout: int) -> requests.Session:
    sess = requests.Session()
    retry = Retry(
        total=3,
        backoff_factor=0.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET"]),
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=100, pool_maxsize=100)
    sess.mount("http://", adapter)
    sess.mount("https://", adapter)
    sess.headers.update({
        "User-Agent": ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"),
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Connection": "keep-alive",
    })
    orig = sess.request
    def with_timeout(method, url, **kw):
        if "timeout" not in kw:
            kw["timeout"] = timeout
        headers = kw.setdefault("headers", {})
        if "Referer" not in headers:
            host = urlsplit(url).netloc
            headers["Referer"] = f"https://{host}/"
        return orig(method, url, **kw)
    sess.request = with_timeout  # type: ignore
    return sess

def plan_downloads(mapping: Dict[str, List[Tuple[str, str]]], dest_root: Path, force_sets: Set[str]) -> List[Tuple[str, Path]]:
    plan: List[Tuple[str, Path]] = []
    for set_key, pairs in mapping.items():
        force = set_key in force_sets
        for sid, url in pairs:
            fname = f"{sid}{ext_from_url(url)}"
            out_path = dest_root / set_key / fname
            if out_path.exists() and not force:
                if SKIP_MESSAGE:
                    print_result(f"skip  {out_path}", GREY)
                else:
                    # skip quietly
                    time.sleep(0)
            else:
                plan.append((url, out_path))
    return plan

def download_worker(work_q: "queue.Queue[Tuple[str, Path]]", delay: float, session: requests.Session, lock: threading.Lock, progress_state: dict):
    while True:
        try:
            url, out_path = work_q.get_nowait()
        except queue.Empty:
            return

        performed_request = False
        try:
            out_path.parent.mkdir(parents=True, exist_ok=True)

            tried = [url] + alternate_urls(url)
            success = False
            last_status = None

            for candidate in tried:
                r = session.get(candidate, stream=True)
                performed_request = True
                last_status = r.status_code
                if r.status_code == 200:
                    tmp = out_path.with_suffix(out_path.suffix + ".part")
                    with tmp.open("wb") as f:
                        for chunk in r.iter_content(1024 * 64):
                            if chunk:
                                f.write(chunk)
                    tmp.replace(out_path)
                    with lock:
                        print_result(f"done  {out_path}", GREEN)
                        # update progress
                        progress_state["done"] += 1
                        total = progress_state.get("total", 0) or 1
                        pct = int(progress_state["done"] / total * 100) if total else 100
                        # emit PROGRESS line for external listeners
                        report_progress(pct)
                        print(f"PROGRESS: {pct}")
                    try:
                        # prepare percent_details for status.json
                        total = progress_state.get("total", 0) or 1
                        done = progress_state.get("done", 0)
                        # current job percent (0..100)
                        cur_pct = int(done / total * 100) if total else 100

                        # Use out_path to decide ENG vs JP (no undefined dest_root)
                        out_path_str = str(out_path).lower()
                        is_eng = "/db-eng/" in out_path_str or "\\db-eng\\" in out_path_str or "db-eng" in out_path_str
                        is_jp  = "/db-jp/" in out_path_str or "\\db-jp\\" in out_path_str or "db-jp" in out_path_str

                        # Set only the language-specific currentpercent field to avoid overwriting overall
                        pd = {}
                        if is_eng and not is_jp:
                            pd["currentpercenteng"] = float(cur_pct)
                        elif is_jp and not is_eng:
                            pd["currentpercentjp"] = float(cur_pct)
                        else:
                            # ambiguous/both -> set generic currentpercent so UI can show combined overlay
                            pd["currentpercent"] = float(cur_pct)

                        # attempt to write status file with latest percent_details and last_log
                        write_status_file(percent_details=pd, last_log=f"done  {out_path}")
                    except Exception:
                        pass

                    success = True
                    break
                if r.status_code != 404:
                    break

            if not success:
                with lock:
                    if last_status == 404:
                        print_result(f"warn  {url} → HTTP 404 (not found)", YELL)
                    else:
                        print_result(f"warn  {url} → HTTP {last_status}", YELL)
                    progress_state["done"] += 1
                    total = progress_state.get("total", 0) or 1
                    pct = int(progress_state["done"] / total * 100) if total else 100
                    report_progress(pct)
                    print(f"PROGRESS: {pct}")

        except Exception as e:
            with lock:
                print_result(f"error {url} → {e}", RED)
                progress_state["done"] += 1
                total = progress_state.get("total", 0) or 1
                pct = int(progress_state["done"] / total * 100) if total else 100
                report_progress(pct)
                print(f"PROGRESS: {pct}")
        finally:
            if performed_request and delay > 0:
                time.sleep(delay)
            work_q.task_done()

def execute_download_plan(plan: List[Tuple[str, Path]], threads: int, delay: float, timeout: int):
    if not plan:
        log("Nothing to download.")
        report_progress(100)
        print("PROGRESS: 100")
        return
    sess = build_session(timeout)
    work_q: "queue.Queue[Tuple[str, Path]]" = queue.Queue()
    lock = threading.Lock()

    for item in plan:
        work_q.put(item)

    progress_state = {"done": 0, "total": len(plan)}
    report_progress(0)
    print("PROGRESS: 0")

    workers = []
    for _ in range(max(1, threads)):
        t = threading.Thread(target=download_worker, args=(work_q, delay, sess, lock, progress_state), daemon=True)
        t.start()
        workers.append(t)

    work_q.join()
    # ensure 100% at finish
    report_progress(100)
    print("PROGRESS: 100")
    log(f"downloaded {progress_state['done']} / {progress_state['total']} files")

def download_images_by_set(mapping: Dict[str, List[Tuple[str, str]]], dest_root: Path, force_sets: Set[str], threads: int, delay: float, timeout: int, lang: Optional[str] = None):
    """
    Download images described by `mapping` into `dest_root`.
    - mapping: {canonical_set_key: [(sid, url), ...], ...}
    - dest_root: destination root path for images (e.g. /.../DB-ENG/Images)
    - force_sets: set of canonical set keys to force redownload
    - threads, delay, timeout: download worker params
    - lang: Optional "ENG" or "JP" to indicate which language this run is for (used to set proper totalfiles keys)
    Side effects:
    - Writes/merges status.json via write_status_file to publish totals and progress.
    - Emits PROGRESS: <n> lines via report_progress as the workers make progress.
    """
    total = sum(len(v) for v in mapping.values())

    print_section(f"Planning {total} images → {dest_root}")
    plan = plan_downloads(mapping, dest_root, force_sets)

    planned_count = len(plan)
    try:
        # Prepare canonical, complete structures for merging into status.json.
        status_path = Path(get_out_dir(None)) / "status.json"
        merged_totalfiles = {"engtotal": 0, "jptotal": 0, "engmissing": 0, "jpmissing": 0}
        merged_pd = {
            "totalpercent": 0.0,
            "totalpercenteng": 0.0,
            "totalpercentjp": 0.0,
            "currentpercent": 0.0,
            "currentpercenteng": 0.0,
            "currentpercentjp": 0.0
        }

        # If an existing status.json is present, load its keys safely into merged structures.
        if status_path.exists():
            try:
                existing = json.loads(status_path.read_text(encoding="utf-8"))
            except Exception:
                existing = {}

            existing_tf = existing.get("totalfiles", {})
            for k in ("engtotal", "jptotal", "engmissing", "jpmissing"):
                try:
                    merged_totalfiles[k] = int(existing_tf.get(k, merged_totalfiles[k]) or merged_totalfiles[k])
                except Exception:
                    merged_totalfiles[k] = merged_totalfiles[k]

            existing_pd = existing.get("percent_details", {})
            for k in ("totalpercent", "totalpercenteng", "totalpercentjp", "currentpercent", "currentpercenteng", "currentpercentjp"):
                try:
                    merged_pd[k] = float(existing_pd.get(k, merged_pd[k]) or merged_pd[k])
                except Exception:
                    merged_pd[k] = merged_pd[k]

        # Compute the current run's totalfiles fragment (we only set the language-specific totals here)
        cur_totalfiles: Dict[str, int] = {}
        dest_str = str(dest_root).lower()
        # Best-effort detection: if dest_root looks like ENG or JP, fill that language's total
        if lang == "ENG" or "db-eng" in dest_str:
            cur_totalfiles["engtotal"] = total
            cur_totalfiles["engmissing"] = planned_count
        if lang == "JP" or "db-jp" in dest_str:
            cur_totalfiles["jptotal"] = total
            cur_totalfiles["jpmissing"] = planned_count
        # If neither, try to be conservative: if mapping non-empty, guess via lang param only
        if not cur_totalfiles and lang:
            if lang.upper() == "ENG":
                cur_totalfiles["engtotal"] = total
                cur_totalfiles["engmissing"] = planned_count
            elif lang.upper() == "JP":
                cur_totalfiles["jptotal"] = total
                cur_totalfiles["jpmissing"] = planned_count

        # Prepare a language-scoped percent_details update for the "current" run overlay
        pd_update = {
            "currentpercent": 0.0,
            "currentpercenteng": 0.0,
            "currentpercentjp": 0.0
        }

        # Merge the runtime fragments with the merged structures so we write a complete status.json
        merged_totalfiles.update(cur_totalfiles)
        merged_pd.update(pd_update)

        # If there are zero planned items for this run, ensure missing counts are zero (no-op run)
        if planned_count == 0:
            if "engmissing" in cur_totalfiles:
                merged_totalfiles["engmissing"] = 0
            if "jpmissing" in cur_totalfiles:
                merged_totalfiles["jpmissing"] = 0

        # Compute best-effort totalpercent values from merged_totalfiles so UI shows meaningful totals
        try:
            et = int(merged_totalfiles.get("engtotal", 0) or 0)
            jt = int(merged_totalfiles.get("jptotal", 0) or 0)
            em = int(merged_totalfiles.get("engmissing", 0) or 0)
            jm = int(merged_totalfiles.get("jpmissing", 0) or 0)

            eng_completed = max(0, et - em)
            jp_completed = max(0, jt - jm)
            overall_total = et + jt
            already_present = eng_completed + jp_completed

            if overall_total > 0:
                merged_pd["totalpercent"] = float((already_present / overall_total) * 100.0)
            else:
                merged_pd["totalpercent"] = float(merged_pd.get("totalpercent", 0.0))

            merged_pd["totalpercenteng"] = float((eng_completed / et) * 100.0) if et > 0 else 0.0
            merged_pd["totalpercentjp"] = float((jp_completed / jt) * 100.0) if jt > 0 else 0.0
        except Exception:
            # keep existing merged_pd values if computation fails
            pass

        # Write the stable, merged status file so the UI sees totals before downloads begin
        write_status_file(totalfiles=merged_totalfiles, percent_details=merged_pd, last_log=f"Planned downloads: {planned_count}")
    except Exception:
        # best-effort: ignore failures to prepare status file
        pass

    print_section(f"Planned downloads: {len(plan)} (others already present)")
    print_section(f"Downloading {len(plan)} images → {dest_root}")
    # perform the actual downloads (this will emit PROGRESS lines and update status.json per-worker)
    execute_download_plan(plan, threads, delay, timeout)

    # After downloads finish for this pass, ensure we mark language completion appropriately.
    try:
        # If this run was ENG-only, mark ENG done; if JP-only, mark JP done; otherwise set generic done.
        if lang == "ENG":
            # set ENG finished: this will be handled by write_status_file (clears engmissing -> 0 and set totalpercenteng=100)
            write_status_file(percent_details={"currentpercenteng": 100.0}, last_log="ENG run complete")
        elif lang == "JP":
            write_status_file(percent_details={"currentpercentjp": 100.0}, last_log="JP run complete")
        else:
            # generic completion: mark generic currentpercent so both languages can be finalized by writer
            write_status_file(percent_details={"currentpercent": 100.0}, last_log="Both run complete")

        # give the writer a moment to finalize totals (it may recompute and clear missing)
        write_status_file(last_log="Finalizing totals")
    except Exception:
        # swallow to avoid failing the whole run
        pass


# ---- orchestration helpers ----
def fetch_repos() -> None:
    """Clone ENG & JP repos into TEMP_DIR."""
    print_section("Fetching repositories")
    fresh_clone(ENG_REPO, ENG_TEMP)
    fresh_clone(JP_REPO, JP_TEMP)

def translate_force_sets(force_stems: Set[str], stem_to_canon: Dict[str, str]) -> Set[str]:
    out: Set[str] = set()
    for s in force_stems:
        out.add(stem_to_canon.get(s, s))
    return out

def sync_all_json(eng_json_root: Path, jp_json_root: Path) -> Tuple[Set[str], Set[str]]:
    print_section(f"ENG: syncing JSON from {ENG_TEMP/'DB'} → {eng_json_root}")
    eng_new, eng_upd, eng_same, eng_new_sets, eng_upd_sets = sync_db_folder(ENG_TEMP, eng_json_root)
    print(f"\nENG sync summary: new={eng_new}, updated={eng_upd}, unchanged={eng_same}")

    print_section(f"JP: syncing JSON from {JP_TEMP/'DB'} → {jp_json_root}")
    jp_new, jp_upd, jp_same, jp_new_sets, jp_upd_sets = sync_db_folder(JP_TEMP, jp_json_root)
    print(f"\nJP sync summary: new={jp_new}, updated={jp_upd}, unchanged={jp_same}")

    eng_force = eng_new_sets | eng_upd_sets
    jp_force  = jp_new_sets  | jp_upd_sets
    return eng_force, jp_force

def harvest_and_download(
    eng_force_stems: Set[str],
    jp_force_stems: Set[str],
    eng_json_root: Path,
    eng_img_root: Path,
    jp_json_root: Path,
    jp_img_root: Path,
    threads: int,
    delay: float,
    timeout: int,
    only: Optional[str] = None
) -> None:
    """
    Harvest both ENG and JP pairs first in order to compute TOTALS for both languages.
    Write an initial status.json with totalfiles and percent_details (best-effort)
    so the UI can render correct baseline percentages before any download starts.
    Then run ENG and/or JP downloads. When a language starts, we only update its
    language-specific currentpercent/currentmissing fields — we do not clobber the other language.
    """

    # Harvest BOTH JSON roots unconditionally so we can present accurate totals
    # to the UI even when the run is limited to one language (only == "ENG" / "JP").
    log("Harvesting (ENG)")
    eng_map, eng_s2c = harvest_pairs_by_set(eng_json_root)

    log("Harvesting (JP)")
    jp_map, jp_s2c = harvest_pairs_by_set(jp_json_root)

    total_eng = sum(len(v) for v in eng_map.values())
    total_jp = sum(len(v) for v in jp_map.values())

    # determine how many are already present (best-effort)
    def count_missing(dest_root: Path, mapping: Dict[str, List[Tuple[str, str]]]):
        missing = 0
        for set_key, pairs in mapping.items():
            for sid, url in pairs:
                fname = f"{sid}{ext_from_url(url)}"
                out_path = dest_root / set_key / fname
                if not out_path.exists():
                    missing += 1
        return missing

    eng_missing = 0 if total_eng == 0 else count_missing(eng_img_root, eng_map)
    jp_missing = 0 if total_jp == 0 else count_missing(jp_img_root, jp_map)

    # write initial status.json containing totals for both languages
    try:
        merged_totalfiles = {"engtotal": total_eng, "jptotal": total_jp, "engmissing": eng_missing, "jpmissing": jp_missing}
        # compute best-effort totalpercent as present / overall
        overall_total = (total_eng or 0) + (total_jp or 0)
        already_present = max(0, (total_eng - eng_missing)) + max(0, (total_jp - jp_missing))
        totalpercent = float((already_present / overall_total) * 100.0) if overall_total else 0.0
        pd = {
            "totalpercent": totalpercent,
            "totalpercenteng": (float(((total_eng - eng_missing) / total_eng) * 100.0) if total_eng else 0.0),
            "totalpercentjp": (float(((total_jp - jp_missing) / total_jp) * 100.0) if total_jp else 0.0),
            "currentpercent": 0.0,
            "currentpercenteng": 0.0,
            "currentpercentjp": 0.0
        }
        write_status_file(totalfiles=merged_totalfiles, percent_details=pd, last_log=f"Planned totals: ENG={total_eng} (missing {eng_missing}), JP={total_jp} (missing {jp_missing})")
    except Exception:
        pass

    # Now run the actual downloads (keep previous logic but use our harvested maps)
    # Only call per-language download when appropriate; harvesting already done above.
    if only is None or only == "ENG":
        print_section("ENG: beginning download pass")
        eng_force_canon = translate_force_sets(eng_force_stems, eng_s2c)
        total_eng_count = sum(len(v) for v in eng_map.values())
        print(f"Found {total_eng_count} image entries in ENG JSON across {len(eng_map)} canonical sets")
        download_images_by_set(eng_map, eng_img_root, eng_force_canon, threads, delay, timeout, lang="ENG")
    else:
        log("Skipping ENG (only=JP)")

    if only is None or only == "JP":
        print_section("JP: beginning download pass")
        jp_force_canon = translate_force_sets(jp_force_stems, jp_s2c)
        total_jp_count = sum(len(v) for v in jp_map.values())
        print(f"Found {total_jp_count} image entries in JP JSON across {len(jp_map)} canonical sets")
        download_images_by_set(jp_map, jp_img_root, jp_force_canon, threads, delay, timeout, lang="JP")
    else:
        log("Skipping JP (only=ENG)")

# ---- CLI parsing ----
def parse_args():
    ap = argparse.ArgumentParser(description="Weiss Schwarz image downloader")
    ap.add_argument("--threads", type=int, default=DEFAULT_THREADS, help="Number of concurrent download threads")
    ap.add_argument("--delay",   type=float, default=DEFAULT_DELAY, help="Delay (seconds) between downloads per thread")
    ap.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help="HTTP timeout per request (seconds)")
    ap.add_argument("--only", choices=["ENG","JP"], default=None, help="Only run ENG or JP section")
    ap.add_argument("--out-dir", default=None, help="Output root for DB-ENG/DB-JP (overrides default locations)")
    return ap.parse_args()

def main():
    args = parse_args()

    # resolve out-root priority:
    # 1) CLI --out-dir
    # 2) env DOWNLOADS_ROOT (preferred)
    # 3) env OUT_DIR (legacy)
    # 4) default Downloaded sibling
    out_root = None
    if args.out_dir:
        out_root = Path(args.out_dir).resolve()
    else:
        env_dr = os.environ.get("DOWNLOADS_ROOT")
        if env_dr:
            out_root = Path(env_dr).resolve()
        else:
            env_out = os.environ.get("OUT_DIR")
            if env_out:
                out_root = Path(env_out).resolve()
    if not out_root:
        out_root = DEFAULT_OUT_PARENT

    # JSON roots and image roots under out_root
    eng_json_root = out_root / "DB-ENG" / "Json"
    eng_img_root  = out_root / "DB-ENG" / "Images"
    jp_json_root  = out_root / "DB-JP"  / "Json"
    jp_img_root   = out_root / "DB-JP"  / "Images"

    print_section("Preparing folders")
    for p in (eng_json_root, eng_img_root, jp_json_root, jp_img_root, TEMP_DIR):
        safe_mkdir(p)

    only = args.only

    # fetch repos & sync JSON
    fetch_repos()
    print_section("Syncing JSON")
    eng_force_stems, jp_force_stems = sync_all_json(eng_json_root, jp_json_root)
    if eng_force_stems:
        print_result(f"ENG force re-download (stems): {', '.join(sorted(eng_force_stems))}", GREY)
    if jp_force_stems:
        print_result(f"JP  force re-download (stems): {', '.join(sorted(jp_force_stems))}", GREY)

    # -----------------------
    # Compute initial totals/missing for BOTH ENG and JP and write a single initial status.json.
    # This ensures the UI sees ENG + JP totals before any language-specific planner runs.
    # -----------------------
    try:
        eng_map_all, _ = harvest_pairs_by_set(eng_json_root)
        jp_map_all, _ = harvest_pairs_by_set(jp_json_root)
        total_eng_all = sum(len(v) for v in eng_map_all.values())
        total_jp_all = sum(len(v) for v in jp_map_all.values())

        def _count_existing_images(p: Path) -> int:
            # best-effort count of image files under the Images folder
            try:
                if not p.exists():
                    return 0
                cnt = 0
                for f in p.rglob("*"):
                    if f.is_file():
                        suf = f.suffix.lower()
                        if suf in (".png", ".jpg", ".jpeg"):
                            cnt += 1
                return cnt
            except Exception:
                return 0

        eng_existing = _count_existing_images(eng_img_root)
        jp_existing = _count_existing_images(jp_img_root)

        eng_missing_initial = max(0, total_eng_all - eng_existing)
        jp_missing_initial = max(0, total_jp_all - jp_existing)

        overall_total_initial = (total_eng_all or 0) + (total_jp_all or 0)
        eng_completed_initial = max(0, total_eng_all - eng_missing_initial)
        jp_completed_initial = max(0, total_jp_all - jp_missing_initial)

        tf_initial = {
            "engtotal": int(total_eng_all),
            "jptotal": int(total_jp_all),
            "engmissing": int(eng_missing_initial),
            "jpmissing": int(jp_missing_initial),
        }

        pd_initial = {
            "currentpercent": 0.0,
            "currentpercenteng": 0.0,
            "currentpercentjp": 0.0,
            "totalpercenteng": float((eng_completed_initial / total_eng_all) * 100.0) if total_eng_all > 0 else 0.0,
            "totalpercentjp": float((jp_completed_initial / total_jp_all) * 100.0) if total_jp_all > 0 else 0.0,
        }
        pd_initial["totalpercent"] = float(((eng_completed_initial + jp_completed_initial) / overall_total_initial) * 100.0) if overall_total_initial > 0 else 0.0

        write_status_file(totalfiles=tf_initial, percent_details=pd_initial, last_log=f"Planned totals: ENG={total_eng_all} (missing {eng_missing_initial}), JP={total_jp_all} (missing {jp_missing_initial})")
    except Exception:
        # best-effort: don't crash the run
        pass

    # run harvesting and downloads
    harvest_and_download(
        eng_force_stems, jp_force_stems,
        eng_json_root, eng_img_root,
        jp_json_root, jp_img_root,
        args.threads, args.delay, args.timeout, only
    )
    # --- auto-manifest trigger ---
    try_autorun_manifest()
    # -----------------------------

    print("\nAll done.")
    report_progress(100)
    print("PROGRESS: 100")

if __name__ == "__main__":
    main()
