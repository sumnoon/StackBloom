# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Self-learners: students teaching themselves recursion, dynamic programming, pointers
and data structures in C++. They paste their own practice programs (or pick an
example) and step through them to understand why a recursive call branches the way it
does, what each call returns, and where a pointer really points. They are learning, not
debugging production code, so every view must explain itself without a manual.

## Product Purpose

StackBloom runs a single-file C++17 program on the learner's own machine, records its
real execution under GDB, and replays that recording as something to step through:
every source stop, every call frame with its typed locals, the recursion as a branching
tree, and the heap as a graph of real pointers. Success is the moment a learner says
"oh, that's why" about recursion, a return value or a pointer.

## Positioning

It shows what the compiled program actually did, not a simulation: a real GCC build
traced by GDB, with call identities, recorded return values and a heap ledger. Replay
only reads the recording; nothing re-runs. It runs locally with no account and no
server, and ships as a portable Windows folder or a Docker image.

## Operating Context

- Two screens: the **editor** (paste code, program input, execution limits, four
  illustrated examples, recent runs, compiler errors pinned to lines) and the **trace
  workspace** (source beside four tabs: Call stack, Recursion tree, Memory, Output;
  a toolbar with step, over, out, play and speed; a timeline with a depth sparkline and
  event markers; watches; an end-of-run summary).
- Study sessions on laptops are the core scene, but traces are also opened on phones
  and tablets, so every screen must work from about 360px wide upward.
- Keyboard use is common: Space plays, arrows and s / n / f step.

## Capabilities and Constraints

- Single translation unit, C++17, GCC by default. Up to 5,000 stops and 60 seconds.
- The frontend is React 19 + Vite + TypeScript with a CodeMirror editor; graphs are
  hand-drawn SVG. The backend, API (`POST /api/trace`), trace schema and routes are
  fixed for UI work.
- Not a sandbox: programs run with the user's permissions. The UI must keep saying so.
- Light and dark appearance follow the system; reduced motion must be honoured.
- Traces are portable JSON files that can be downloaded and dropped back in.

## Brand Commitments

- Name: **StackBloom**.
- Tagline: *Watch your C++ grow, one call at a time.*
- The 🌱 sprout is the brand sign (repository description, README title, social card).
- Everything else visual (logo mark, colours, type, shapes) is open.

## Evidence on Hand

- Four built-in example programs: factorial, Fibonacci, linked list, binary search tree
  (`web/src/SubmissionPane.tsx`), and a bundled sample trace (`examples/`).
- Screenshots in `docs/` and a 1280×640 social card.
- No testimonials, user counts or benchmarks exist; do not invent any.

## Product Principles

1. The recording is the truth: show only what was observed, label what is uncertain.
2. Explain in place: a learner should never need to leave the screen to read a view.
3. One idea at a time: the current call and the next line lead; everything else supports.
4. Nothing hides the program: controls and chrome never cover code, values or graphs.

## Accessibility & Inclusion

Keyboard-complete stepping and tab navigation, visible focus, screen-reader labels on
graph nodes and controls, colour never the only signal for call or pointer state, and
reduced-motion support.
