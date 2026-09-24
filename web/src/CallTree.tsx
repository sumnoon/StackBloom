import {useEffect, useMemo, useRef, useState} from 'react';
import {callHistory, type CallNode} from './callHistory';
import {GraphOverview} from './GraphOverview';
import {InfoTip} from './InfoTip';
import type {Trace, Frame} from './trace';
import {useZoom, ZoomControl} from './zoom';

type Dims = {width: number; height: number; gap: number; level: number};
// Full nodes carry a status line; compact ones are a single, larger line for wide trees.
const FULL: Dims = {width: 148, height: 58, gap: 22, level: 106};
const COMPACT: Dims = {width: 116, height: 38, gap: 12, level: 70};
const MAX_NODES = 250;
// Below this, labels stop being readable: the tree scrolls instead, following the running call.
const MIN_FIT = 0.6;
// Switch to compact nodes when full ones would have to shrink this far to fit.
const COMPACT_BELOW = 0.8;
// Compact labels: 15px monospace is about 8.3px per character.
const COMPACT_CHARS = 24, CHAR_WIDTH = 8.4;
// Room taken by the graph overview in the canvas corner, plus a margin.
const OVERVIEW = {width: 180, height: 150};

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

export function CallTree({trace, index, onSelect, selectedCall}: {trace: Trace; index: number; onSelect: (frame: Frame, index: number) => void; selectedCall: string | null}) {
  // Off lets the reader pan freely while stepping; on keeps the running call in view.
  const [follow, setFollow] = useState(true);
  // Placeholder extents; the real ones are known once the layout below is built.
  const [extent, setExtent] = useState({width: 0, height: 0});
  const {ref, zoom, mode, setMode, fit, box} = useZoom(extent.width, extent.height, MIN_FIT);
  const previousStop = useRef({trace, index});
  const forwardStep = previousStop.current.trace === trace && index === previousStop.current.index + 1;
  useEffect(() => {previousStop.current = {trace, index};}, [trace, index]);
  const returnedNow = new Map((trace.snapshots[index].returns ?? []).map(item => [item.call_id, item.value]));
  const history = useMemo(() => callHistory(trace, index), [trace, index]);
  // Cap the drawing independently of the trace budget to bound SVG/layout work.
  const visible = [...history.nodes.values()].slice(0, MAX_NODES);
  const order = new Map(visible.map((node, i) => [node.id, i + 1]));
  const full = layout(history, order, FULL);
  const fullFit = box.width ? Math.min(1, (box.width - 18) / full.width, (box.height - 18) / full.height) : 1;
  const compact = (mode === 'fit' ? fullFit : zoom) < COMPACT_BELOW;
  // Compact nodes are as wide as their longest label (up to a cap), so "insert(null, 5) → a3"
  // is never cut to "insert(null, …": the arguments are the point of the label.
  const longest = Math.min(COMPACT_CHARS, Math.max(8, ...visible.map(node => compactLabel(node).length)));
  const compactDims = {...COMPACT, width: Math.round(longest * CHAR_WIDTH + 24)};
  const dims = compact ? compactDims : FULL;
  const {positions, labels, width, height} = compact ? layout(history, order, compactDims) : full;
  const frequencies = new Map<string, number>();
  visible.forEach(node => frequencies.set(node.label, (frequencies.get(node.label) ?? 0) + 1));
  const seek = (node: CallNode) => onSelect(node.frame, node.last);
  const active = visible.find(node => node.state === 'active');
  const activePath = new Set<string>();
  for (let node = active; node; node = node.parent ? history.nodes.get(node.parent) : undefined) activePath.add(node.id);
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
    const inView = x > canvas.scrollLeft + 40 && x < right - 40
      && y > canvas.scrollTop && y < bottom - 60 && !underOverview;
    if (!inView) canvas.scrollTo({left: x - canvas.clientWidth / 2, top: y - canvas.clientHeight / 3});
  }, [index, zoom, compact, active?.id, follow]);

  return <section className="history-tree" aria-label="Recursion call tree">
    <div className="panel-title"><h2>Recursion tree</h2><span>{history.nodes.size} calls recorded so far</span></div>
    <div className="tree-controls">
      <div className="tree-legend"><span className="active">Executing</span><span className="waiting">Waiting</span><span className="completed">Returned</span><span className="repeat">Repeated arguments</span></div>
      <div className="panel-title-actions">
        <label className="follow-call"><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} />Follow call</label>
        <ZoomControl label="Tree zoom" mode={mode} setMode={setMode} fit={fit} />
        <InfoTip label="About the recursion tree">Each call branches down into the calls it makes, in call order: with
          two calls the first is the left branch (L) and the second the right (R). L and R follow call order, not field
          names, so code that calls the right subtree first draws it on the left. Returned calls stay visible with their
          return value, and a green outline marks calls with the same arguments as another — a hint, not proof, of a
          repeated subproblem. Select a call to revisit its last stop. Large trees switch to compact nodes and follow
          the running call.</InfoTip>
      </div>
    </div>
    {history.approximate && <p className="note">Legacy trace: call boundaries are approximate. Run the code again for invocation tracking.</p>}
    <div className="graph-stage"><div className="tree-canvas" ref={ref} tabIndex={0} aria-label="Scrollable call tree">
      {visible.length ? <svg width={width * zoom} height={height * zoom} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Function invocation tree">
        <defs><marker id="call-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" className="tree-arrow" /></marker></defs>
        {visible.filter(node => node.parent && positions.has(node.parent)).map(node => {
          const from = positions.get(node.parent!)!, to = positions.get(node.id)!;
          const label = labels.get(node.id);
          const mx = (from.x + to.x) / 2, my = (from.y + dims.height + to.y) / 2;
          return <g key={`edge-${node.id}`} className={`tree-edge ${activePath.has(node.id) ? 'active-path' : ''} ${forwardStep && node.first === index ? 'call-arriving' : ''}`}>
            {returnedNow.has(node.id) && <g className="return-label" transform={`translate(${mx},${my})`}>
              <rect x="-40" y="-12" width="80" height="24" rx="12" />
              <text textAnchor="middle" dy="4">↥ {truncate(returnedNow.get(node.id) ?? 'return', 10)}</text>
              <title>Returned {returnedNow.get(node.id) ?? '(value unavailable)'} to {history.nodes.get(node.parent!)?.label}</title>
            </g>}
            {forwardStep && returnedNow.has(node.id) && <circle key={`${index}-return`} className="return-traveller" r="4">
              <animateMotion dur="0.35s" path={`M${to.x},${to.y - 5} L${from.x},${from.y + dims.height}`} fill="freeze" />
            </circle>}
            <path d={`M${from.x},${from.y + dims.height} L${to.x},${to.y - 5}`} markerEnd="url(#call-arrow)" />
            {label && !returnedNow.has(node.id) && <g transform={`translate(${mx},${my})`}><circle r="10" /><text textAnchor="middle" dy="4">{label}</text></g>}
          </g>;
        })}
        {visible.map(node => {
          const p = positions.get(node.id)!;
          const repeated = node.frame.locals.some(local => local.is_argument) && (frequencies.get(node.label) ?? 0) > 1;
          return <g key={node.id} transform={`translate(${p.x - dims.width / 2},${p.y})`} className={`history-node ${node.state} ${selectedCall === (node.frame.call_id ?? node.frame.id) ? 'inspected-call' : ''} ${forwardStep && node.first === index ? 'call-arriving' : ''}`} role="button" tabIndex={0} aria-pressed={selectedCall === (node.frame.call_id ?? node.frame.id)}
            aria-label={`${node.label}, ${statusText(node)}, visit stop ${node.last + 1}`} onClick={() => seek(node)} onKeyDown={e => {if (e.key === 'Enter' || e.key === ' ') {e.preventDefault(); e.stopPropagation(); seek(node);}}}>
            <title>{node.label} · {statusText(node)} · call #{order.get(node.id)}</title>
            {repeated && <rect x="-5" y="-5" width={dims.width + 10} height={dims.height + 10} rx={compact ? 16 : 26} className="repeat-halo" />}
            <rect width={dims.width} height={dims.height} rx={compact ? 12 : 20} className="node-body" />
            {compact
              ? <text x={dims.width / 2} y={dims.height / 2 + 5} textAnchor="middle" className="node-label compact">
                  {truncate(compactLabel(node), COMPACT_CHARS)}</text>
              : <>
                  <text x={dims.width / 2} y="24" textAnchor="middle" className="node-label">{truncate(node.label, 21)}</text>
                  <text x={dims.width / 2} y="43" textAnchor="middle" className="node-status">{statusText(node)} · #{order.get(node.id)}</text>
                </>}
          </g>;
        })}
      </svg> : <p className="empty">No recorded calls at this stop.</p>}
    </div>
    <GraphOverview canvas={ref} width={width} height={height} zoom={zoom}
      nodes={[...positions.values()].map(p => ({x:p.x - dims.width / 2, y:p.y, width:dims.width, height:dims.height}))} />
    </div>
    {visible.length < history.nodes.size && <p className="note">Showing the first {MAX_NODES} calls. Step backward to explore earlier execution.</p>}
  </section>;
}
