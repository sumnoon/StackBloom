# StackBloom design

## Components and data flow

`source + stdin → Python launcher → compiler → GDB/Python recorder → JSON trace → React viewer`

The launcher compiles a single translation unit with `-std=c++17 -g -O0
-fno-omit-frame-pointer`. GCC is the default; `--compiler clang++` is supported.
Compilation diagnostics and execution failures are trace results, not HTTP errors.
Phase 1 is a local CLI and a browser trace viewer with a code/stdin submission pane.
`stackbloom.py` builds the viewer when its sources change, then one loopback-only
Python server on port 8765 serves those files and accepts submissions from its own
origin. Vite on port 5173 stays available for frontend development and proxies `/api`
to the same server. There is no public execution server. Only run trusted programs until isolation is implemented.

GDB is used instead of LLDB because Ubuntu 22.04 ships a convenient Python-enabled
GDB and GCC/libstdc++ integration. The Python recorder runs **inside GDB**, not in
ordinary Python. The outer Python process owns compilation, deadlines, and files.

One deliberate stepping adjustment: after stopping at `main`, install breakpoints
at distinct executable line addresses in the submitted source and continue between
them. These are source-line steps, not instruction steps. This avoids spending the
step budget in library code and still catches user callbacks invoked by libraries;
blindly using `finish` on library frames can miss callbacks. All discovered addresses
for a line are included. No heuristic based on function names such as `std::` is
needed. Headers and additional translation units require an explicit source allowlist
in a later version. Static initialization before main is not traced in Phase 1.

At each stop, record the newest user frame first and walk its lexical blocks for
arguments and locals. Preserve shadowed names with separate IDs. Skip library frames,
and skip globals except file-scope arrays and vectors of numbers (see tables below). Values are bounded GDB renderings, using the toolchain's libstdc++
printers (never auto-loaded ones) for standard library types; do not execute inferior
functions, `operator<<`, or method calls. Pointers carry a classified target
(`null`, `heap`, `stack`, `dangling`, `unknown`); only proven heap extents are read.
Stack arrays and structures have bounded textual renderings, not graphical children.
Arrays, `std::array`, `std::vector` and `std::deque` of scalars (one level of nesting
for 2D) also carry a `table`: a grid of cell texts of at most 24 rows, 32 columns and 400
cells, read element by element through the same printers. `std::queue`, `std::stack` and
`std::priority_queue` are read through their underlying container, front or bottom first.
The viewer draws a 2D table of valid row numbers as a graph (an adjacency list). File-scope variables of the
traced source that read as tables are recorded per stop under `globals`, so a DP table
kept at file scope is visible too. Reads are not observable without executing code, so
the viewer marks written cells (values that changed) and the cells loop indexes point at.
Maps and sets (`std::map`, `set` and their `multi`/`unordered` variants) carry `entries`:
up to 32 `[key, value]` (maps) or `[key]` (sets) texts in the container's own order. File-scope
maps and sets are recorded under `globals` like file-scope tables, and a reference is read
through its referent, so `std::vector<int>& dp` carries the table of the vector it names.

The highlighted line is about to execute. Multiple statements on a line cannot be
individually promised. A local visible in DWARF may not yet be initialized: a readable
value is **not evidence of initialization**. Each local reports this uncertainty.
Older stack-frame lines are debugger resume locations, generally the call site.

Storage has two forms. The default repeats every snapshot in full. `--compact` writes
[`trace.compact.schema.json`](../trace.compact.schema.json): a checkpoint every 25 stops
and bounded deltas in between, with appended output chunks rather than copied streams
and explicit heap deletion records, so "gone" is never confused with "unchanged". Any
stop is reconstructed from the nearest earlier checkpoint. Reconstruction is exact and
is tested against the full-snapshot baseline, including random seeks. Snapshots stay
immutable; the viewer expands a compact file on load and validates it like any trace.

Each snapshot is written to a flushed NDJSON journal. The supervisor can recover
completed snapshots after a timeout. The final JSON embeds source text so a trace
remains portable. stdout/stderr contain bytes actually flushed by the program, decoded
as UTF-8 with replacement; the tracer never calls flush in the inferior. Use `std::endl`
in teaching examples when immediate output is desired. Stream prefixes are capped.

## Exact wire contract

[`trace.schema.json`](../trace.schema.json) is the normative JSON Schema (2020-12).
All objects are closed (`additionalProperties: false`). Addresses and numeric C++
values are strings so JavaScript cannot lose 64-bit precision. Snapshot IDs are
zero-based contiguous integers. A trace always ends with a terminal snapshot.

```json
{
  "schema_version": "1.0",
  "source": {"path": "main.cpp", "text": "int main() { return 0; }\n"},
  "limits": {"max_steps": 1000, "timeout_seconds": 15, "max_output_bytes": 65536},
  "snapshots": [{
    "id": 0,
    "event": "step",
    "location": {"file": "main.cpp", "line": 1},
    "thread_id": 1,
    "frames": [{
      "id": "t1:f0", "function": "main", "location": {"file": "main.cpp", "line": 1},
      "locals": [], "truncated": false
    }],
    "heap": {},
    "stdout": "", "stderr": "", "output_truncated": false,
    "diagnostic": null
  }, {
    "id": 1, "event": "exit", "location": null, "thread_id": null,
    "frames": [], "heap": {}, "stdout": "", "stderr": "",
    "output_truncated": false,
    "diagnostic": {"kind": "exit", "message": "Program exited with code 0", "exit_code": 0, "signal": null}
  }]
}
```

A local has `id`, `name`, `type`, `value` (string or null), `address` (string
or null), `status` (`readable`, `optimized_out`, `unavailable`), and `initialization`
(currently always `unknown`). Frame/local IDs identify positions within a snapshot;
they are **not** lifetime-stable identities for diffing recursive calls.

For that, each frame carries an optional `call_id` that stays the same for one
invocation's whole lifetime, and locals carry an optional `is_argument` flag. A
`FinishBreakpoint` per call marks returns without adding stops, so sibling calls
that reuse a stack address still get distinct IDs. The first stop after a call
returns lists it in an optional `returns` array (`call_id` plus the raw return
value, or null for `void`). The viewer's recursion tree is built from these
fields. A call's first stop is its entry address, before the prologue stores
arguments, so argument values there are not meaningful.

The reserved heap contract maps hexadecimal addresses to nodes with `type`, `kind`,
`allocation_id`, `size_bytes`, `fields`, and `truncated`. Fields have `name`, `type`,
`value`, and nullable `target` addresses. A snapshot contains one node per address;
allocation IDs distinguish address reuse across time. Phase 2 populates this map
from an allocation ledger: `tracer/alloc_ledger.cpp` is linked into each traced
program, replaces global `operator new`/`delete` and wraps the malloc family with
`ld --wrap`, and records extents into a fixed ring buffer that the recorder reads
as ordinary memory. No breakpoints and no inferior calls are involved. A program
that replaces `operator new` itself fails to link against the ledger and is relinked
without it; extents are then unknown and no pointer is followed. Locals carry an
optional `pointers` array of `{path, target, state}` edges, and `target_local`
names the stack slot a stack pointer refers to.
Edges into stack objects must resolve to stack-local addresses rather than inventing
heap ownership. Interior pointers need explicit base/offset metadata in a future
schema revision. Do not silently repurpose this contract.

`event` is `step`, `exit`, `signal`, `limit`, `timeout`, `compile_error`,
`tracer_error`, or `unsupported`. Terminal failures carry a diagnostic, preserving
the last available stack when possible. A timeout stack is the **last recorded**
stack, not a new debugger stop at timeout. The viewer labels this distinction.

## Scope and limits

Phase 1 accepts one source file and optional stdin; it records only that file's
frames. Native thread creation stops tracing with `unsupported`; this is not a
deterministic multithread simulator. Forking/exec, interactive input, signals used
as application control flow, and hand-written assembly are outside MVP scope.
All signals reported by GDB stop the trace instead of being resumed.

CPU/resource restrictions are defense in depth, not a security boundary. The local
launcher has a wall deadline, source/step/stream limits, Linux resource limits, and
process-group cleanup. A malicious program can still access the host, escape a
process group, or interfere with output files. Compile and trace in a sandbox before
offering uploads or an API. The compiler and debugger are part of that attack surface.

## References

- [GDB frame API](https://sourceware.org/gdb/current/onlinedocs/gdb.html/Frames-In-Python.html)
- [GDB stop/exit events](https://sourceware.org/gdb/current/onlinedocs/gdb.html/Events-In-Python.html)
- [GDB stepping skips](https://sourceware.org/gdb/current/onlinedocs/gdb.html/Skipping-Over-Functions-and-Files.html)
- [GDB value size limits](https://sourceware.org/gdb/current/onlinedocs/gdb.html/Value-Sizes.html)

The implementation uses long-established API calls and does not depend on the newer
`StopEvent.details` API described in the current manual.
