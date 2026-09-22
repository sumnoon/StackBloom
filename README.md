# StackBloom

*Watch your C++ grow, one call at a time.*

StackBloom runs a single-file C++ program under GDB and turns it into something you
can step through: every source stop, every call frame with its typed locals, the
recursion as a branching tree, and the heap as a graph of real pointers.

Paste a program and press **Run & visualize**:

![The StackBloom editor screen with a binary search tree program and example buttons](docs/editor.png)

Then step through it. The source stays on the left while the call stack, recursion
tree, memory graph and output share tabs on the right, so nothing needs scrolling:

![StackBloom stepping through a binary search tree, with the memory graph beside the source](docs/screenshot.png)

**Run only code you trust. This is not a sandbox** — your program runs on your machine
with your permissions.

## What it shows

- **Source stops and locals.** A stop happens *before* the highlighted line runs. Each
  call bubble carries its own locals, with standard library values (`std::string`,
  `vector`, `map`, smart pointers) shown as contents rather than internal layout.
- **A recursion tree.** Every invocation with the arguments it received and the value
  it returned. With two calls the first is the left branch (L) and the second the
  right (R), so `fib(n-1)` and `fib(n-2)` sit where you expect.

  ![The recursion tree for fib(4), with returned values on every call](docs/recursion-tree.png)

- **A memory graph.** Pointers, heap objects, aliases meeting at one box, cycles that
  loop back, and dangling pointers after `delete`. The shape is detected per stop —
  list, tree, grid or general graph — and nodes keep their position as you step.
- **Time travel.** Step forward and back, jump to the next memory change or the next
  output, or drag the timeline. Replay never re-runs your program; it only reads what
  was recorded.

Both graphs scale to fit their panel, so a wide recursion tree or a long list is
visible without scrolling. Pick a zoom level from the dropdown to read the details,
and **Hide code** gives the graph the whole window.

Read the [design and data flow](docs/design.md), the exact
[JSON trace schema](trace.schema.json), and the [phased roadmap](docs/roadmap.md).

## Install on Windows

Tested on Windows 11 with MSYS2. You need a C++ compiler, a Python-enabled GDB,
Python 3 and Node.js.

**1. Install MSYS2** from [msys2.org](https://www.msys2.org/), then open the
**UCRT64** terminal and install the toolchain:

```sh
pacman -S --needed mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-gdb
```

**2. Put the toolchain on your PATH.** Add `C:\msys64\ucrt64\bin` to your user `Path`
(Settings → *Edit environment variables for your account*), then open a new terminal
and check that both tools answer, and that GDB has Python built in:

```sh
g++ --version
gdb -nx -batch -ex "python import sys; print(sys.version)"
```

If the last command prints nothing or errors, your GDB lacks Python; install the
MSYS2 one above rather than a plain MinGW build.

**3. Install Python 3.10+** from [python.org](https://www.python.org/downloads/)
(tick *Add python.exe to PATH*) and **Node.js 22.12+ or 24 LTS** from
[nodejs.org](https://nodejs.org/).

**4. Install the web dependencies** from the repository root:

```sh
npm --prefix web ci
```

A note specific to Windows: several programs ship their own copy of the C++ runtime
(Git for Windows is a common one). StackBloom passes the compiler's own directory
first when it runs your program, so it loads the runtime it was built against.

## Install on Ubuntu 22.04

```sh
sudo apt update
sudo apt install -y build-essential gdb python3 python3-venv
gdb -nx -batch -ex 'python import sys; print(sys.version)'
```

Use Node.js **22.12+ or 24 LTS**; Ubuntu 22.04's default Node package is too old for
this Vite setup. See [Vite's prerequisites](https://vite.dev/guide/). Then
`npm --prefix web ci`.

## Run it

StackBloom needs two terminals, both from the repository root.

**Terminal 1 — the tracer API:**

```sh
python tracer/server.py
```

**Terminal 2 — the viewer:**

```sh
npm --prefix web run dev
```

Open **http://127.0.0.1:5173** (use `127.0.0.1`, not `localhost`). Paste a single-file
C++17 program into **C++ source**, add **stdin** if your program reads input, and click
**Run & visualize**. The buttons at the top load ready-made examples: factorial,
Fibonacci, a linked list and a binary search tree.

The trace opens on its own screen. Step with **Forward** / **Back**, the arrow keys or
the timeline. **Deepest call** jumps to the deepest point of the stack, **Next memory
change** to the next stop where a heap object changes. The **Call stack**, **Recursion
tree**, **Memory** and **Output** tabs sit beside the source; arrow keys move between
them once a tab has focus. **Hide code** gives a wide graph the whole window, and
**← Edit code** returns to your program with it still there.

The API listens only on `127.0.0.1:8765`, accepts only the local viewer's origin and
request header, and runs one job at a time. That stops unrelated web pages from
submitting code; it does **not** contain malicious C++. Never expose either server or
put it behind a public tunnel.

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

The checked-in [sample trace](examples/sample.trace.json) comes from a real GCC/GDB run
on the Windows/MSYS2 development host. Addresses, line stops and newline encoding will
differ on Ubuntu.

## Code map

- `tracer/trace.py`: compiler and linker invocation, deadlines, resource limits, journal recovery.
- `tracer/gdb_trace.py`: line-table breakpoints, call identity, return values, frames and streams.
- `tracer/values.py`: bounded lexical-local inspection without inferior calls.
- `tracer/memory.py`: allocation ledger replay and the bounded pointer walker.
- `tracer/alloc_ledger.cpp`: in-program allocation recorder linked into traced builds.
- `tracer/compact.py`: checkpoint/delta storage and exact reconstruction.
- `tracer/server.py`: local submission API and request validation.
- `web/src/main.tsx`: two-screen shell, replay controls, tabs and change navigation.
- `web/src/StackTree.tsx`: connected call bubbles, locals and pointer states.
- `web/src/CallTree.tsx`: branching recursion tree built from recorded invocations.
- `web/src/MemoryGraph.tsx`: pointer and heap-object graph for the current stop.
- `web/src/layout.ts`: structure heuristics (list, tree, grid, graph) and positions.
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
```

28 tests run real compilers and debuggers, not fixtures:

- `tests/test_trace.py`: nested locals, loop stops, stdin, output truncation, shadowing,
  library callbacks, thread detection, compile errors, signals, step limits, wall
  timeout, the recursion call tree and standard library values.
- `tests/test_memory.py`: aliases, cycles, stack pointers, null versus dangling, reused
  addresses, array extents, `malloc`/`void*`, and the fallback when a program replaces
  `operator new`.
- `tests/test_compact.py`: compact round trip, random seek against the full-snapshot
  baseline, explicit deletion records and size reduction.
- `tests/test_server.py`: submission forwarding, origin rejection, invalid input and
  missing-toolchain errors.

CI runs the suite and the web build on Ubuntu 22.04.

## Interpretation and boundaries

- A stop is **before** its highlighted line executes. Line tables can produce repeated
  stops on a line, including loop conditions and function prologues.
- DWARF can expose locals before initialization. `readable` means GDB could read the
  storage, not that the value is valid; locals carry `initialization: unknown`. A call's
  first stop happens before its arguments are stored, so the tree shows `f(?)` there.
- Heap extents come from an allocation recorder linked into your program. Static
  storage, allocations made before `main` and allocations inside prebuilt libraries stay
  **unproven** and are never read. A stale pointer into a reused block still reads as
  live; `allocation_id` shows the reuse, but detecting it needs provenance tracking.
- Unions stay opaque (DWARF rarely identifies the active member), the static type is
  used rather than guessing a dynamic one, and an interior pointer gets its own node.
- Per stop the graph is bounded: 64 nodes, 32 fields, 32 array elements, depth 2.
  Field names such as `left`/`right` are hints only: a shared child or a cycle is drawn
  as a graph, never as a tree.
- Captured output contains only bytes the program flushed; the tracer never changes
  buffering. Invalid UTF-8 is replaced and each stream is capped at 64 KiB.
- Standard library values use the libstdc++ printers from your compiler's toolchain,
  loaded explicitly; auto-loading from the traced program stays off. Clang with libc++
  falls back to raw layouts.
- Only the submitted source's frames are shown. Tracing starts at `main`, so global
  constructors are outside the timeline.
- Thread creation stops the trace as unsupported.
- Linux jobs inherit CPU, file-size and 2 GiB virtual-memory limits. These limits and
  process-group cleanup **do not isolate untrusted code**. See the roadmap for the
  sandbox architecture this needs before accepting code from anyone else.

If GDB reports `Operation not permitted` inside a container, the runtime is blocking
ptrace. Use a reviewed debugger worker policy rather than disabling host protections.
