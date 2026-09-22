"""Compile trusted C++ and supervise a bounded GDB trace. Python 3.10+."""
import argparse
import copy
import json
import math
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile

from compact import compact

ROOT = Path(__file__).resolve().parent
MAX_OUTPUT = 65536


def linux_limits():
    """Defense in depth for local jobs; these are not a sandbox."""
    import resource
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_CPU, (30, 30))
    resource.setrlimit(resource.RLIMIT_AS, (2 * 1024**3, 2 * 1024**3))
    resource.setrlimit(resource.RLIMIT_FSIZE, (32 * 1024**2, 32 * 1024**2))


def supervise(argv, cwd, timeout, log, env=None):
    options = dict(cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                   stdout=log, stderr=subprocess.STDOUT)
    if os.name == "posix":
        options.update(start_new_session=True, preexec_fn=linux_limits)
    process = subprocess.Popen(argv, **options)
    timed_out = False
    try:
        process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
    finally:
        if os.name == "posix":
            # Also reap remaining ordinary descendants after a normal GDB exit.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        elif timed_out:
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            process.kill()
        process.wait()
    return process.returncode, timed_out


def printer_directory(compiler):
    """Find libstdc++'s trusted GDB printers shipped with the compiler's toolchain.

    They are loaded explicitly from the host toolchain, never auto-loaded from
    the traced executable. Prefer the compiler's own prefix so versions match.
    """
    found = shutil.which(compiler)
    prefixes = [Path(found).resolve().parent.parent] if found else []
    prefixes.append(Path("/usr"))
    for prefix in prefixes:
        candidates = sorted((prefix / "share").glob("gcc*/python"), reverse=True)
        for candidate in candidates:
            if (candidate / "libstdcxx" / "v6" / "printers.py").is_file():
                return candidate.as_posix()
    return None


def terminal(trace, event, message):
    previous = trace["snapshots"][-1] if trace["snapshots"] else dict(
        location=None, thread_id=None, frames=[], heap={}, stdout="", stderr="", output_truncated=False)
    stop = copy.deepcopy(previous)
    # Returns belong to the stop that observed them; do not duplicate them here.
    stop.pop("returns", None)
    stop.update(id=len(trace["snapshots"]), event=event,
                diagnostic=dict(kind=event, message=message, signal=None, exit_code=None))
    trace["snapshots"].append(stop)


def generate(source, stdin="", max_steps=1000, timeout=15, compiler="g++", debugger="gdb"):
    source = Path(source).resolve()
    text = source.read_text(encoding="utf-8")
    if len(text.encode("utf-8")) > 262144 or len(text.splitlines()) > 5000:
        raise ValueError("Source limit: 256 KiB and 5000 lines")
    trace = dict(schema_version="1.0", source=dict(path=source.name, text=text),
                 limits=dict(max_steps=max_steps, timeout_seconds=timeout, max_output_bytes=MAX_OUTPUT),
                 snapshots=[])
    with tempfile.TemporaryDirectory(prefix="cppv-") as directory:
        work = Path(directory)
        # Fixed source name also prevents GDB expression/path injection.
        submitted = work / "main.cpp"
        submitted.write_text(text, encoding="utf-8")
        trace["source"]["path"] = "main.cpp"
        binary = work / ("program.exe" if os.name == "nt" else "program")
        build_log = work / "build.log"
        flags = ["-std=c++17", "-g", "-O0", "-fno-omit-frame-pointer"]
        obj, ledger = work / "main.o", work / "cppv_ledger.o"
        with build_log.open("wb") as log:
            code, timed_out = supervise([compiler, *flags, "-c", str(submitted), "-o", str(obj)], work, 30, log)
        # A submitted program may replace operator new itself, which collides with
        # the ledger at link time; it is then simply left out and heap extents are
        # unknown. Its diagnostics stay out of the user's compile error message.
        tracked = False
        if not (code or timed_out):
            with (work / "ledger.log").open("wb") as log:
                built, ledger_timeout = supervise(
                    [compiler, *flags, "-c", str(ROOT / "alloc_ledger.cpp"), "-o", str(ledger)], work, 30, log)
                if not (built or ledger_timeout):
                    linked, link_timeout = supervise(
                        [compiler, *flags, str(obj), str(ledger), "-o", str(binary),
                         "-Wl,--wrap=malloc,--wrap=calloc,--wrap=realloc,--wrap=free"], work, 30, log)
                    tracked = not (linked or link_timeout)
        if not (code or timed_out) and not tracked:
            with build_log.open("ab") as log:
                code, timed_out = supervise([compiler, *flags, str(obj), "-o", str(binary)], work, 30, log)
        if code or timed_out:
            with build_log.open("rb") as log:
                message = log.read(MAX_OUTPUT).decode("utf-8", "replace")
            # Diagnostics name a temporary build directory; the author wrote main.cpp.
            for path in (str(submitted), submitted.as_posix()):
                message = message.replace(path, "main.cpp")
            terminal(trace, "compile_error", "Compiler timed out" if timed_out else message)
            return trace
        cfg = {name: (work / name).as_posix() for name in ("stdin", "stdout", "stderr", "journal")}
        for name in ("stdout", "stderr", "journal"):
            Path(cfg[name]).touch()
        Path(cfg["stdin"]).write_text(stdin, encoding="utf-8")
        cfg.update(source=submitted.as_posix(), max_steps=max_steps, max_output_bytes=MAX_OUTPUT,
                   printers=printer_directory(compiler), ledger=tracked)
        config = work / "config.json"
        config.write_text(json.dumps(cfg), encoding="utf-8")
        env = dict(os.environ, CPPV_CONFIG=str(config))
        if os.name == "nt":
            # Load the runtime DLLs of the compiler that built the program, not an
            # unrelated toolchain that happens to come first on the developer's PATH.
            found = shutil.which(compiler)
            if found:
                env["PATH"] = str(Path(found).resolve().parent) + os.pathsep + env.get("PATH", "")
        with (work / "gdb.log").open("wb") as log:
            code, timed_out = supervise([debugger, "-nx", "-nh", "-batch",
                                        "-iex", "set auto-load off", "-x", str(ROOT / "gdb_trace.py"),
                                        str(binary)], work, timeout, log, env)
        with Path(cfg["journal"]).open(encoding="utf-8") as journal:
            for line in journal:
                try:
                    trace["snapshots"].append(json.loads(line))
                except json.JSONDecodeError:
                    break  # Incomplete last write after external termination.
        if timed_out:
            terminal(trace, "timeout", "Wall deadline reached; showing last recorded stack")
        elif not trace["snapshots"] or trace["snapshots"][-1]["event"] == "step":
            with (work / "gdb.log").open("rb") as log:
                message = log.read(MAX_OUTPUT).decode("utf-8", "replace")
            terminal(trace, "tracer_error", message or f"GDB exited with code {code}")
        # Include output flushed since the final recorded stop, even on timeout.
        last = trace["snapshots"][-1]
        for name in ("stdout", "stderr"):
            with Path(cfg[name]).open("rb") as stream:
                data = stream.read(MAX_OUTPUT + 1)
            last[name] = data[:MAX_OUTPUT].decode("utf-8", "replace")
            last["output_truncated"] |= len(data) > MAX_OUTPUT
    return trace


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--stdin", type=Path)
    parser.add_argument("--output", type=Path, default=Path("trace.json"))
    parser.add_argument("--max-steps", type=int, default=1000)
    parser.add_argument("--timeout", type=float, default=15)
    parser.add_argument("--compiler", default="g++")
    parser.add_argument("--gdb", default="gdb")
    parser.add_argument("--compact", action="store_true",
                        help="store checkpoints and deltas instead of repeating every snapshot")
    args = parser.parse_args()
    if not 1 <= args.max_steps <= 5000 or not math.isfinite(args.timeout) or not 0 < args.timeout <= 120:
        parser.error("max-steps must be 1..5000; timeout must be finite and in (0, 120]")
    try:
        result = generate(args.source, args.stdin.read_text(encoding="utf-8") if args.stdin else "",
                          args.max_steps, args.timeout, args.compiler, args.gdb)
    except (OSError, ValueError) as exc:
        parser.exit(2, f"trace: {exc}\n")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    stored = compact(result) if args.compact else result
    args.output.write_text(json.dumps(stored, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    event = result["snapshots"][-1]["event"]
    shape = "checkpoints+deltas" if args.compact else "full snapshots"
    print(f"{args.output}: {len(result['snapshots'])} snapshots ({shape}); {event}")
    return 0 if event == "exit" and result["snapshots"][-1]["diagnostic"]["exit_code"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
