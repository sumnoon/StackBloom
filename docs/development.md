# Development and command-line reference

[← Back to StackBloom](../README.md)

Install the [source prerequisites](getting-started.md) first. These instructions
are for changing StackBloom or recording traces outside the UI.

## Frontend development

Install viewer dependencies once with `npm ci --prefix web`, then use two terminals:

```sh
python tracer/server.py
```

```sh
npm --prefix web run dev
```

On Ubuntu use `python3`. Open [localhost:5173](http://127.0.0.1:5173); Vite proxies
`/api` to the tracer on port 8765. For normal use, `python stackbloom.py` runs the
built viewer and tracer together.

## Command line

Trace a program without the viewer:

```sh
python tracer/trace.py path/to/main.cpp --stdin path/to/input.txt --output my-trace.json
```

Omit `--stdin` for immediate EOF. `--max-steps` (default 1000, max 5000) and
`--timeout` (default 15s) bound the run; `--compiler clang++` and `--gdb /path/to/gdb`
choose the tools. Add `--compact` to store checkpoints and deltas instead of repeating
every snapshot, which was 62% smaller for the bundled binary search tree example. Load
either form with **Open trace** in the viewer; opening a trace never executes code.

The CLI exits nonzero for compile failures, crashes, limits, timeouts and nonzero
program exits, and still writes a trace explaining what happened. It takes one
standalone source file: sibling headers and custom build flags are out of scope.
Compilation has its own 30-second deadline, and the execution deadline includes GDB
startup and snapshot work.

The checked-in [sample trace](../examples/sample.trace.json) comes from a real GCC/GDB run
on the Windows/MSYS2 development host. Addresses, line stops and newline encoding will
differ on Ubuntu.

## Building the Windows bundle

On Windows with MSYS2 (`pacman-contrib` provides `pactree`):

```sh
pacman -S --needed pacman-contrib mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-gdb
```

```sh
python packaging/windows/build_bundle.py
```

It builds the viewer, copies the app, and copies the exact files of every MSYS2 package
that `g++` and `gdb` depend on, keeping MSYS2's layout so GDB finds its Python and the
libstdc++ printers as usual. Documentation, test suites, Tcl/Tk, the C and LTO
compilers, and headers and static libraries of run-time-only packages are left out.
It then traces `examples/fib.cpp` with nothing but the bundle and Windows on `PATH`,
and fails the build if that doesn't work. The output is
`dist/StackBloom-windows-x64.zip` with a SHA-256 file beside it, plus
`THIRD_PARTY.md` listing each bundled package, its version and where its source is
published.

The [Windows portable bundle](../.github/workflows/windows-bundle.yml) workflow does
the same on a fresh GitHub runner. Pushing a `v*` tag attaches the zip to that release.

## Code map

- `tracer/trace.py`: compiler and linker invocation, deadlines, resource limits, journal recovery.
- `tracer/gdb_trace.py`: line-table breakpoints, call identity, return values, frames and streams.
- `tracer/values.py`: bounded lexical-local inspection without inferior calls.
- `tracer/memory.py`: allocation ledger replay and the bounded pointer walker.
- `tracer/alloc_ledger.cpp`: in-program allocation recorder linked into traced builds.
- `tracer/compact.py`: checkpoint/delta storage and exact reconstruction.
- `stackbloom.py`: one-command launcher: builds the viewer when stale, serves it, opens the browser.
- `packaging/windows/build_bundle.py`: builds and smoke-tests the portable Windows zip.
- `Dockerfile`: two-stage image; Node builds the viewer, Ubuntu runs it as a non-root user.
- `packaging/docker/smoke_test.py`: checks a running instance end to end (viewer, a real trace, the Host guard).
- `tracer/server.py`: loopback server for the viewer and the submission API.
- `web/src/main.tsx`: two-screen shell, replay controls, tabs and change navigation.
- `web/src/StackTree.tsx`: connected call bubbles, locals and pointer states.
- `web/src/CallTree.tsx`: branching recursion tree built from recorded invocations.
- `web/src/RepeatReport.tsx`: repeated subproblems, wasted calls and the comparison with the previous run.
- `web/src/MemoryGraph.tsx`: pointer and heap-object graph for the current stop.
- `web/src/DpTables.tsx`: arrays and vectors as grids, with written cells and loop-index cursors.
- `web/src/Entries.tsx`: bounded map/set displays with new and changed entries.
- `web/src/layout.ts`: structure heuristics (list, tree, grid, graph) and positions.
- `web/src/Sparkline.tsx`: depth sparkline, run totals and per-line stop counts.
- `web/src/CodeEditor.tsx`: CodeMirror C++ editor with compiler-error markers, loaded as a separate chunk when the editor opens.
- `web/src/editorIssues.ts`: parses GCC/Clang diagnostics into line and column markers.
- `web/src/EventTimeline.tsx` and `web/src/traceEvents.ts`: timeline event markers, filters and event-to-event navigation.
- `web/src/GraphOverview.tsx`: the corner overview for graphs larger than their panel.
- `web/src/display.ts`: short type names, container values and pointer labels.
- `web/src/Watches.tsx`: watched variables and their value history across the run.
- `web/src/Predict.tsx`: Predict mode: the question before a return, answer checking and the score.
- `web/src/exporter.ts` and `web/src/ExportMenu.tsx`: PNG pictures, and the tree growing as MP4/WebM video or GIF (gifenc).
- `web/src/zoom.tsx`: fit-to-panel zoom shared by both graph panels.
- `web/src/compact.ts`: reader for compact traces.
- `web/src/trace.ts`: runtime JSON Schema validation and TypeScript types.

## Verification

```sh
python -m venv .venv
. .venv/bin/activate
pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
npm --prefix web run build
node --test web/tests/traceEvents.test.mjs
```

`npm run build` builds the viewer twice: the normal app in `web/dist`, then a
single-file copy (`vite build --mode share`, inlined by `web/scripts/share-viewer.mjs`)
saved as `web/dist/stackbloom-viewer.html`. **Export → The whole run** fetches that
file and writes the trace into it, so the export needs the built viewer; under
`npm run dev` it explains how to build.

The Python suite covers integration and unit behavior. Compiler/debugger tests
need the toolchain installed:

- `tests/test_trace.py`: nested locals, loop stops, stdin, output truncation, shadowing,
  library callbacks, thread detection, compile errors, signals, step limits, wall
  timeout, the recursion call tree, standard library values, declaration lines and
  arrays and vectors recorded as tables, map/set entries, global memo maps, and
  reference parameters.
- `tests/test_memory.py`: aliases, cycles, stack pointers, null versus dangling, reused
  addresses, array extents, `malloc`/`void*`, and the fallback when a program replaces
  `operator new`.
- `tests/test_compact.py`: compact round trip, random seek against the full-snapshot
  baseline, explicit deletion records and size reduction.
- `tests/test_server.py`: viewer file serving, refusing paths outside the build, the
  missing-build message, submission forwarding, custom and out-of-range limits,
  origin rejection, invalid input and missing-toolchain errors.
- `tests/test_launcher.py`: the portable bundle's check for folders too deep for GCC.

Viewer tests (Node 22.18+ or 24, which run the TypeScript directly) cover timeline
events: returns only where the tracer recorded one, heap objects told apart by
allocation even when an address is reused, and output and failing exits.

CI runs the Python suite and web build on Ubuntu 22.04. Run the viewer tests
above separately as well. On PowerShell, activate the virtual environment with
`.venv\Scripts\Activate.ps1` instead of `. .venv/bin/activate`.
