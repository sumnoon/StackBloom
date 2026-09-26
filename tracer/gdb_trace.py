"""Executed with `gdb -nx -batch -x ...`; never invoke with plain Python."""
import json
import os
import sys
from pathlib import Path

import gdb

sys.path.insert(0, str(Path(__file__).resolve().parent))
from memory import Ledger, capture
from values import locals_for, read_local

CFG = json.loads(Path(os.environ["CPPV_CONFIG"]).read_text(encoding="utf-8"))
SOURCE = Path(CFG["source"]).resolve()
last_signal = None
exited = False
exit_code = None
new_thread = False
recording = False
index = 0
active_calls = []
finished_calls = set()
returned_values = []
ledger = Ledger()
next_call_id = 0
MAX_RETURN_TEXT = 512
MAX_GLOBALS = 16
global_symbols = None


def global_tables(frame):
    """File-scope arrays and vectors of the traced source, for the DP table view.

    DP solutions often keep their table at file scope (`int dp[100];`), so those are
    recorded too, but only when they read as a table; other globals stay out.
    """
    global global_symbols
    if global_symbols is None:
        global_symbols = []
        try:
            block = frame.block()
            for scope in (block.global_block, block.static_block):
                for symbol in scope:
                    if symbol.is_variable and symbol.symtab and                             Path(symbol.symtab.fullname()).resolve() == SOURCE:
                        global_symbols.append(symbol)
        except (gdb.error, RuntimeError):
            pass
    items = []
    for symbol in global_symbols[:MAX_GLOBALS]:
        item, _ = read_local(symbol, frame, "global")
        if item.get("table"):
            items.append(item)
    return items


class CallReturn(gdb.FinishBreakpoint):
    """Observe return boundaries even when sibling calls reuse a stack address."""
    def __init__(self, frame, call_id):
        super().__init__(frame, internal=True)
        self.call_id = call_id

    def stop(self):
        finished_calls.add(self.call_id)
        value = None
        try:
            if self.return_value is not None:
                value = self.return_value.format_string(raw=True)[:MAX_RETURN_TEXT]
        except (gdb.error, RuntimeError, ValueError):
            pass
        returned_values.append(dict(call_id=self.call_id, value=value))
        return False

    def out_of_scope(self):
        finished_calls.add(self.call_id)


def identify_calls(frames, native_frames):
    global active_calls, next_call_id
    previous = active_calls
    current = []
    matching = True
    for depth, (item, native) in enumerate(zip(reversed(frames), reversed(native_frames))):
        if (matching and depth < len(previous) and previous[depth][0] == item["function"]
                and previous[depth][1] not in finished_calls):
            call_id = previous[depth][1]
        else:
            matching = False
            call_id = f"call-{next_call_id}"
            next_call_id += 1
            try:
                CallReturn(native, call_id)
            except (gdb.error, ValueError, RuntimeError):
                # GDB raises ValueError for the outermost frame (main on some hosts).
                # Stack-shape comparison remains a fallback for un-unwindable frames.
                pass
        item["call_id"] = call_id
        current.append((item["function"], call_id))
    active_calls = current
    finished_calls.clear()


def on_stop(event):
    global last_signal
    if isinstance(event, gdb.SignalEvent):
        last_signal = event.stop_signal


def on_exit(event):
    global exited, exit_code
    exited = True
    exit_code = getattr(event, "exit_code", None)


def on_thread(event):
    global new_thread
    if recording:
        new_thread = True


gdb.events.stop.connect(on_stop)
gdb.events.exited.connect(on_exit)
gdb.events.new_thread.connect(on_thread)


def location(frame):
    sal = frame.find_sal()
    if sal.symtab and sal.line and Path(sal.symtab.fullname()).resolve() == SOURCE:
        return dict(file=SOURCE.name, line=sal.line)
    return None


def streams():
    texts = []
    truncated = False
    for name in ("stdout", "stderr"):
        with open(CFG[name], "rb") as stream:
            data = stream.read(CFG["max_output_bytes"] + 1)
        truncated |= len(data) > CFG["max_output_bytes"]
        texts.append(data[:CFG["max_output_bytes"]].decode("utf-8", "replace"))
    return texts[0], texts[1], truncated


def snapshot(event, diagnostic=None):
    global index
    frames = []
    native_frames = []
    frame_values = []
    thread = gdb.selected_thread()
    if thread:
        frame = gdb.newest_frame()
        # Bound unwinding as well as local serialization.
        depth = 0
        while frame is not None and depth < 128:
            loc = location(frame)
            if loc:
                items, values, truncated = locals_for(frame)
                frames.append(dict(id=f"t{thread.num}:f{depth}", function=frame.name() or "?",
                                   location=loc, locals=items, truncated=truncated))
                native_frames.append(frame)
                frame_values.append((f"t{thread.num}:f{depth}",
                                     list(zip((item["id"] for item in items), values))))
            frame = frame.older()
            depth += 1
        if frame is not None and frames:
            frames[-1]["truncated"] = True
    identify_calls(frames, native_frames)
    # Outermost frame first, so long-lived structures get the node budget.
    heap, pointers, heap_truncated = memory_graph(list(reversed(frame_values)))
    for frame in frames:
        for local in frame["locals"]:
            edges = pointers.get(f"{frame['id']}|{local['id']}")
            if edges:
                local["pointers"] = edges
    stdout, stderr, truncated = streams()
    tables = global_tables(gdb.newest_frame()) if thread and frames else []
    result = dict(id=index, event=event, location=frames[0]["location"] if frames else None,
                  thread_id=thread.num if thread else None, frames=frames, heap=heap,
                  stdout=stdout, stderr=stderr, output_truncated=truncated, diagnostic=diagnostic,
                  returns=list(returned_values), heap_truncated=heap_truncated)
    if tables:
        result["globals"] = tables
    returned_values.clear()
    with open(CFG["journal"], "a", encoding="utf-8") as stream:
        stream.write(json.dumps(result, ensure_ascii=True) + "\n")
        stream.flush()
    index += 1


def load_printers():
    """Register the toolchain's libstdc++ printers (std::string, vector, map, ...).

    The directory comes from the supervisor, not the program, and auto-load stays
    off, so the traced executable cannot supply Python. Printers read memory only;
    xmethods, which serve expression evaluation, are deliberately not loaded.
    """
    directory = CFG.get("printers")
    if not directory:
        return
    try:
        sys.path.insert(0, directory)
        from libstdcxx.v6.printers import register_libstdcxx_printers
        register_libstdcxx_printers(None)
    except Exception:
        # Values then fall back to raw layouts, as before printers existed.
        pass


def memory_graph(frame_values):
    """Never let graph construction break an otherwise valid trace."""
    if not frame_values:
        return {}, {}, False
    try:
        return capture(ledger, frame_values)
    except Exception:
        return {}, {}, True


def diagnostic(kind, message, signal=None, code=None):
    return dict(kind=kind, message=message, signal=signal, exit_code=code)


def command(text):
    return gdb.execute(text, to_string=True)


def run():
    global recording
    for setting in ("pagination off", "confirm off", "print elements 64", "print repeats 10",
                    "print max-depth 3", "print raw-values off", "max-value-size 4096",
                    "auto-load off", "debuginfod enabled off", "non-stop off"):
        try:
            command("set " + setting)
        except gdb.error:
            # debuginfod may not be compiled into the host GDB.
            if not setting.startswith("debuginfod"):
                raise
    load_printers()
    # Launch paths are generated by the trusted supervisor, never user expressions.
    command('start < "{stdin}" > "{stdout}" 2> "{stderr}"'.format(**CFG))
    if exited:
        snapshot("exit", diagnostic("exit", f"Program exited with code {exit_code}", code=exit_code))
        return
    if last_signal:
        snapshot("signal", diagnostic("signal", "Stopped on " + last_signal, signal=last_signal))
        return
    recording = True
    # Windows creates OS/runtime helper threads before main. Linux is the target
    # platform; tolerate only that pre-existing Windows baseline for local tests.
    baseline_threads = len(gdb.selected_inferior().threads()) if os.name == "nt" else 1
    # Resolve exact executable lines. `break file:N` alone can slide to N+1 and
    # accidentally create hundreds of duplicates on comments/blank lines.
    # The line table includes loop backedges and multiple template instantiations;
    # decode_line(file:line) alone can return only one address for a source line.
    symtab = gdb.lookup_global_symbol("main").symtab
    if Path(symtab.fullname()).resolve() != SOURCE:
        raise RuntimeError("main must be defined in the submitted source")
    addresses = {entry.pc for entry in symtab.linetable() if entry.line > 0}
    for address in sorted(addresses):
        gdb.Breakpoint(f"*{address:#x}", internal=True)
    if not addresses:
        raise RuntimeError("No executable source locations found")
    for step in range(CFG["max_steps"]):
        if new_thread or len(gdb.selected_inferior().threads()) > baseline_threads:
            snapshot("unsupported", diagnostic("threads", "Multiple threads are unsupported in Phase 1"))
            return
        snapshot("step")
        command("continue")
        if last_signal:
            snapshot("signal", diagnostic("signal", "Stopped on " + last_signal, signal=last_signal))
            return
        if exited:
            snapshot("exit", diagnostic("exit", f"Program exited with code {exit_code}", code=exit_code))
            return
    snapshot("limit", diagnostic("steps", "Source step limit reached"))


try:
    run()
except Exception as exc:
    try:
        snapshot("tracer_error", diagnostic("debugger", str(exc)))
    except Exception:
        # The supervisor will recover the journal even when stack unwinding fails.
        raise
finally:
    try:
        command("kill")
    except gdb.error:
        pass
