import {useMemo, useState} from 'react';
import {callHistory, type CallNode} from './callHistory';
import type {Trace} from './trace';

const WIDTH = 148, HEIGHT = 58, GAP = 22, LEVEL = 106, MAX_NODES = 250;

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

export function CallTree({trace, index, onSeek}: {trace: Trace; index: number; onSeek: (index: number) => void}) {
  const [zoom, setZoom] = useState(1);
  const history = useMemo(() => callHistory(trace, index), [trace, index]);
  // Cap the drawing independently of the trace budget to bound SVG/layout work.
  const visible = [...history.nodes.values()].slice(0, MAX_NODES);
  const order = new Map(visible.map((node, i) => [node.id, i + 1]));
  const positions = new Map<string, {x: number; y: number}>();
  const labels = new Map<string, string>();
  let leaf = 0;
  function place(id: string, depth: number): number {
    const node = history.nodes.get(id)!;
    const children = node.children.filter(child => order.has(child));
    children.forEach((child, i) => labels.set(child, branchLabel(i, children.length)));
    const xs = children.map(child => place(child, depth + 1));
    const x = xs.length ? (xs[0] + xs[xs.length - 1]) / 2 : leaf++ * (WIDTH + GAP) + WIDTH / 2 + 24;
    positions.set(id, {x, y: depth * LEVEL + 24});
    return x;
  }
  history.roots.filter(root => order.has(root.id)).forEach(root => place(root.id, 0));
  const width = Math.max(350, leaf * (WIDTH + GAP) + 48);
  const height = Math.max(200, ...[...positions.values()].map(p => p.y + 100));
  const frequencies = new Map<string, number>();
  visible.forEach(node => frequencies.set(node.label, (frequencies.get(node.label) ?? 0) + 1));
  const seek = (node: CallNode) => onSeek(node.last);

  return <section className="history-tree" aria-label="Recursion call tree">
    <div className="panel-title"><h2>Recursion tree</h2><span>{history.nodes.size} calls recorded so far</span></div>
    <div className="tree-controls">
      <div className="tree-legend"><span className="active">Executing</span><span className="waiting">Waiting</span><span className="completed">Returned</span><span className="repeat">Repeated arguments</span></div>
      <label>Zoom <select aria-label="Tree zoom" value={zoom} onChange={e => setZoom(Number(e.target.value))}><option value={0.35}>35%</option><option value={0.6}>60%</option><option value={1}>100%</option><option value={1.4}>140%</option></select></label>
    </div>
    <p className="note">Each call branches downward into the calls it makes, in call order: with two calls, the first is the left branch (L) and the second the right (R). Returned calls stay visible with their return value. Select a node to revisit its last recorded stop.</p>
    {history.approximate && <p className="note">Legacy trace: call boundaries are approximate. Run the code again for invocation tracking.</p>}
    <div className="tree-canvas" tabIndex={0} aria-label="Scrollable call tree">
      {visible.length ? <svg width={width * zoom} height={height * zoom} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Function invocation tree">
        <defs><marker id="call-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" className="tree-arrow" /></marker></defs>
        {visible.filter(node => node.parent && positions.has(node.parent)).map(node => {
          const from = positions.get(node.parent!)!, to = positions.get(node.id)!;
          const label = labels.get(node.id);
          const mx = (from.x + to.x) / 2, my = (from.y + HEIGHT + to.y) / 2;
          return <g key={`edge-${node.id}`} className="tree-edge">
            <path d={`M${from.x},${from.y + HEIGHT} L${to.x},${to.y - 5}`} markerEnd="url(#call-arrow)" />
            {label && <g transform={`translate(${mx},${my})`}><circle r="10" /><text textAnchor="middle" dy="4">{label}</text></g>}
          </g>;
        })}
        {visible.map(node => {
          const p = positions.get(node.id)!;
          const repeated = node.frame.locals.some(local => local.is_argument) && (frequencies.get(node.label) ?? 0) > 1;
          return <g key={node.id} transform={`translate(${p.x - WIDTH / 2},${p.y})`} className={`history-node ${node.state}`} role="button" tabIndex={0}
            aria-label={`${node.label}, ${statusText(node)}, visit stop ${node.last + 1}`} onClick={() => seek(node)} onKeyDown={e => {if (e.key === 'Enter' || e.key === ' ') {e.preventDefault(); e.stopPropagation(); seek(node);}}}>
            <title>{node.label} · {statusText(node)} · call #{order.get(node.id)}</title>
            {repeated && <rect x="-5" y="-5" width={WIDTH + 10} height={HEIGHT + 10} rx="26" className="repeat-halo" />}
            <rect width={WIDTH} height={HEIGHT} rx="20" className="node-body" />
            <text x={WIDTH / 2} y="24" textAnchor="middle" className="node-label">{truncate(node.label, 21)}</text>
            <text x={WIDTH / 2} y="43" textAnchor="middle" className="node-status">{statusText(node)} · #{order.get(node.id)}</text>
          </g>;
        })}
      </svg> : <p className="empty">No recorded calls at this stop.</p>}
    </div>
    {visible.length < history.nodes.size && <p className="note">Showing the first {MAX_NODES} calls. Step backward to explore earlier execution.</p>}
    <p className="note">Green outlines mark matching observed arguments, not proof of equivalent subproblems. L/R follow call order, not field names: if code calls the right subtree first, it is drawn on the left.</p>
  </section>;
}
