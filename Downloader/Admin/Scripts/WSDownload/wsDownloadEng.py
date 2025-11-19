#!/usr/bin/env python3
# wrapper: run wsdownload.py with only ENG
import os, sys
from subprocess import Popen

# this file is located at Scripts/WSDownload/
here = os.path.dirname(__file__)                   # .../Scripts/WSDownload
scripts_root = os.path.abspath(os.path.join(here)) # same directory
script = os.path.join(scripts_root, "wsDownload.py")

# If script absent, try different capitalizations
if not os.path.exists(script):
    # fallback attempts inside WSDownload folder
    alt1 = os.path.join(scripts_root, "wsdownload.py")
    alt2 = os.path.join(scripts_root, "WsDownload.py")
    for alt in (alt1, alt2):
        if os.path.exists(alt):
            script = alt
            break
    else:
        print("ERROR: wsDownload.py not found in Scripts/WSDownload - looked at:", script)
        sys.exit(2)

args = [sys.executable, script, "--only", "ENG"] + sys.argv[1:]
proc = Popen(args, cwd=scripts_root, env=os.environ)
proc.wait()
sys.exit(proc.returncode)
