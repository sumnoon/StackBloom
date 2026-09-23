"""Build a portable StackBloom for Windows: unzip and run, nothing to install.

Run on a Windows machine that has MSYS2 with the UCRT64 toolchain:

    pacman -S --needed pacman-contrib mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-gdb
    python packaging/windows/build_bundle.py

(pacman-contrib provides pactree, which resolves the dependency closure.) The
result is dist/StackBloom-windows-x64.zip, containing a folder named StackBloom.

The bundle holds the app, the built viewer, and the exact MSYS2 packages that
g++ and gdb depend on (resolved with pactree, listed with pacman), in MSYS2's own
directory layout so gdb finds its Python and the libstdc++ printers the same way
it does on a developer machine. MSYS2's Python, already a gdb dependency, runs
the app too. Files StackBloom never uses are left out: documentation, test
suites, Tcl/Tk, the C and LTO compilers, and static libraries of packages that
are only needed at run time.
"""
import argparse
import fnmatch
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[2]
ROOTS = ("mingw-w64-ucrt-x86_64-gcc", "mingw-w64-ucrt-x86_64-gdb")
PREFIX = "/ucrt64/"

# Whole packages the app never touches: Python's GUI stack and database.
SKIP_PACKAGES = ("tcl", "tk", "sqlite")
# Large packages needed only to *run* gdb and Python, never to compile a C++
# program: their headers and static libraries are dropped. Matched by prefix and
# listed deliberately rather than guessing which packages GCC builds against, so
# a renamed or new package keeps its headers. A wrong guess here costs zip size,
# never a compiler that cannot find <wchar.h> (which happened when MSYS2's
# package names changed between snapshots).
RUNTIME_ONLY = ("python", "openssl", "ncurses", "readline", "termcap", "gettext", "libffi",
                "mpdecimal", "expat", "bzip2", "xz", "libb2", "tzdata")
SKIP_PATTERNS = [
    "share/doc/*", "share/man/*", "share/info/*", "share/locale/*", "share/gtk-doc/*",
    "lib/python3.*/test/*", "lib/python3.*/idlelib/*", "lib/python3.*/tkinter/*",
    "lib/python3.*/turtledemo/*", "lib/python3.*/ensurepip/*", "lib/python3.*/lib2to3/*",
    "lib/python3.*/*/__pycache__/*", "lib/python3.*/__pycache__/*", "lib/python3.*/config-*/*",
    "lib/gcc/*/plugin/*",
    # Only C++ is compiled, and never with -flto.
    "lib/gcc/*/cc1.exe", "lib/gcc/*/lto1.exe", "bin/lto-dump.exe",
]
APP_FILES = ["LICENSE", "stackbloom.py", "tracer/*.py", "tracer/alloc_ledger.cpp", "web/dist/**/*", "examples/*.cpp"]

LAUNCHER = r"""@echo off
rem StackBloom, portable. Only this folder and Windows itself are on PATH, so an
rem unrelated compiler or C++ runtime elsewhere on the machine is never picked up.
setlocal
set "HERE=%~dp0"
set "PATH=%HERE%toolchain\bin;%SystemRoot%\System32;%SystemRoot%;%SystemRoot%\System32\Wbem"
set PYTHONNOUSERSITE=1
set PYTHONDONTWRITEBYTECODE=1
set STACKBLOOM_PORTABLE=1
"%HERE%toolchain\bin\python.exe" "%HERE%app\stackbloom.py" --skip-build %*
if errorlevel 1 pause
"""

README = r"""StackBloom for Windows (portable)
=================================

Double-click StackBloom.cmd. Your browser opens at http://127.0.0.1:8765.
Close the console window, or press Ctrl+C in it, to stop.

Keep this folder at a path of 130 characters or fewer, such as C:\StackBloom
or your Downloads folder: the C++ compiler cannot open its own headers from a
deeper folder, and StackBloom will say so rather than fail on your program.

Nothing is installed and nothing outside this folder is changed. To remove
StackBloom, delete the folder.

Programs you submit are compiled and run on this computer with your
permissions. Run only code you trust: this is not a sandbox.

Options go after the file name when started from a terminal:
  StackBloom.cmd --port 9000     use another port
  StackBloom.cmd --no-browser    do not open a browser window

StackBloom is free software under the GNU GPL, version 3 or later: see
app/LICENSE. Third-party components and their licences: see THIRD_PARTY.md.
"""


def msys(tool, msys2):
    return str(Path(msys2) / "usr" / "bin" / tool)


def run(command, **kwargs):
    return subprocess.run(command, check=True, capture_output=True, text=True, **kwargs).stdout


def closure(msys2):
    """Every package g++ and gdb need at run time, from pacman's own dependency graph."""
    names = set()
    for root in ROOTS:
        names.update(line.strip() for line in run([msys("pactree", msys2), "-u", "-l", root]).splitlines())
    return sorted(name for name in names if name)


def short(package):
    return package.removeprefix("mingw-w64-ucrt-x86_64-")


def wanted(relative, package):
    if any(fnmatch.fnmatch(relative, pattern) for pattern in SKIP_PATTERNS):
        return False
    name = PurePosixPath(relative).name
    if short(package).startswith(RUNTIME_ONLY):
        # Headers and static archives of run-time-only libraries are never linked.
        if relative.startswith("include/") or name.endswith((".a", ".la")) or relative.startswith("lib/pkgconfig/"):
            return False
        if relative.startswith("lib/cmake/"):
            return False
    return True


def files_of(package, msys2):
    for line in run([msys("pacman", msys2), "-Ql", package]).splitlines():
        path = line.split(" ", 1)[1]
        if path.startswith(PREFIX) and not path.endswith("/"):
            yield path[len(PREFIX):]


def copy_toolchain(target, msys2):
    source = Path(msys2) / "ucrt64"
    manifest = {}
    for package in closure(msys2):
        if short(package).startswith(SKIP_PACKAGES):
            continue
        version = run([msys("pacman", msys2), "-Q", package]).split()[1]
        kept = 0
        for relative in files_of(package, msys2):
            if not wanted(relative, package):
                continue
            origin = source / relative
            if not origin.is_file():
                continue
            destination = target / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            # Contents only: MSYS2 marks some files read-only, which would make the
            # unpacked bundle awkward to delete.
            shutil.copyfile(origin, destination)
            kept += 1
        manifest[package] = {"version": version, "files": kept}
    return manifest


def copy_app(target):
    for pattern in APP_FILES:
        for path in ROOT.glob(pattern):
            if path.is_file():
                destination = target / path.relative_to(ROOT)
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, destination)


def third_party(manifest):
    rows = "\n".join(f"| `{name}` | {info['version']} |" for name, info in sorted(manifest.items()))
    return f"""# Third-party components

StackBloom itself is licensed under the GNU GPL, version 3 or later (`app/LICENSE`).

This bundle redistributes unmodified binaries from the [MSYS2](https://www.msys2.org/)
UCRT64 repository. Each package's licence texts are in `toolchain/share/licenses/`.

GCC, binutils and GDB are distributed under the GNU GPL (version 3 or later), with
the GCC Runtime Library Exception for libgcc and libstdc++. The complete
corresponding source for every package below, at exactly these versions, is
published by the MSYS2 project: package recipes at
https://github.com/msys2/MINGW-packages and source archives at
https://repo.msys2.org/mingw/sources/.

| Package | Version |
|---|---|
{rows}
"""


def build_viewer():
    index = ROOT / "web" / "dist" / "index.html"
    sys.path.insert(0, str(ROOT))
    import stackbloom  # The launcher already knows when the build is stale.
    if stackbloom.stale():
        stackbloom.build()
    if not index.is_file():
        raise SystemExit("The viewer did not build; see the output above.")


def smoke_test(bundle):
    """Trace a real program with nothing but the bundle and Windows on PATH."""
    system = os.environ.get("SystemRoot", r"C:\Windows")
    env = {key: value for key, value in os.environ.items() if key.upper() not in ("PATH", "PYTHONPATH", "PYTHONHOME")}
    # Exactly what StackBloom.cmd sets, so the test exercises the portable code paths.
    env.update(PATH=os.pathsep.join([str(bundle / "toolchain" / "bin"), rf"{system}\System32", system]),
               PYTHONNOUSERSITE="1", PYTHONDONTWRITEBYTECODE="1", STACKBLOOM_PORTABLE="1")
    output = bundle / "smoke-trace.json"
    try:
        # trace.py exits nonzero for compile errors too; the trace says why, so read it.
        subprocess.run([str(bundle / "toolchain" / "bin" / "python.exe"), str(bundle / "app" / "tracer" / "trace.py"),
                        str(bundle / "app" / "examples" / "fib.cpp"), "--output", str(output)],
                       env=env, cwd=bundle)
        if not output.is_file():
            raise SystemExit("Smoke test failed: the tracer wrote no trace")
        trace = json.loads(output.read_text(encoding="utf-8"))
    finally:
        output.unlink(missing_ok=True)
    final = trace["snapshots"][-1]
    calls = {frame["call_id"] for stop in trace["snapshots"] for frame in stop["frames"] if frame.get("call_id")}
    if final["event"] != "exit" or final["diagnostic"]["exit_code"] != 0 or len(calls) < 5:
        detail = (final.get("diagnostic") or {}).get("message", "")
        # Where the bundled compiler looks for headers says more than which one it missed.
        probe = subprocess.run([str(bundle / "toolchain" / "bin" / "g++.exe"), "-xc++", "-E", "-v", "-"],
                               input="", capture_output=True, text=True, env=env).stderr
        raise SystemExit(f"Smoke test failed: {final['event']}, {len(calls)} calls\n{detail}\n"
                         f"--- g++ -v ---\n{probe}\n--- wchar.h present: "
                         f"{sorted(str(p.relative_to(bundle)) for p in (bundle / 'toolchain').rglob('wchar.h'))}")
    print(f"  smoke test: fib traced in isolation, {len(trace['snapshots'])} stops, {len(calls)} calls")


def writable_then_retry(function, path, _error):
    """Earlier builds may have left read-only files behind; clear the flag and retry."""
    os.chmod(path, 0o666)
    function(path)


def size(path):
    return sum(item.stat().st_size for item in path.rglob("*") if item.is_file())


def archive(bundle, destination):
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zip_file:
        for path in sorted(bundle.rglob("*")):
            if path.is_file():
                zip_file.write(path, Path(bundle.name) / path.relative_to(bundle))
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    destination.with_suffix(".zip.sha256").write_text(f"{digest}  {destination.name}\n", encoding="utf-8")
    return digest


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--msys2", default=r"C:\msys64", help="MSYS2 installation (default: C:\\msys64)")
    parser.add_argument("--out", type=Path, default=ROOT / "dist", help="output directory (default: dist/)")
    # A short folder name leaves more room under the compiler's path limit.
    parser.add_argument("--name", default="StackBloom", help="folder inside the zip (default: StackBloom)")
    parser.add_argument("--zip-name", default="StackBloom-windows-x64", help="zip file name, without .zip")
    parser.add_argument("--no-zip", action="store_true", help="leave the folder, skip the zip")
    parser.add_argument("--no-smoke-test", action="store_true", help="skip tracing a program in isolation")
    args = parser.parse_args()
    if os.name != "nt":
        parser.error("build the Windows bundle on Windows")
    if not Path(msys("pacman.exe", args.msys2)).is_file():
        parser.error(f"MSYS2 not found at {args.msys2}; pass --msys2")

    bundle = args.out / args.name
    if bundle.exists():
        shutil.rmtree(bundle, onexc=writable_then_retry)
    print("Building the viewer", flush=True)
    build_viewer()
    print("Copying the app", flush=True)
    copy_app(bundle / "app")
    print("Copying the toolchain from MSYS2 (this takes a minute)", flush=True)
    manifest = copy_toolchain(bundle / "toolchain", args.msys2)
    (bundle / "StackBloom.cmd").write_text(LAUNCHER.replace("\n", "\r\n"), encoding="utf-8")
    (bundle / "README.txt").write_text(README.replace("\n", "\r\n"), encoding="utf-8")
    (bundle / "THIRD_PARTY.md").write_text(third_party(manifest), encoding="utf-8")
    print(f"  {len(manifest)} packages, {size(bundle) / 2**20:.0f} MiB unpacked", flush=True)
    if not args.no_smoke_test:
        smoke_test(bundle)
    if not args.no_zip:
        destination = args.out / f"{args.zip_name}.zip"
        digest = archive(bundle, destination)
        print(f"  {destination} ({destination.stat().st_size / 2**20:.0f} MiB), sha256 {digest[:16]}...")


if __name__ == "__main__":
    main()
