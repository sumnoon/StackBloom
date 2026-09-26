# Execution boundaries

[← Back to StackBloom](../README.md)

**Run only code you trust. StackBloom is not a sandbox.** Native execution uses
your account's permissions. Docker provides a separate environment, but this
project does not claim it is safe for hostile submissions.

The local server accepts same-origin submissions with a custom request header and
runs one job at a time. These browser-facing checks do not contain malicious C++.
Keep it on loopback; do not publish it or expose it through a tunnel.

## What a trace can tell you

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

## Repeated-call reports

Repeated work groups calls by their displayed function-and-argument labels.
Those labels can be shortened, and functions can depend on hidden state or have
side effects. Matching labels suggest an opportunity to investigate; they do not
prove equivalent subproblems or that memoization is safe. Run comparisons count
observed calls, not CPU time or measured speedups.

See the [architecture](design.md) and [roadmap](roadmap.md) for implementation
details and planned isolation work.
