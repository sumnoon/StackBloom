---
name: StackBloom
description: Watch your C++ grow, one call at a time.
colors:
  # Whiteboard (light, normative for component refs): white enamel, marker inks
  enamel-board: "#f5f5f1"
  enamel-raised: "#fdfdfb"
  enamel-sunk: "#ecece6"
  marker-ink: "#1c1d20"
  marker-ink-soft: "#52555b"
  marker-ink-faint: "#63666b"
  aluminium-rail: "#d6d8d8"
  aluminium-rail-strong: "#a4a8ab"
  run-blue-marker: "#1f56d0"
  run-blue-wash: "#dfe8fb"
  on-run-light: "#ffffff"
  ret-red-marker: "#c8302a"
  ret-red-wash: "#f9e0dd"
  done-green-marker: "#137a52"
  done-green-wash: "#dcf0e6"
  ptr-orange-marker: "#a15600"
  ptr-orange-wash: "#f8ead8"
  warn-ochre-light: "#8a5a00"
  warn-ochre-wash-light: "#f7eed8"
  bad-crimson-light: "#9b1c31"
  bad-crimson-wash-light: "#f7e1e5"
  sticky-yellow-light: "#ffe45c"
  sticky-edge-light: "#d9bd35"
  sticky-ink: "#2b2508"
  syntax-keyword-light: "#7a3cc9"
  syntax-string-light: "#137a52"
  syntax-number-light: "#a85a00"
  syntax-comment-light: "#63666b"
  # Slate (dark): green-black chalkboard, coloured chalk
  slate-board: "#1c2824"
  slate-raised: "#22302b"
  slate-sunk: "#17221e"
  chalk-ink: "#ede9dd"
  chalk-ink-soft: "#b6beb6"
  chalk-ink-faint: "#96a29b"
  slate-rail: "#33433d"
  slate-rail-strong: "#6b7a74"
  run-yellow-chalk: "#f4d35e"
  run-yellow-wash: "#37392a"
  on-run-dark: "#1c2824"
  ret-pink-chalk: "#f49ac1"
  ret-pink-wash: "#3b2c35"
  done-green-chalk: "#a7d98b"
  done-green-chalk-wash: "#283a2b"
  ptr-sky-chalk: "#8ecae6"
  ptr-sky-wash: "#233746"
  warn-ochre-dark: "#e8c07a"
  warn-ochre-wash-dark: "#3d3023"
  bad-coral-dark: "#ff8577"
  bad-coral-wash-dark: "#432a2a"
  sticky-yellow-dark: "#f2d64b"
  sticky-edge-dark: "#b99f22"
  syntax-keyword-dark: "#8ecae6"
  syntax-type-dark: "#c7aaff"
  syntax-string-dark: "#a7d98b"
  syntax-number-dark: "#f6a95b"
  syntax-comment-dark: "#8d9993"
typography:
  display:
    fontFamily: "'Bricolage Grotesque Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "clamp(32px, 4.4vw, 56px)"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "'Bricolage Grotesque Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  title:
    fontFamily: "'Bricolage Grotesque Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "14.5px"
    fontWeight: 700
    letterSpacing: "-0.01em"
  body:
    fontFamily: "'Bricolage Grotesque Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "'Bricolage Grotesque Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 600
    lineHeight: 1.2
  code:
    fontFamily: "'JetBrains Mono', Consolas, 'Liberation Mono', monospace"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.85
    fontFeature: "\"liga\" 0, \"calt\" 0"
  code-node:
    fontFamily: "'JetBrains Mono', Consolas, 'Liberation Mono', monospace"
    fontSize: "16px"
    fontWeight: 700
  hand:
    fontFamily: "'Patrick Hand', 'Segoe Print', cursive"
    fontSize: "19px"
    fontWeight: 400
    lineHeight: 1.25
  hand-sketch:
    fontFamily: "'Patrick Hand', 'Segoe Print', cursive"
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1.05
rounded:
  box: "10px 12px 9px 11px"
  btn: "9px 11px 8px 10px"
  note: "2px 2px 3px 12px"
  node: "10px"
  cell: "6px"
  pill: "999px"
spacing:
  gap-tight: "6px"
  gap: "10px"
  panel-inset: "18px"
  rail-inset: "20px"
  board-gutter: "28px"
  board-top: "40px"
  editor-column: "1180px"
components:
  button-chalk:
    backgroundColor: "transparent"
    textColor: "{colors.marker-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.btn}"
    padding: "7px 12px"
    height: "36px"
  button-run:
    backgroundColor: "{colors.run-blue-marker}"
    textColor: "{colors.on-run-light}"
    rounded: "{rounded.btn}"
    padding: "10px 22px"
    height: "48px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.marker-ink-soft}"
    rounded: "{rounded.btn}"
    padding: "6px 9px"
  tab:
    backgroundColor: "transparent"
    textColor: "{colors.marker-ink-soft}"
    padding: "12px 11px 10px"
  tab-selected:
    textColor: "{colors.marker-ink}"
  call-bubble:
    backgroundColor: "transparent"
    textColor: "{colors.marker-ink}"
    rounded: "{rounded.box}"
    padding: "12px 14px"
  call-bubble-running:
    backgroundColor: "{colors.run-blue-wash}"
    rounded: "{rounded.box}"
  tree-node-running:
    backgroundColor: "{colors.run-blue-wash}"
    textColor: "{colors.marker-ink}"
    typography: "{typography.code-node}"
    rounded: "{rounded.node}"
  sticky-note:
    backgroundColor: "{colors.sticky-yellow-light}"
    textColor: "{colors.sticky-ink}"
    typography: "{typography.hand}"
    rounded: "{rounded.note}"
    padding: "5px 12px 6px"
  code-field:
    backgroundColor: "{colors.enamel-sunk}"
    textColor: "{colors.marker-ink}"
    typography: "{typography.code}"
    rounded: "{rounded.box}"
    padding: "12px 13px"
  crumb:
    backgroundColor: "{colors.enamel-board}"
    textColor: "{colors.marker-ink-soft}"
    rounded: "{rounded.btn}"
    padding: "2px 9px"
  pointer-chip:
    backgroundColor: "transparent"
    textColor: "{colors.ptr-orange-marker}"
    rounded: "{rounded.pill}"
    padding: "1px 8px"
---

# Design System: StackBloom

## Overview

**Creative North Star: "The Lecture Board"**

The run is written up on a lecture board, one call at a time. In dark mode the board is a green-black slate with faint chalk dust (a 7px by 9px dot field at 3.5% chalk). In light mode it is a white enamel whiteboard written in marker ink with no dust. The two themes are one system: the same roles and the same law, swapped by `prefers-color-scheme`. The board is split into panels by thin aluminium rails. Every rule is a single stroke. Explanations sit on yellow sticky notes stuck to the board. The interface is not made of cards floating over a page.

This is a working surface for long study sessions, so it is dense and quiet. The running call leads and everything else recedes. Colour is scarce because each board colour has exactly one meaning. State is written as a mark (a box, an underline, a tick, a hand-lettered note), so the board still reads with colour removed. The world rejects the debugger-dashboard look: grey cards, icon toolbars, a blue accent on everything, drop-shadowed panels.

Motion follows the chalk. A new call is written onto the board, and a returned value rises back to its caller. Motion only happens on deliberate forward steps, and reduced motion keeps the fades while dropping all movement.

**Key Characteristics:**
- Slate chalkboard (dark) and enamel whiteboard (light) share one role set and one colour law.
- Four board colours, each with one meaning: run, ret, done, ptr. Everything else is ink.
- State is a mark, not a hue: box, underline, tick-and-dim, ×N, ✕, wavy underline with a "was" note.
- One-stroke chrome: 1.5px chalk outlines, 2px rails, slightly irregular corners, no card shadows.
- Three voices: Bricolage Grotesque for the interface, JetBrains Mono (no ligatures) for code, Patrick Hand for board annotations only.
- Yellow sticky notes carry every explanation and the step-by-step narration.

## Colors

The palette is chalk on slate or marker on enamel. Colour is reserved for meaning and never used for decoration.

### Primary
- **Run: Blue Marker / Yellow Chalk** (#1f56d0 light, #f4d35e dark): means *now*. It marks the running call (its box, its tree node, the chalked path from `main` to it, the current breadcrumb, the active source line), the action that runs (Run & visualize, the scrubber thumb), and the learner's current position (focus ring, caret, text selection, selected tab underline, graph-overview viewport). Its washes (#dfe8fb, #37392a) fill the running node and bubble. Text on solid run uses on-run (#ffffff light, #1c2824 dark).

### Secondary
- **Return: Red Marker / Pink Chalk** (#c8302a light, #f49ac1 dark): a value coming back. Used for the hand-lettered `↑ value` beside returning edges and for return marks in the event strip. Nothing else is written in ret.

### Tertiary
- **Done: Green Marker / Green Chalk** (#137a52 light, #a7d98b dark): finished or new. Used for ticks on returned calls, freshly allocated heap boxes, the changed-value tag, program exit, the success summary, and the sprout's leaves.
- **Pointer: Orange Marker / Sky Chalk** (#a15600 light, #8ecae6 dark): pointers only. Used for heap arrows and arrowheads, stack-frame boxes in the memory graph, pointer chips, pointer state text, and memory events.

### Neutral
- **Enamel / Slate board** (#f5f5f1 / #1c2824): the board itself, behind every panel. The page and panels share it, so nothing sits on a card.
- **Raised** (#fdfdfb / #22302b): popovers, SVG node and box interiors, the graph overview.
- **Sunk** (#ecece6 / #17221e): the chalk tray (timeline), the run dock, and code fields.
- **Ink** (#1c1d20 / #ede9dd): primary text and default strokes. It is also the colour of inspection (dashed) and of changed values (bold with a wavy underline).
- **Ink soft** (#52555b / #b6beb6): secondary text, labels, inactive tabs.
- **Ink faint** (#63666b / #96a29b): line numbers, unset values, finished-node strokes, null pointers.
- **Rail / Rail strong** (#d6d8d8 / #33433d, #a4a8ab / #6b7a74): hairline dividers inside panels, and the heavier rails between boards (top rail, tray edge, split handle).

### Off-board and paper
- **Warn** (#8a5a00 / #e8c07a) and **Bad** (#9b1c31 / #ff8577), with washes: off the board. Used only for program errors (compile errors, signals, tracer errors, interrupted calls) and limits (stop limit, timeout, unsupported). Never a call or value state.
- **Sticky yellow** (#ffe45c / #f2d64b) with its edge (#d9bd35 / #b99f22) and ink (#2b2508): the paper of sticky notes only.
- **Syntax** (keyword #7a3cc9 / #8ecae6, type #c7aaff dark, string #137a52 / #a7d98b, number #a85a00 / #f6a95b, comment #63666b / #8d9993): code colouring inside code text. It sits outside the colour law and must never tint board chrome.

### Named Rules
**The One Meaning Rule.** Each board colour means one thing: run = now, ret = a value coming back, done = finished or new, ptr = pointers. Everything else is ink. If a new element needs colour and fits none of the four meanings, it is ink.

**The Off-Board Rule.** Warn and bad describe the program's failures and the run's limits. They never describe a call, a value or a pointer.

**The No Accent Rule.** The board has no purple and no spare accent. Inspecting a call or line is drawn as a dashed ink outline or underline, never as a new hue.

## Typography

**Interface Font:** Bricolage Grotesque Variable (fallback Segoe UI, system-ui), with optical sizing on
**Code Font:** JetBrains Mono 400/600 (fallback Consolas, Liberation Mono), ligatures off everywhere
**Annotation Font:** Patrick Hand (fallback Segoe Print, cursive)

**Character:** The grotesque is lively and slightly quirky, which keeps the chrome human without getting cute. The mono is neutral and exact for code and values. Patrick Hand is the teacher's handwriting on the board. It is only used for what a teacher would write by hand: return marks, ×N, "← running", branch labels, sticky-note narration, sketch titles, and empty states.

### Hierarchy
- **Display** (800, clamp(32px, 4.4vw, 56px), 1.02, -0.035em, max 14ch): the editor headline chalked across the board. Once per screen.
- **Headline** (800, 22px, 1.1, -0.03em): the StackBloom wordmark in the top rail. Editor section heads use 800 at 20px.
- **Title** (700, 14.5px): panel titles and tabs (tabs are 650).
- **Body** (400, 15px, 1.55): base text. Editor intro copy is 17px at 46ch.
- **Label** (600, 13.5px, 1.2): buttons (14px), field labels, status words. Meta text is 12.5–13px in ink soft.
- **Code** (400, 14px, 1.85 in the trace source; 1.7 in the editor): source lines, locals, values. Tree node labels are 16px (15px compact) at 700; memory box rows are 13.5px.
- **Hand** (400, 17–19px; 24px for sketch titles and summary words): board annotations and sticky notes.

### Named Rules
**The Three Voices Rule.** Interface chrome speaks in the grotesque, the program speaks in mono, and the teacher speaks in hand. Hand titles belong to sketches, sticky notes and the run summary; never set a control, a value, a panel title, a tab or the wordmark in Patrick Hand, and never hand-letter code.

**The No Ligatures Rule.** Code is shown exactly as typed. `font-variant-ligatures: none` applies to every code surface, including CodeMirror.

## Layout

There are two full-height screens, and the page itself does not scroll on desktop (`100dvh`, with panels scrolling on their own).

- **Editor:** a centred 1180px column with 40px top and 28px gutters. The headline and intro sit above a 2px rail. The four examples are chalk sketches in a four-column grid (two columns below 1080px) rather than cards. The code field and input sit in a 2 : 0.85 split that stacks below 720px. A fixed **run dock** (the chalk tray) holds the primary action so it never scrolls away.
- **Trace:** a single **trace rail** at the top holds the brand, execution context, transport controls and file actions. Below 1600px the button labels collapse to icons (names kept for screen readers). Below 1280px the transport wraps to a second row. The workspace splits code | board at a resizable 42% default above 980px, with the 2px rail as the drag handle. Below 980px code and board stack in rows. The **chalk tray** runs along the bottom and is split into an event strip and a scrubber strip that share one column grid, so event marks line up with the scrubber.
- **Phones (≤720px):** the page scrolls. Top-rail actions become icons, the tree legend is hidden (its meanings live in the info note), and the scrubber strip stays sticky at the bottom edge while the event marks follow at the end of the page.
- **Rhythm:** 6px tight gaps, 10px gaps, 18px panel insets, 20px rail insets, 28px board gutters.

## Elevation & Depth

The board is flat. Depth comes from rails and tone: raised surfaces are slightly lighter than the board, and sunk surfaces (tray, dock, code fields) are slightly darker. Only paper and popovers lift off the board.

### Shadow Vocabulary
- **Lift** (`0 14px 28px -16px rgba(28,29,32,.38)` light, `0 16px 30px -16px rgba(0,0,0,.7)` dark): popovers (jump menu, recent runs) and the graph overview.
- **Sticky paper** (`0 1px 0 var(--note-edge), 0 12px 22px -14px rgba(0,0,0,.55)`): sticky notes only. The 1px edge is the paper's thickness, and the notes are tilted between -1° and 1.5°.

### Named Rules
**The One Stroke Rule.** Panels, bubbles, fields and buttons are drawn with a single stroke (1.5px chalk outline at 35–50% ink, 2px rails between boards, 1px hairlines inside panels) and never with a shadow. If something needs to stand out, give it a stroke or a mark, not a lift.

## Shapes

Chalk boxes are never quite square. Board boxes use a slightly uneven radius (10px 12px 9px 11px) and buttons a smaller uneven one (9px 11px 8px 10px). Sticky notes are nearly square with one curled corner (2px 2px 3px 12px). SVG tree nodes and memory boxes use a 10px radius, array cells 6px. Pills (999px) are kept for badges, chips and state tags. Icons are a single hand-drawn set on a 24px grid, drawn with one round-capped 1.9px stroke like a marker line. The brand mark is the sprout: a stem, two green leaves and a line of soil, all in ink stroke.

## Components

### Buttons
Chalk-outline, tactile, never filled unless they run something.
- **Shape:** uneven button radius (9px 11px 8px 10px), 1.5px outline at 50% ink, 36px minimum height (44px under `pointer: coarse`).
- **Primary (run):** solid run with on-run text. Used for the action that runs (Run & visualize: 48px tall, 220px minimum, 16px/700).
- **Hover / Press:** hover only under `(hover: hover) and (pointer: fine)`: a 7% ink wash and a full-ink outline. Primary hover darkens run with 14% ink. Every press scales to 0.97 over 140ms with the out-curve. Disabled buttons are at 38% opacity.
- **Ghost:** no outline, ink soft. The toggled state is ink with a 2.5px run underline.

### Chips and tags
- **Style:** pill with a 1.5px `currentColor` outline and no fill. The colour follows the law: pointer chips in ptr, the change tag in done, the running call's state tag filled solid run.
- **State:** dashed outline for dangling (ink), null or unknown (ink faint), and stack pointers. The inspection chip is dashed ink.

### Cards / Containers
- **Corner Style:** box radius (10px 12px 9px 11px).
- **Background:** the board itself, so containers are outlines, not fills. Sunk tone is used for code fields and the tray.
- **Shadow Strategy:** none (see The One Stroke Rule).
- **Border:** 1.5px at 35–45% ink.
- **Internal Padding:** 12px 14px.
- Locals inside a call are rows separated by dashed rails, not boxes inside a box.

### Inputs / Fields
- **Style:** sunk tone, 1.5px outline at 35% ink, box radius, mono 14px at 1.6–1.7. The caret is run, 2px wide.
- **Focus:** 2px run outline, offset 1–2px.
- **Error:** compiler issues use a bad outline on a bad wash, with line links. Editor squiggles use the issue washes.

### Navigation
- **Top rail:** sprout mark and 22px wordmark, then the file name in mono at 12.5px, with a 2px strong rail beneath.
- **Tabs:** unboxed text at 14.5px/650 in ink soft. The selected tab is ink with a 3px run underline, and its count badge fills solid run.
- **Breadcrumb:** the call path (`main › … › current`) chalked along the foot of the tree board in mono 13px. Each crumb has a thin button-radius outline, and the current crumb has a 2px run outline at 700.

### Call state marks (signature)
The tree and the stack write state as marks:
- **Running:** boxed in run (3.2px stroke on the run wash in the tree, a 2.5px bubble border in the stack), with a hand-lettered "← running" beside it and the edge path from `main` in 3.2px run.
- **Waiting:** label underlined.
- **Returned:** green tick, dimmed to 62%, with `↑ value` in ret beside its edge.
- **Repeated arguments:** hand-lettered `×N` in ink.
- **Dangling pointer:** `✕ dangling` in ink with a dashed outline.
- **Changed value:** bold with a wavy 1.5px ink-soft underline and a hand-lettered "was ~~old~~" note.
- **Inspected:** dashed ink outline, never a hue.
- **Legends:** legends draw the real marks (the same strokes, ticks and hand lettering) instead of colour swatches.

### Sticky notes
Yellow paper with the sticky paper shadow. The step note narrates the last step in Patrick Hand at 19px; it is pinned to the tree board's top-right corner (230px wide, tilted 1.5°), lets clicks pass through to the tree, and Follow call treats that corner as covered. On phones it sits inline above the board, tilted -0.6°. Info tips open as 330px notes from a 30px round trigger and scale in from the trigger corner. The editor's run explainer is a note with a 24px hand title.

### Chalk tray
The sunk strip along the bottom holds the event strip and the scrubber. Event marks use law colours by kind: ink-soft ticks for steps, ret ticks for returns, ptr diamonds for memory, done dots for output, and taller bad ticks for errors. Below them sit a depth sparkline in ink and a range input with an 18px run thumb.

### Motion
- **Curves:** out `cubic-bezier(0.23, 1, 0.32, 1)`; in-out `cubic-bezier(0.77, 0, 0.175, 1)`. Only transform and opacity are animated.
- **Press:** scale(0.97), 140ms.
- **Popovers and notes:** `@starting-style` from scale(0.96) (0.95 for notes) with opacity 0, 180ms, from the trigger corner.
- **Trace signature:** on a deliberate forward step only (steps less than 250ms apart count as a burst and skip it), the edge grows from its caller (grow-edge, 160ms), the node is written in (write-in, 180ms, 40ms delay), and a returned value rises toward its caller (rise, 200ms, 40ms delay). New heap edges use grow-edge, and moved memory boxes glide 250ms on the in-out curve.
- **Editor signature:** the board opens once: the headline, then the four sketches (board-open, 300ms, staggered 60/110/160/210ms).
- **Reduced motion:** every signature animation becomes an opacity fade, press scaling and box gliding are removed, pulses stop, and popovers fade without scaling.

## Do's and Don'ts

### Do:
- **Do** pick board colour by meaning only: run = now, ret = a value coming back, done = finished or new, ptr = pointers, everything else ink.
- **Do** give every state a mark (box, underline, tick-and-dim, ×N, ✕, wavy underline and "was") so it reads without colour.
- **Do** draw chrome with one stroke: 1.5px chalk outlines at the uneven radii (10px 12px 9px 11px boxes, 9px 11px 8px 10px buttons), 2px rails between boards.
- **Do** put explanations on sticky notes, in place, next to what they explain.
- **Do** keep every text token at 4.5:1 or better on board, raised and sunk surfaces in both themes.
- **Do** keep graph text at 12px or larger on screen (minimum fit 0.9 for memory, 0.8 for the recursion tree); past that the graph scrolls.
- **Do** make every control at least 44px under `pointer: coarse`, and gate hover effects behind `(hover: hover) and (pointer: fine)`.
- **Do** keep one signature moment per screen, play it on deliberate steps only, and fall back to opacity under reduced motion.

### Don't:
- **Don't** use warn or bad for a call, value or pointer state; they are for program errors and limits only.
- **Don't** add purple or any spare accent to the board; inspection is dashed ink.
- **Don't** give panels, bubbles or buttons drop shadows; only sticky notes and popovers lift.
- **Don't** set controls, values, panel titles or tabs in Patrick Hand, or let syntax colours tint board chrome.
- **Don't** enable code ligatures.
- **Don't** animate hover on touch devices, or play the write-in during held-key bursts.
