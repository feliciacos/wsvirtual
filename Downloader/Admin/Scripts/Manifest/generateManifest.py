#!/usr/bin/env python3
# generateManifest.py
from __future__ import annotations
import json, os, sys, re
from pathlib import Path

# robust import of admin utilities
HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent
sys.path.insert(0, str(SCRIPTS / "WSDownload"))
sys.path.insert(0, str(SCRIPTS))
try:
    from WSDownload.adminUtils import parse_common_args, get_out_dir, log, report_progress
except Exception:
    try:
        from WSDownload.adminUtils import parse_common_args, get_out_dir, log, report_progress
    except Exception:
        def parse_common_args():
            import argparse
            return argparse.Namespace(out_dir=None), None
        def get_out_dir(o):
            return o or str(SCRIPTS / "Downloaded")
        def log(m): print("LOG:", m)
        def report_progress(n): print(f"PROGRESS: {n}")

SET_KEY_RE = re.compile(r'^([A-Z0-9]{1,6})_?([A-Z0-9]{0,6})', re.IGNORECASE)

def iter_json_files(folder: Path):
    if not folder.exists():
        return []
    return sorted(folder.glob("*.json"))

def safe_load_first(fpath: Path):
    try:
        data = json.loads(fpath.read_text(encoding="utf-8"))
        if isinstance(data, list) and data:
            return data[0]
        if isinstance(data, dict):
            vals = list(data.values())
            if vals:
                v0 = vals[0]
                if isinstance(v0, list) and v0:
                    return v0[0]
                if isinstance(v0, dict):
                    return v0
        return None
    except Exception as e:
        log(f"failed to load {fpath.name}: {e}")
        return None

def make_set_entry(fpath: Path, lang: str):
    fname = fpath.name
    key = fpath.stem
    name = None
    sample = safe_load_first(fpath)
    if sample and isinstance(sample, dict):
        name = sample.get("expansion") or sample.get("name") or sample.get("set_name") or sample.get("series")
    return {
        "key": key,
        "name": name or key,
        "file": fname,
        "lang": lang
    }

def write_json(path: Path, obj, minify=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    if minify:
        path.write_text(json.dumps(obj, separators=(",", ":")), encoding="utf-8")
    else:
        path.write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding="utf-8")

def main():
    ns, _ = parse_common_args()

    # out_dir is the local place where manifests are placed (scripts/Downloaded by default)
    out_dir = Path(get_out_dir(ns.out_dir))
    out_dir.mkdir(parents=True, exist_ok=True)

    # determine downloads root: prefer explicit env DOWNLOADS_ROOT (e.g. /data), else fallback to out_dir parent
    downloads_root = Path(os.environ.get("DOWNLOADS_ROOT") or out_dir)
    downloads_root = downloads_root.expanduser().resolve()

    # JSON directories inside the mounted DB folders
    eng_json_dir = downloads_root / "DB-ENG" / "Json"
    jp_json_dir  = downloads_root / "DB-JP"  / "Json"

    total_steps = 3
    step = 0

    eng_files = list(iter_json_files(eng_json_dir))
    log(f"Found {len(eng_files)} ENG sets in {eng_json_dir}")
    step += 1
    report_progress(int(step/total_steps*100))

    jp_files = list(iter_json_files(jp_json_dir))
    log(f"Found {len(jp_files)} JP sets in {jp_json_dir}")
    step += 1
    report_progress(int(step/total_steps*100))

    eng_sets = [make_set_entry(p, "EN") for p in eng_files]
    jp_sets  = [make_set_entry(p, "JP") for p in jp_files]

    # Write language manifests into the script's out_dir (for historical compatibility)
    write_json(out_dir / "manifest-eng.json", eng_sets, minify=False)
    write_json(out_dir / "manifest-jp.json", jp_sets, minify=False)

    # Also write a compact sets-manifest.json into the mounted DB folders so front-end expects it at /data/DB-**/sets-manifest.json
    try:
        eng_sets_manifest_path = downloads_root / "DB-ENG" / "sets-manifest.json"
        jp_sets_manifest_path  = downloads_root / "DB-JP"  / "sets-manifest.json"

        write_json(eng_sets_manifest_path, eng_sets, minify=False)
        write_json(jp_sets_manifest_path, jp_sets, minify=False)
        log(f"Wrote {len(eng_sets)} ENG entries and {len(jp_sets)} JP entries to {eng_sets_manifest_path} and {jp_sets_manifest_path}")
    except Exception as e:
        log(f"failed to write sets-manifest into downloads root: {e}")

    step += 1
    report_progress(100)

if __name__ == "__main__":
    main()
