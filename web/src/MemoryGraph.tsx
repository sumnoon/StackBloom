import {useMemo, useState} from 'react';
import type {HeapNode, PointerEdge, PointerState, Snapshot, Trace} from './trace';

const STACK_X = 24, STACK_WIDTH = 210, COLUMN = 250, NODE_WIDTH = 210;
const ROW = 20, HEADER = 30, GAP = 26, MAX_ROWS = 10;

type Slot = {key: string; x: number; y: number; height: number; rows: Map<string, number>};

const stateText: Record<PointerState, string> = {
  null: '∅ null', heap: '', stack: '↑ stack', dangling: '✕ dangling', unknown: '? unproven',
};

function nodeHeight(node: HeapNode) {
  return HEADER + Math.min(node.fields.length, MAX_ROWS) * ROW + 10;
}

/** Depth-first from the stack keeps siblings (left before right) in call order. */
function order(snapshot: Snapshot, roots: string[]) {
  const seen = new Set<string>();
  const depths = new Map<string, number>();
  const walk = (key: string, depth: number) => {
    if (seen.has(key) || !snapshot.heap[key]) return;
    seen.add(key);
    depths.set(key, depth);
    for (const field of snapshot.heap[key].fields)
      if (field.state === 'heap' && field.target) walk(field.target, depth + 1);
  };
  roots.forEach(root => walk(root, 0));
  Object.keys(snapshot.heap).forEach(key => walk(key, 0));
  return depths;
}

export function MemoryGraph({trace, index}: {trace: Trace; index: number}) {
  const [zoom, setZoom] = useState(1);
  const snapshot = trace.snapshots[index];
  const previous = index > 0 ? trace.snapshots[index - 1] : null;

  const layout = useMemo(() => {
    const sources: {label: string; local: string; edges: PointerEdge[]}[] = [];
    for (const frame of [...snapshot.frames].reverse())
      for (const local of frame.locals)
        if (local.pointers?.length)
          sources.push({label: `${frame.function}: ${local.name}`, local: `${frame.id}|${local.id}`, edges: local.pointers});

    const roots = sources.flatMap(source => source.edges.filter(e => e.state === 'heap' && e.target).map(e => e.target!));
    const depths = order(snapshot, roots);
    const slots = new Map<string, Slot>();
    const columnBottom = new Map<number, number>();
    // Stack sources occupy column -1 so heap nodes never overlap them.
    let stackY = 24;
    const stackSlots = new Map<string, Slot>();
    for (const source of sources) {
      const rows = new Map(source.edges.map((edge, i) => [edge.path, HEADER + i * ROW + ROW / 2]));
      const height = HEADER + source.edges.length * ROW + 10;
      stackSlots.set(source.local, {key: source.local, x: STACK_X, y: stackY, height, rows});
      stackY += height + GAP;
    }
    for (const [key, depth] of [...depths.entries()].sort((a, b) => a[1] - b[1])) {
      const node = snapshot.heap[key];
      const y = columnBottom.get(depth) ?? 24;
      const rows = new Map(node.fields.slice(0, MAX_ROWS).map((field, i) => [field.name, HEADER + i * ROW + ROW / 2]));
      slots.set(key, {key, x: STACK_X + STACK_WIDTH + 70 + depth * COLUMN, y, height: nodeHeight(node), rows});
      columnBottom.set(depth, y + nodeHeight(node) + GAP);
    }
    const width = Math.max(...[...slots.values()].map(s => s.x + NODE_WIDTH), STACK_X + STACK_WIDTH, 420) + 30;
    const height = Math.max(stackY, ...[...columnBottom.values()], 160) + 10;
    return {sources, slots, stackSlots, width, height};
  }, [snapshot]);

  const {sources, slots, stackSlots} = layout;
  if (!sources.length && !Object.keys(snapshot.heap).length)
    return <section className="memory-graph" aria-label="Memory graph">
      <div className="panel-title"><h2>Memory</h2><span>no pointers at this stop</span></div>
      <p className="note">Pointers, references and heap objects appear here as they are created.</p>
    </section>;

  function edgePath(from: {x: number; y: number}, to: Slot) {
    const sx = from.x, sy = from.y, tx = to.x, ty = to.y + HEADER / 2 + 4;
    const back = tx < sx;
    const bend = back ? 70 : Math.max(40, (tx - sx) / 2);
    return `M${sx},${sy} C${sx + bend},${sy} ${tx - bend},${ty} ${tx},${ty}`;
  }

  function target(edge: PointerEdge) {
    if (edge.state === 'heap' && edge.target) return slots.get(edge.target);
    if (edge.state === 'stack' && edge.target_local) return stackSlots.get(edge.target_local);
    return undefined;
  }

  const changed = (key: string, name: string, value: string | null) => {
    const before = previous?.heap[key];
    if (!before || before.allocation_id !== snapshot.heap[key].allocation_id) return false;
    const field = before.fields.find(f => f.name === name);
    return !!field && field.value !== value;
  };
  const fresh = (key: string) => !previous?.heap[key] ||
    previous.heap[key].allocation_id !== snapshot.heap[key].allocation_id;

  return <section className="memory-graph" aria-label="Memory graph">
    <div className="panel-title"><h2>Memory</h2><span>{Object.keys(snapshot.heap).length} heap objects</span></div>
    <div className="tree-controls">
      <div className="tree-legend"><span className="heap">Heap object</span><span className="fresh">New here</span>
        <span className="dangling">Dangling</span><span className="unknown">Unproven</span></div>
      <label>Zoom <select aria-label="Memory zoom" value={zoom} onChange={e => setZoom(Number(e.target.value))}>
        <option value={0.5}>50%</option><option value={0.75}>75%</option><option value={1}>100%</option><option value={1.3}>130%</option></select></label>
    </div>
    <p className="note">Pointers on the left point into heap objects on the right. Aliases meet at one box and cycles
      loop back. Only allocations recorded by the ledger are followed; anything else stays unproven and is never read.</p>
    {snapshot.heap_truncated && <p className="note">Graph truncated: the node budget or the allocation record filled up.</p>}
    <div className="graph-canvas" tabIndex={0} aria-label="Scrollable memory graph">
      <svg width={layout.width * zoom} height={layout.height * zoom} viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="group" aria-label="Pointers and heap objects">
        <defs><marker id="heap-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8" className="tree-arrow" /></marker></defs>

        {sources.map(source => {
          const slot = stackSlots.get(source.local)!;
          return <g key={source.local} transform={`translate(${slot.x},${slot.y})`} className="stack-box">
            <rect width={STACK_WIDTH} height={slot.height} rx="10" />
            <text x="12" y="19" className="box-title">{source.label}</text>
            {source.edges.map((edge, i) => <text key={edge.path || i} x="12" y={HEADER + i * ROW + 14} className="box-row">
              {(edge.path || '•') + ' '}<tspan className={`state ${edge.state}`}>{stateText[edge.state] || edge.target}</tspan>
            </text>)}
          </g>;
        })}

        {[...slots.values()].map(slot => {
          const node = snapshot.heap[slot.key];
          return <g key={slot.key} transform={`translate(${slot.x},${slot.y})`}
            className={`heap-box ${node.kind} ${fresh(slot.key) ? 'fresh' : ''}`}>
            <rect width={NODE_WIDTH} height={slot.height} rx="10" />
            <text x="12" y="19" className="box-title">{node.type.length > 24 ? node.type.slice(0, 22) + '…' : node.type}
              <tspan className="box-meta"> {node.allocation_id} · {node.size_bytes}B</tspan></text>
            {node.fields.slice(0, MAX_ROWS).map((field, i) => <text key={field.name + i} x="12" y={HEADER + i * ROW + 14}
              className={`box-row ${changed(slot.key, field.name, field.value) ? 'changed' : ''}`}>
              {field.name}{' = '}
              <tspan className={`state ${field.state ?? ''}`}>{field.state && field.state !== 'heap'
                ? stateText[field.state] : (field.value ?? '').slice(0, 18)}</tspan>
            </text>)}
            {node.fields.length > MAX_ROWS && <text x="12" y={HEADER + MAX_ROWS * ROW + 14} className="box-row">
              +{node.fields.length - MAX_ROWS} more</text>}
          </g>;
        })}

        {[...sources.flatMap(source => source.edges.map(edge => ({edge, slot: stackSlots.get(source.local)!}))),
          ...[...slots.values()].flatMap(slot => snapshot.heap[slot.key].fields
            .map(field => ({edge: {path: field.name, target: field.target, state: field.state ?? 'unknown'} as PointerEdge, slot})))]
          .map(({edge, slot}, i) => {
            const to = target(edge);
            const row = slot.rows.get(edge.path);
            if (!to || row === undefined) return null;
            return <path key={`edge-${i}`} className="heap-edge"
              d={edgePath({x: slot.x + (slot.key.includes('|') ? STACK_WIDTH : NODE_WIDTH), y: slot.y + row}, to)}
              markerEnd="url(#heap-arrow)" />;
          })}
      </svg>
    </div>
    <p className="note">A readable object is not proof that it is alive or initialized. Freed memory keeps its old
      contents, so a dangling pointer can still look plausible; it is marked, never followed.</p>
  </section>;
}
