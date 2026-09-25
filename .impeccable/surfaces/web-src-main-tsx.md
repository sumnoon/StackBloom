---
version: 1
slug: "web-src-main-tsx"
primary_target: "web/src/main.tsx"
related_targets: ["web/src/SubmissionPane.tsx","web/src/style.css"]
---

# StackBloom viewer: editor and trace workspace

Scope: both screens of the web viewer (editor screen; trace workspace with Call stack,
Recursion tree, Memory, Output tabs, toolbar, timeline, watches, summary strip).
Mode: Operate. Self-learners studying recursion, DP and pointers for long sessions on
laptops, sometimes phones. Task: step through a recorded run and understand calls,
returns and pointers. Must not change backend, API or routes; keep every feature.

Memorable moment: the recursion tree being written onto the board call by call.
Avoid: corporate SaaS sameness; decoration that competes with code or values.

## Direction contract

THESIS: The run is written up on a lecture board, one call at a time. It refuses the
debugger-dashboard arrangement of grey cards, icon toolbars and a blue accent.

OWN-WORLD: Dark mode is a green-black slate with faint chalk dust; light mode is a
white enamel whiteboard in marker ink. Chalk and marker colours carry meaning by law:
yellow/blue is the running call and only that, pink/red is a value coming back, green
is finished or new, sky/orange is pointers. Thin aluminium rails split the board
into panels; one crisp stroke per rule, no drop-shadow cards. Explanations live on
yellow sticky notes. Code in JetBrains Mono (no ligatures), interface in Bricolage
Grotesque, board annotations in Patrick Hand.

STORY: The learner sees the call that is running, how it got there, and what just came
back, and presses Step to watch the next call appear on the board.

FIRST VIEWPORT: Trace screen: a slim top rail (sprout mark, StackBloom, file,
step/over/out/play in chalk-outline buttons), code board left (40%), tree board right
with the chalked path from main to the running call, ↑ return marks, ticks on finished
calls, a sticky note stating the last step, the breadcrumb of the call path, and the
chalk tray along the bottom holding the event marks, depth sparkline and scrubber.
Editor: the board headline in chalk, the four examples as board sketches, the code
editor on the board, Run & visualize in the tray.

FORM: The Lecture Board, candidate 3 of 7, rendition A (Slate & Chalk) with B's sticky
notes, chosen after a safer, a bolder and a plain re-roll. Seed key 5c1fc659.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Raises kept from challengers: state is a mark, not a hue (tick, box, underline);
one-stroke chrome; one active edge (the path to the running call); the running call
leads, the rest recedes; details on focus.

## Motion grammar

Emil Kowalski's rules: --ease-out cubic-bezier(0.23, 1, 0.32, 1), --ease-in-out
cubic-bezier(0.77, 0, 0.175, 1); transform and opacity (clip-path allowed); press
feedback on every button; hover motion only on (hover: hover) and (pointer: fine);
reduced motion keeps opacity, drops movement. One signature moment per screen:
trace = a new call written onto the board and its value rising back to the caller;
editor = the board's opening (headline and example sketches arriving in a short
stagger).
