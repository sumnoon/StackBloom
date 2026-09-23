import {useMemo, useRef, useState} from 'react';
import {useZoom, ZoomControl} from './zoom';
import {CELL, HEADER, isCells, layoutHeap, MAX_ROWS, NODE_WIDTH, ROW, type Placed} from './layout';
import type {HeapNode, PointerEdge, PointerState, Snapshot, Trace} from './trace';

const STACK_X = 24, STACK_WIDTH = 210, STACK_GAP = 26, ORIGIN = STACK_X + STACK_WIDTH + 70;

const stateText: Record<PointerState, string> = {
  null: '∅ null', heap: '', stack: '↑ stack', dangling: '✕ dangling', unknown: '? unproven',
};
const shapeText = {
  list: 'linked list', tree: 'tree', grid: 'grid', graph: 'graph',
};

type Slot = {key: string; x: number; y: number; width: number; height: number; rows: Map<string, number>};

function stackSources(snapshot: Snapshot) {
  const sources: {label: string; local: string; edges: PointerEdge[]}[] = [];
  for (const frame of [...snapshot.frames].reverse())
    for (const local of frame.locals)
      if (local.pointers?.length)
        sources.push({label: `${frame.function}: ${local.name}`, local: `${frame.id}|${local.id}`, edges: local.pointers});
  return sources;
}

function fieldRows(node: HeapNode, place: Placed) {
  const rows = new Map<string, number>();
  if (isCells(node))
    node.fields.forEach((field, i) => rows.set(field.name, HEADER + Math.floor(i / 8) * CELL + CELL / 2));
  else
    node.fields.slice(0, MAX_ROWS).forEach((field, i) => rows.set(field.name, HEADER + i * ROW + ROW / 2));
  return {key: place.key, x: place.x, y: place.y, width: place.width, height: place.height, rows} as Slot;
}

export function MemoryGraph({trace, index}: {trace: Trace; index: number}) {
  // view.width/height come from the layout below, so zoom is wired after it.
  const snapshot = trace.snapshots[index];
  const previous = index > 0 ? trace.snapshots[index - 1] : null;
  // Keeping the last drawn position of a surviving node avoids distracting jumps.
  const remembered = useRef(new Map<string, {x: number; y: number}>());

  const view = useMemo(() => {
    const sources = stackSources(snapshot);
    const stackSlots = new Map<string, Slot>();
    let stackY = 24;
    for (const source of sources) {
      const rows = new Map(source.edges.map((edge, i) => [edge.path, HEADER + i * ROW + ROW / 2]));
      const height = HEADER + source.edges.length * ROW + 10;
      stackSlots.set(source.local, {key: source.local, x: STACK_X, y: stackY, width: STACK_WIDTH, height, rows});
      stackY += height + STACK_GAP;
    }
    const roots = sources.flatMap(s => s.edges.filter(e => e.state === 'heap' && e.target).map(e => e.target!));
    const layout = layoutHeap(snapshot, roots, ORIGIN);
    const slots = new Map<string, Slot>();
    for (const place of layout.places.values()) {
      const node = snapshot.heap[place.key];
      const memory = remembered.current.get(`${place.key}:${node.allocation_id}`);
      // Reuse a remembered position only while it stays inside the new canvas.
      const stable = memory && memory.y + place.height <= layout.height + 1 && memory.x >= ORIGIN
        ? {...place, x: memory.x, y: memory.y} : place;
      slots.set(place.key, fieldRows(node, stable));
    }
    const keep = new Map<string, {x: number; y: number}>();
    slots.forEach((slot, key) => keep.set(`${key}:${snapshot.heap[key].allocation_id}`, {x: slot.x, y: slot.y}));
    remembered.current = keep;
    return {
      sources, stackSlots, slots, shape: layout.shape, cycles: layout.cycles,
      width: Math.max(layout.width, STACK_X + STACK_WIDTH, 420) + 30,
      height: Math.max(stackY, layout.height, 160) + 10,
    };
  }, [snapshot]);

  // Declared before the empty-state return so hook order stays stable.
  const {ref, zoom, mode, setMode, fit} = useZoom(view.width, view.height);
  const {sources, slots, stackSlots} = view;
  if (!sources.length && !Object.keys(snapshot.heap).length)
    return <section className="memory-graph" aria-label="Memory graph">
      <div className="panel-title"><h2>Memory</h2><span>no pointers at this stop</span></div>
      <p className="note">Pointers, references and heap objects appear here as they are created.</p>
    </section>;

  const target = (edge: {state?: PointerState | null; target: string | null; target_local?: string}) => {
    if (edge.state === 'heap' && edge.target) return slots.get(edge.target);
    if (edge.state === 'stack' && edge.target_local) return stackSlots.get(edge.target_local);
    return undefined;
  };

  function edgePath(from: {x: number; y: number}, to: Slot, cycle: boolean) {
    const sx = from.x, sy = from.y, tx = to.x, ty = to.y + HEADER / 2 + 4;
    if (cycle || tx < sx) {   // Route a back edge under its row rather than through boxes.
      const drop = Math.max(sy, ty) + 46;
      return `M${sx},${sy} C${sx + 60},${drop} ${tx - 60},${drop} ${tx},${ty}`;
    }
    const bend = Math.max(40, (tx - sx) / 2);
    return `M${sx},${sy} C${sx + bend},${sy} ${tx - bend},${ty} ${tx},${ty}`;
  }

  const changed = (key: string, name: string, value: string | null) => {
    const before = previous?.heap[key];
    if (!before || before.allocation_id !== snapshot.heap[key].allocation_id) return false;
    const field = before.fields.find(f => f.name === name);
    return !!field && field.value !== value;
  };
  const fresh = (key: string) => !previous?.heap[key] ||
    previous.heap[key].allocation_id !== snapshot.heap[key].allocation_id;

  const allEdges = [
    ...sources.flatMap(source => source.edges.map(edge => ({edge, slot: stackSlots.get(source.local)!, from: 'stack'}))),
    ...[...slots.values()].flatMap(slot => snapshot.heap[slot.key].fields.map(field => ({
      edge: {path: field.name, target: field.target, state: field.state ?? 'unknown'} as PointerEdge,
      slot, from: slot.key,
    }))),
  ];

  return <section className="memory-graph" aria-label="Memory graph">
    <div className="panel-title"><h2>Memory</h2><span>{Object.keys(snapshot.heap).length} heap objects · {shapeText[view.shape]}</span></div>
    <div className="tree-controls">
      <div className="tree-legend"><span className="heap">Heap object</span><span className="fresh">New here</span>
        <span className="dangling">Dangling</span><span className="unknown">Unproven</span></div>
      <ZoomControl label="Memory zoom" mode={mode} setMode={setMode} fit={fit} />
    </div>
    <p className="note">Detected shape: <strong>{shapeText[view.shape]}</strong>. Field names are only hints, so a shared
      child or a cycle is drawn as a graph rather than a tree. Only allocations recorded by the ledger are followed.</p>
    {snapshot.heap_truncated && <p className="note">Graph truncated: the node budget or the allocation record filled up.</p>}
    <div className="graph-canvas" ref={ref} tabIndex={0} aria-label="Scrollable memory graph">
      <svg width={view.width * zoom} height={view.height * zoom} viewBox={`0 0 ${view.width} ${view.height}`}
        role="group" aria-label="Pointers and heap objects">
        <defs><marker id="heap-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8" className="tree-arrow" /></marker></defs>

        {allEdges.map(({edge, slot, from}, i) => {
          const to = target(edge);
          const row = slot.rows.get(edge.path);
          if (!to || row === undefined) return null;
          const cycle = view.cycles.has(`${from}->${edge.target}`);
          // Edges into a node that appeared at this stop draw themselves in.
          const arriving = edge.state === 'heap' && edge.target ? fresh(edge.target) : false;
          return <path key={`edge-${i}`} className={`heap-edge ${cycle ? 'cycle' : ''} ${arriving ? 'arriving' : ''}`}
            d={edgePath({x: slot.x + slot.width, y: slot.y + row}, to, cycle)} markerEnd="url(#heap-arrow)">
            {cycle && <title>Cycle: this edge points back into the structure</title>}
          </path>;
        })}

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
            <rect width={slot.width} height={slot.height} rx="10" />
            <text x="12" y="19" className="box-title">{node.type.length > 24 ? node.type.slice(0, 22) + '…' : node.type}
              <tspan className="box-meta"> {node.allocation_id} · {node.size_bytes}B</tspan></text>
            {isCells(node)
              ? node.fields.map((field, i) => <g key={field.name + i}
                  transform={`translate(${12 + (i % 8) * CELL},${HEADER + Math.floor(i / 8) * CELL})`}
                  className={`cell ${changed(slot.key, field.name, field.value) ? 'changed' : ''}`}>
                  <rect width={CELL - 6} height={CELL - 10} rx="6" />
                  <text x={(CELL - 6) / 2} y="18" textAnchor="middle" className="cell-value">{(field.value ?? '').slice(0, 5)}</text>
                  <text x={(CELL - 6) / 2} y="31" textAnchor="middle" className="cell-index">{field.name}</text>
                </g>)
              : node.fields.slice(0, MAX_ROWS).map((field, i) => <text key={field.name + i} x="12" y={HEADER + i * ROW + 14}
                  className={`box-row ${changed(slot.key, field.name, field.value) ? 'changed' : ''}`}>
                  {field.name}{' = '}
                  <tspan className={`state ${field.state ?? ''}`}>{field.state && field.state !== 'heap'
                    ? stateText[field.state] : (field.value ?? '').slice(0, 18)}</tspan>
                </text>)}
            {!isCells(node) && node.fields.length > MAX_ROWS && <text x="12" y={HEADER + MAX_ROWS * ROW + 14}
              className="box-row">+{node.fields.length - MAX_ROWS} more</text>}
          </g>;
        })}
      </svg>
    </div>
    <p className="note">A readable object is not proof that it is alive or initialized. Freed memory keeps its old
      contents, so a dangling pointer can still look plausible; it is marked, never followed.</p>
  </section>;
}
