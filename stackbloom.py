"""Start StackBloom: build the viewer if needed, serve it, open the browser.

One command, one process, one port. Requires a C++ toolchain and a Python-enabled
GDB to trace, and Node.js only to build the viewer (never to run it).
Run only code you trust: submitted programs execute on this machine.
"""
import argparse
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
DIST = WEB / "dist"
sys.path.insert(0, str(ROOT / "tracer"))

# Anything here changing means the built viewer is out of date.
SOURCES = ("src", "index.html", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts")


def newest(path):
    if path.is_file():
        return path.stat().st_mtime
    return max((item.stat().st_mtime for item in path.rglob("*") if item.is_file()), default=0)


def stale():
    index = DIST / "index.html"
    if not index.is_file():
        return True
    built = index.stat().st_mtime
    watched = [WEB / name for name in SOURCES] + [ROOT / "trace.schema.json", ROOT / "examples"]
    return any(newest(path) > built for path in watched if path.exists())


def run(command, description):
    print(f"  {description} ...", flush=True)
    result = subprocess.run(command, cwd=WEB)
    if result.returncode:
        raise SystemExit(f"\n{description} failed. Fix the error above and run this again.")


def build():
    npm = shutil.which("npm") or shutil.which("npm.cmd")
    if not npm:
        raise SystemExit(
            "Node.js is needed once to build the viewer, but npm was not found.\n"
            "Install Node.js 22.12+ from https://nodejs.org/ and run this again.\n"
            "The viewer itself runs without Node; only the build step needs it.")
    print("Building the viewer (first run, or sources changed)", flush=True)
    if not (WEB / "node_modules").is_dir():
        run([npm, "ci"], "Installing web dependencies")
    run([npm, "run", "build"], "Building")
    print("  done", flush=True)


# GCC opens its headers through paths like
# <folder>/toolchain/bin/../lib/gcc/x86_64-w64-mingw32/15.2.0/../../../../include/c++/...
# without collapsing the "..", and Windows stops at 260 characters. Measured with
# <bits/stdc++.h>: folders up to 130 characters compile, 140 does not. GCC works out
# its location from Windows as the long path, so an 8.3 short name does not help.
PORTABLE_FOLDER_LIMIT = 130


def portable_path_check():
    """In the portable bundle, refuse a folder too deep for GCC, with a way out."""
    if os.environ.get("STACKBLOOM_PORTABLE") != "1":
        return
    compiler = shutil.which("g++")
    if not compiler:
        raise SystemExit("The bundled compiler is missing. Unzip StackBloom again.")
    folder = os.path.realpath(os.path.join(os.path.dirname(compiler), "..", ".."))
    if len(folder) > PORTABLE_FOLDER_LIMIT:
        raise SystemExit(
            f"This folder is too deep for the C++ compiler: its path is {len(folder)} characters,\n"
            f"and GCC needs {PORTABLE_FOLDER_LIMIT} or fewer.\n\n"
            "Move the StackBloom folder somewhere shorter, for example C:\\StackBloom,\n"
            "and start StackBloom.cmd again.")


def free_port(port):
    with socket.socket() as probe:
        return probe.connect_ex(("127.0.0.1", port)) != 0


def announce(url, delay=0.6):
    """Open the browser once the server is actually accepting connections."""
    def wait():
        for _ in range(50):
            if not free_port(int(url.rsplit(":", 1)[1])):
                webbrowser.open(url)
                return
            time.sleep(delay / 5)
    threading.Thread(target=wait, daemon=True).start()


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=8765, help="port to listen on (default: 8765)")
    parser.add_argument("--no-browser", action="store_true", help="do not open a browser window")
    parser.add_argument("--skip-build", action="store_true", help="use the existing build as-is")
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("port must be between 1024 and 65535")

    if not args.skip_build and stale():
        build()
    if not (DIST / "index.html").is_file():
        raise SystemExit("The viewer is not built. Run again without --skip-build.")
    portable_path_check()
    if not free_port(args.port):
        raise SystemExit(f"Port {args.port} is already in use. Close that program or pass --port.")

    from server import serve  # Imported here so --help works without the tracer.
    url = f"http://127.0.0.1:{args.port}"
    print(f"\nStackBloom is running at {url}")
    print("Programs you submit are compiled and traced on this machine. Run only code you trust.")
    print("Press Ctrl+C to stop.\n", flush=True)
    if not args.no_browser:
        announce(url)
    serve(args.port)
    print("Stopped.")


if __name__ == "__main__":
    main()
