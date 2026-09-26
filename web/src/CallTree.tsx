import {useEffect, useMemo, useRef, useState} from 'react';
import {callHistory, type CallNode} from './callHistory';
import {GraphOverview} from './GraphOverview';
import {InfoTip} from './InfoTip';
import {TreeLegend} from './Legend';
import {RepeatReport, repeatedWork, type WorkSummary} from './RepeatReport';
import type {Trace, Frame} from './trace';
import {useZoom, ZoomControl} from './zoom';

type Dims = {width: number; height: number; gap: number; level: number};
// Full nodes carry a status line; compact ones are a single, larger line for wide trees.
const FULL: Dims = {width: 168, height: 44, gap: 22, level: 96};
// Full labels: 16px bold monospace is about 9.7px per character.
const FULL_CHARS = 15;
const COMPACT: Dims = {width: 116, height: 38, gap: 12, level: 70};
const MAX_NODES = 250;
// Below this, labels stop being readable: the tree scrolls instead, following the running call.
// 0.8 keeps 15px compact labels at 12px or more on screen.
const MIN_FIT = 0.8;
// Switch to compact nodes when full ones would have to shrink this far to fit.
const COMPACT_BELOW = 0.8;
// Compact labels: 15px monospace is about 8.3px per character.
const COMPACT_CHARS = 24, CHAR_WIDTH = 8.4;
// Steps closer together than this are a burst, not a step to watch.
const RAPID_STEP_MS = 250;
// Width added to compact nodes so ×N never overprints the label.
const REPEAT_ROOM = 22;
// Width of the "← running" note beside the running node.
const RUNNING_ROOM = 96;
// Room taken by the graph overview in the canvas corner, plus a margin.
const OVERVIEW = {width: 180, height: 150};
// Room the step's sticky note takes in the canvas's top-right corner, plus a margin.
const NOTE = {width: 270, height: 110};

function truncate(text: string, length: number) {
  return text.length > length ? text.slice(0, length - 2) + '…' : text;
}

/** Order-based branch labels: first call is drawn left, second right. */
function branchLabel(position: number, siblings: number) {
  if (siblings === 2) return position === 0 ? 'L' : 'R';
  return siblings > 2 ? String(position + 1) : '';
}

function statusText(node: CallNode) {
  if (node.returned) return node.returnValue === null ? 'returned' : `returned ${truncate(node.returnValue, 14)}`;
  return node.state === 'active' ? 'executing' : node.state;
}

/** One line for a compact node: the call and, once it has returned, its result. */
function compactLabel(node: CallNode) {
  return node.label + (node.returned && node.returnValue !== null ? ` → ${truncate(node.returnValue, 8)}` : '');
}

/** One sentence for the sticky note: what the last step did, in the tree's own words. */
function stepNote(history: ReturnType<typeof callHistory>, returnedNow: Map<string, string | null | undefined>,
    active: CallNode | undefined, index: number) {
  for (const [id, value] of returnedNow) {
    const child = history.nodes.get(id);
    const parent = child?.parent ? history.nodes.get(child.parent) : undefined;
    if (!child) continue;
    const what = value == null ? 'returned' : `returned ${truncate(value, 14)}`;
    return parent ? `${child.label} ${what} to ${parent.label}.` : `${child.label} ${what}.`;
  }
  if (active) {
    const parent = active.parent ? history.nodes.get(active.parent) : undefined;
    // At a call's first stop its arguments are not read yet, so name the function instead of "fib(?)".
    const called = active.label.includes('?') ? active.frame.function : active.label;
    return active.first === index && parent ? `${parent.label} called ${called}.` : `${called} is running.`;
  }
  return history.nodes.size ? 'Every call has returned.' : '';
}

/** Tidy layout: leaves take the next column, parents centre over their children. */
function layout(history: ReturnType<typeof callHistory>, order: Map<string, number>, dims: Dims) {
  const positions = new Map<string, {x: number; y: number}>();
  const labels = new Map<string, string>();
  let leaf = 0;
  function place(id: string, depth: number): number {
    const node = history.nodes.get(id)!;
    const children = node.children.filter(child => order.has(child));
    children.forEach((child, i) => labels.set(child, branchLabel(i, children.length)));
    const xs = children.map(child => place(child, depth + 1));
    const x = xs.length ? (xs[0] + xs[xs.length - 1]) / 2 : leaf++ * (dims.width + dims.gap) + dims.width / 2 + 24;
    positions.set(id, {x, y: depth * dims.level + 24});
    return x;
  }
  history.roots.filter(root => order.has(root.id)).forEach(root => place(root.id, 0));
  const width = Math.max(350, leaf * (dims.width + dims.gap) + 48);
  const height = Math.max(200, ...[...positions.values()].map(p => p.y + dims.height + 42));
  return {positions, labels, width, height};
}

export function CallTree({trace, index, onSelect, selectedCall, baseline = null}: {trace: Trace; index: number;
    onSelect: (frame: Frame, index: number) => void; selectedCall: string | null; baseline?: WorkSummary | null}) {
  // The repeated-work report and the subproblem it spotlights in the tree.
  const [showRepeats, setShowRepeats] = useState(false);
  const [spotlight, setSpotlight] = useState<string | null>(null);
  // Off lets the reader pan freely while stepping; on keeps the running call in view.
  const [follow, setFollow] = useState(true);
  // Placeholder extents; the real ones are known once the layout below is built.
  const [extent, setExtent] = useState({width: 0, height: 0});
  const {ref, zoom, mode, setMode, fit, box} = useZoom(extent.width, extent.height, MIN_FIT);
  // Decided once per stop: the tree re-renders right after a step (zoom and extent settle),
  // and a comparison made in an effect would already call that second render "not a step".
  // Held-down stepping (key repeat) arrives faster than the write-in lasts: it skips the motion.
  const stepSeen = useRef({trace, index, forward: false, at: 0});
  if (stepSeen.current.trace !== trace || stepSeen.current.index !== index) {
    const now = performance.now(), last = stepSeen.current;
    stepSeen.current = {trace, index, at: now,
      forward: last.trace === trace && index === last.index + 1 && now - last.at > RAPID_STEP_MS};
  }
  const forwardStep = stepSeen.current.forward;
  const returnedNow = new Map((trace.snapshots[index].returns ?? []).map(item => [item.call_id, item.value]));
  const history = useMemo(() => callHistory(trace, index), [trace, index]);
  // Cap the drawing independently of the trace budget to bound SVG/layout work.
  const visible = [...history.nodes.values()].slice(0, MAX_NODES);
  const order = new Map(visible.map((node, i) => [node.id, i + 1]));
  const frequencies = new Map<string, number>();
  visible.forEach(node => frequencies.set(node.label, (frequencies.get(node.label) ?? 0) + 1));
  // Room for a hand-lettered ×N inside the node when any call repeats, so it never meets an edge label.
  const anyRepeat = visible.some(node => (frequencies.get(node.label) ?? 0) > 1 && node.frame.locals.some(local => local.is_argument));
  const fullDims = {...FULL, width: FULL.width + (anyRepeat ? REPEAT_ROOM : 0)};
  const full = layout(history, order, fullDims);
  const fullFit = box.width ? Math.min(1, (box.width - 34) / full.width, (box.height - 34) / full.height) : 1;
  const compact = (mode === 'fit' ? fullFit : zoom) < COMPACT_BELOW;
  // Compact nodes are as wide as their longest label (up to a cap), so "insert(null, 5) → a3"
  // is never cut to "insert(null, …": the arguments are the point of the label.
  const longest = Math.min(COMPACT_CHARS, Math.max(8, ...visible.map(node => compactLabel(node).length)));
  const compactDims = {...COMPACT, width: Math.round(longest * CHAR_WIDTH + 24 + (anyRepeat ? REPEAT_ROOM : 0))};
  const dims = compact ? compactDims : fullDims;
  const {positions, labels, width, height} = compact ? layout(history, order, compactDims) : full;
  const seek = (node: CallNode) => onSelect(node.frame, node.last);
  const active = visible.find(node => node.state === 'active');
  const activePath = new Set<string>();
  for (let node = active; node; node = node.parent ? history.nodes.get(node.parent) : undefined) activePath.add(node.id);
  const note = stepNote(history, returnedNow, active, index);
  const work = useMemo(() => repeatedWork(history.nodes.values()), [history]);
  // The breadcrumb reads the active path from main down to the running call.
  const crumbs: CallNode[] = [];
  for (let node = active; node; node = node.parent ? history.nodes.get(node.parent) : undefined) crumbs.unshift(node);
  useEffect(() => {
    if (extent.width !== width || extent.height !== height) setExtent({width, height});
  }, [width, height]);

  // When the tree is wider than the panel, keep the running call on screen.
  useEffect(() => {
    const canvas = ref.current;
    const at = active && positions.get(active.id);
    if (!canvas || !at || !follow) return;
    const x = at.x * zoom, y = at.y * zoom;
    const right = canvas.scrollLeft + canvas.clientWidth, bottom = canvas.scrollTop + canvas.clientHeight;
    // The bottom-right corner belongs to the overview, so a call parked under it counts as out of view.
    const underOverview = x > right - OVERVIEW.width && y > bottom - OVERVIEW.height;
    // So does the top-right corner, where the step's sticky note is pinned (phones keep it above the board).
    const pinned = canvas.clientWidth > 480;
    const underNote = pinned && x + dims.width * zoom / 2 > right - NOTE.width && y < canvas.scrollTop + NOTE.height;
    const inView = x > canvas.scrollLeft + 40 && x < right - 40
      && y > canvas.scrollTop && y < bottom - 60 && !underOverview && !underNote;
    if (!inView) canvas.scrollTo({left: x - canvas.clientWidth / 2, top: y - canvas.clientHeight / 3});
  }, [index, zoom, compact, active?.id, follow]);

  return <section className={`history-tree ${showRepeats && spotlight ? 'spotlit' : ''}`} aria-label="Recursion call tree">
    <div className="panel-title"><h2>Recursion tree</h2><span>{history.nodes.size} calls recorded so far</span></div>
    <div className="tree-controls">
      <TreeLegend />
      <div className="panel-title-actions">
        <button type="button" className={`ghost repeat-toggle ${showRepeats ? 'on' : ''}`} aria-expanded={showRepeats}
          title="How many calls recomputed a subproblem, and which ones"
          onClick={() => {setShowRepeats(value => !value); setSpotlight(null);}}>
          Repeated work{work.summary.wasted > 0 && <span className="repeat-count">{work.summary.wasted}</span>}</button>
        <label className="follow-call"><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} />Follow call</label>
        <ZoomControl label="Tree zoom" mode={mode} setMode={setMode} fit={fit} />
        <InfoTip label="About the recursion tree">Each call branches down into the calls it makes, in call order: with
          two calls the first is the left branch (L) and the second the right (R). L and R follow call order, not field
          names, so code that calls the right subtree first draws it on the left. The running call is boxed, waiting
          calls are underlined, and returned calls are ticked and dimmed, with ↑ beside the value each one returned.
          ×2 marks a call whose arguments were seen before — a hint, not proof, of a repeated subproblem. Select a
          call to revisit its last stop. Large trees switch to compact nodes and follow the running call.</InfoTip>
      </div>
    </div>
    {showRepeats && <RepeatReport rows={work.rows} summary={work.summary} baseline={baseline}
      spotlight={spotlight} onSpotlight={setSpotlight} />}
    {history.approximate && <p className="note">Legacy trace: call boundaries are approximate. Run the code again for invocation tracking.</p>}
    <div className="graph-stage">
    {/* Pinned to the board's top-right corner like a sticky note; clicks pass through to the tree. */}
    {note && <p className="step-note">{note}</p>}
    <div className="tree-canvas" ref={ref} tabIndex={0} aria-label="Scrollable call tree">
      {visible.length ? <svg width={width * zoom} height={height * zoom} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Function invocation tree">
        {visible.filter(node => node.parent && positions.has(node.parent)).map(node => {
          const from = positions.get(node.parent!)!, to = positions.get(node.id)!;
          const label = labels.get(node.id);
          const mx = (from.x + to.x) / 2, my = (from.y + dims.height + to.y) / 2;
          // Annotations sit beside the edge, on the side it leans toward, like chalk notes.
          const side = to.x < from.x ? -1 : to.x > from.x ? 1 : 0;
          const arriving = forwardStep && node.first === index;
          return <g key={`edge-${node.id}`} className={`tree-edge ${activePath.has(node.id) ? 'active-path' : ''} ${arriving ? 'call-arriving' : ''}`}>
            {/* The edge grows out of its caller, so the scale origin is the caller's end. */}
            <path d={`M${from.x},${from.y + dims.height} L${to.x},${to.y}`}
              style={arriving ? {transformOrigin: `${from.x}px ${from.y + dims.height}px`} : undefined} />
            {/* Every returned call carries ↑ and its value beside its edge; compact trees keep only the latest. */}
            {(returnedNow.has(node.id) || (!compact && node.returned)) && <g className={`return-label ${forwardStep && returnedNow.has(node.id) ? 'rising' : ''}`}
              transform={`translate(${mx + (side || 1) * 16},${my})`}>
              <text textAnchor={side < 0 ? 'end' : 'start'} dy="6">↑ {truncate((returnedNow.has(node.id) ? returnedNow.get(node.id) : node.returnValue) ?? 'returned', 12)}</text>
              <title>Returned {(returnedNow.has(node.id) ? returnedNow.get(node.id) : node.returnValue) ?? '(value unavailable)'} to {history.nodes.get(node.parent!)?.label}</title>
            </g>}
            {label && !returnedNow.has(node.id) && (compact || !node.returned) && <text className="branch-label" x={mx + side * 14} y={my} dy="5"
              textAnchor={side < 0 ? 'end' : 'start'}>{label}</text>}
          </g>;
        })}
        {visible.map(node => {
          const p = positions.get(node.id)!;
          const repeated = node.frame.locals.some(local => local.is_argument) && (frequencies.get(node.label) ?? 0) > 1;
          return <g key={node.id} transform={`translate(${p.x - dims.width / 2},${p.y})`} className={`history-node ${node.state} ${showRepeats && spotlight === node.label ? 'spotlight' : ''} ${selectedCall === (node.frame.call_id ?? node.frame.id) ? 'inspected-call' : ''} ${forwardStep && node.first === index ? 'call-arriving' : ''}`} role="button" tabIndex={0} aria-pressed={selectedCall === (node.frame.call_id ?? node.frame.id)}
            aria-label={`${node.label}, ${statusText(node)}, visit stop ${node.last + 1}`} onClick={() => seek(node)} onKeyDown={e => {if (e.key === 'Enter' || e.key === ' ') {e.preventDefault(); e.stopPropagation(); seek(node);}}}>
            <title>{node.label} · {statusText(node)} · call #{order.get(node.id)}</title>
            {/* The group above is placed by an SVG transform; motion runs on this inner group. */}
            <g className="node-ink">
              <rect width={dims.width} height={dims.height} rx="10" className="node-body" />
              {/* One line per call; its status lives in the marks, the tooltip and the accessible name. */}
              {/* The label centres in what is left after ×N (compact: right end; full: left end) and the tick. */}
              <text x={compact ? (dims.width - (anyRepeat ? REPEAT_ROOM : 0)) / 2
                : ((anyRepeat ? REPEAT_ROOM : 0) + dims.width - (node.state === 'completed' ? 18 : 0)) / 2} y={dims.height / 2 + 5.5} textAnchor="middle"
                className={`node-label ${compact ? 'compact' : ''}`}>
                {compact ? truncate(compactLabel(node), COMPACT_CHARS) : truncate(node.label, FULL_CHARS)}</text>
              {/* A returned call is ticked off inside its box, so "done" never rests on colour alone. */}
              {/* Compact labels already say "→ value", so only full nodes carry the tick. */}
              {!compact && node.state === 'completed' && <path className="node-tick" d={`M${dims.width - 22},${dims.height / 2} l4 4.5 l8.5 -9.5`} />}
              {/* ×N sits inside the node, where no edge or branch label goes: the right end of a compact
                  node, the left end of a full one (its tick takes the right). */}
              {repeated && (compact
                ? <text className="repeat-mark" x={dims.width - 6} y={dims.height / 2 + 5} textAnchor="end">×{frequencies.get(node.label)}</text>
                : <text className="repeat-mark" x="9" y={dims.height / 2 + 5}>×{frequencies.get(node.label)}</text>)}
              {/* Only where it fits: the box already marks the running call, the note is extra. */}
              {node.state === 'active' && p.x + dims.width / 2 + RUNNING_ROOM < width && <text className="running-mark" x={dims.width + 10} y={dims.height / 2 + 6}>← running</text>}
            </g>
          </g>;
        })}
      </svg> : <p className="empty">No recorded calls at this stop.</p>}
    </div>
    {crumbs.length > 0 && <nav className="call-crumbs" aria-label="Call path from main to the running call">
      {crumbs.length > 5 && <span className="crumb-more" aria-hidden="true">…</span>}
      {crumbs.slice(-5).map((node, i, shown) => <span key={node.id} className={`crumb ${i === shown.length - 1 ? 'current' : ''}`}
        aria-current={i === shown.length - 1 ? 'step' : undefined}>{truncate(node.label, 18)}</span>)}
    </nav>}
    <GraphOverview canvas={ref} width={width} height={height} zoom={zoom}
      nodes={[...positions.values()].map(p => ({x:p.x - dims.width / 2, y:p.y, width:dims.width, height:dims.height}))} />
    </div>
    {visible.length < history.nodes.size && <p className="note">Showing the first {MAX_NODES} calls. Step backward to explore earlier execution.</p>}
  </section>;
}
