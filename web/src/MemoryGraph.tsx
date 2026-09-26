import {useMemo, useRef, useState} from 'react';
import {useZoom, ZoomControl} from './zoom';
import {pointerText, shortType, shortValue} from './display';
import {GraphOverview} from './GraphOverview';
import {MemoryLegend} from './Legend';
import {entryText} from './Entries';
import {InfoTip} from './InfoTip';
import {CELL, HEADER, isCells, layoutHeap, MAX_ROWS, NODE_WIDTH, ROW, type Placed} from './layout';
import type {HeapNode, Local, PointerEdge, PointerState, Snapshot, Trace} from './trace';

const HEAP_TOP = 24;
const STACK_X = 24, STACK_WIDTH = 210, STACK_GAP = 26, ORIGIN = STACK_X + STACK_WIDTH + 70;

const truncate = (text: string, length: number) => text.length > length ? text.slice(0, length - 1) + '…' : text;
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
    // Maps and sets live on the stack too: each gets its own box of entries in the stack column.
    const containers: {key: string; label: string; entries: NonNullable<Local['entries']>; slot: Slot}[] = [];
    const owned = [
      ...(snapshot.globals ?? []).map(local => ({owner: 'global', id: 'global', local})),
      ...[...snapshot.frames].reverse().flatMap(frame => frame.locals.map(local => ({owner: frame.function, id: frame.id, local}))),
    ];
    for (const {owner, id, local} of owned) {
      if (local.status !== 'readable' || !local.entries?.items.length) continue;
      const more = local.entries.items.length > MAX_ROWS || local.entries.truncated;
      const height = HEADER + (Math.min(local.entries.items.length, MAX_ROWS) + (more ? 1 : 0)) * ROW + 10;
      const key = `${id}|${local.id}`;
      containers.push({key, label: `${owner}: ${local.name}`, entries: local.entries,
        slot: {key, x: STACK_X, y: stackY, width: STACK_WIDTH, height, rows: new Map()}});
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
      // Heap boxes start a little below the top edge, level with the first stack box.
      slots.set(place.key, fieldRows(node, {...stable, y: stable.y + HEAP_TOP}));
    }
    // Remembered positions keep boxes still, but when the leftmost box goes away they would leave an empty
    // column: slide the row back to the start so the drawing never loses width to a gap.
    const left = Math.min(...[...slots.values()].map(slot => slot.x));
    if (Number.isFinite(left) && left > ORIGIN) slots.forEach(slot => {slot.x -= left - ORIGIN;});
    const keep = new Map<string, {x: number; y: number}>();
    slots.forEach((slot, key) => keep.set(`${key}:${snapshot.heap[key].allocation_id}`, {x: slot.x, y: slot.y - HEAP_TOP}));
    remembered.current = keep;
    return {
      sources, stackSlots, slots, containers, shape: layout.shape, cycles: layout.cycles,
      // Remembered positions can sit right of the fresh layout, so measure what is drawn.
      width: Math.max(layout.width, STACK_X + STACK_WIDTH, 420, ...[...slots.values()].map(slot => slot.x + slot.width)) + 30,
      height: Math.max(stackY, layout.height + HEAP_TOP, 160) + 10,
    };
  }, [snapshot]);

  // Declared before the empty-state return so hook order stays stable.
  // 0.9 keeps 13.5px box text at 12px or more on screen; past that the graph scrolls.
  const {ref, zoom, mode, setMode, fit} = useZoom(view.width, view.height, 0.9);
  const {sources, slots, stackSlots, containers} = view;
  if (!sources.length && !containers.length && !Object.keys(snapshot.heap).length)
    return <section className="memory-graph" aria-label="Memory graph">
      <div className="panel-title"><h2>Memory</h2><span>no pointers at this stop</span></div>
      <p className="note">Pointers, references and heap objects appear here as they are created.</p>
    </section>;

  const target = (edge: {state?: PointerState | null; target: string | null; target_local?: string}) => {
    if (edge.state === 'heap' && edge.target) return slots.get(edge.target);
    if (edge.state === 'stack' && edge.target_local) return stackSlots.get(edge.target_local);
    return undefined;
  };

  // Several pointers into one box arrive at different heights instead of one point,
  // and stop a pixel short of the border so the arrowhead is never hidden by it.
  const arrivals = new Map<Slot, number>();
  const arrivalCount = new Map<Slot, number>();
  function arrivalY(to: Slot) {
    const total = arrivalCount.get(to) ?? 1;
    const index = arrivals.get(to) ?? 0;
    arrivals.set(to, index + 1);
    if (total === 1) return to.y + HEADER / 2 + 4;
    // Fan out downward from the header, never past the bottom of the box.
    const step = Math.min(12, (to.height - 24) / (total - 1));
    return to.y + 12 + step * index;
  }

  function edgePath(from: {x: number; y: number}, to: Slot, cycle: boolean) {
    const sx = from.x, sy = from.y, tx = to.x - 1, ty = arrivalY(to);
    if (cycle || tx < sx) {   // Route a back edge under its row rather than through boxes.
      const drop = Math.max(sy, ty) + 46;
      return `M${sx},${sy} C${sx + 60},${drop} ${tx - 60},${drop} ${tx},${ty}`;
    }
    // Neighbours on one row get a straight line, not an S-hook through the gap.
    const gap = tx - sx;
    // Neighbours: a level line from the field across to the next box's side.
    if (gap < 80) return `M${sx},${sy} L${tx},${Math.min(Math.max(sy, to.y + 10), to.y + to.height - 10)}`;
    const bend = Math.max(40, gap / 2);
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
  for (const {edge, slot} of allEdges) {
    const to = target(edge);
    if (to && slot.rows.get(edge.path) !== undefined) arrivalCount.set(to, (arrivalCount.get(to) ?? 0) + 1);
  }

  return <section className="memory-graph" aria-label="Memory graph">
    <div className="panel-title"><h2>Memory</h2><span>{Object.keys(snapshot.heap).length} heap objects · {shapeText[view.shape]}</span></div>
    <div className="tree-controls">
      <MemoryLegend />
      <div className="panel-title-actions">
        <ZoomControl label="Memory zoom" mode={mode} setMode={setMode} fit={fit} />
        <InfoTip label="About the memory graph">Pointers on the left point into heap objects on the right; aliases meet
          at one box and cycles loop back. Detected shape: <strong>{shapeText[view.shape]}</strong>. Field names are only
          hints, so a shared child or a cycle is drawn as a graph. Only allocations the program made through
          <code>new</code> or <code>malloc</code> are followed, and a readable object is not proof that it is alive:
          freed memory keeps its old contents, so a dangling pointer is marked, never followed.</InfoTip>
      </div>
    </div>
    {snapshot.heap_truncated && <p className="note">Graph truncated: the node budget or the allocation record filled up.</p>}
    <div className="graph-stage"><div className="graph-canvas" ref={ref} tabIndex={0} aria-label="Scrollable memory graph">
      <svg width={view.width * zoom} height={view.height * zoom} viewBox={`0 0 ${view.width} ${view.height}`}
        role="group" aria-label="Pointers and heap objects">
        <defs><marker id="heap-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M0.5,0.5 L8.5,4.5 L0.5,8.5" className="heap-arrow-head" /></marker></defs>

        {allEdges.map(({edge, slot, from}, i) => {
          const to = target(edge);
          const row = slot.rows.get(edge.path);
          if (!to || row === undefined) return null;
          const cycle = view.cycles.has(`${from}->${edge.target}`);
          // Edges into a node that appeared at this stop grow out of their pointer, like a new call's edge.
          const arriving = edge.state === 'heap' && edge.target ? fresh(edge.target) : false;
          return <path key={`edge-${i}`} className={`heap-edge ${cycle ? 'cycle' : ''} ${arriving ? 'arriving' : ''}`}
            d={edgePath({x: slot.x + slot.width, y: slot.y + row}, to, cycle)} markerEnd="url(#heap-arrow)"
            style={arriving ? {transformOrigin: `${slot.x + slot.width}px ${slot.y + row}px`} : undefined}>
            {cycle && <title>Cycle: this edge points back into the structure</title>}
          </path>;
        })}

        {sources.map(source => {
          const slot = stackSlots.get(source.local)!;
          return <g key={source.local} transform={`translate(${slot.x},${slot.y})`} className="stack-box">
            <rect width={STACK_WIDTH} height={slot.height} rx="10" />
            <text x="12" y="19" className="box-title">{source.label}</text>
            {source.edges.map((edge, i) => <text key={edge.path || i} x="12" y={HEADER + i * ROW + 14} className="box-row">
              <title>{edge.target ?? 'null'}</title>
              {(edge.path || '•') + ' '}<tspan className={`state ${edge.state}`}>{pointerText(edge, snapshot)}</tspan>
            </text>)}
          </g>;
        })}

        {containers.map(({key, label, entries, slot}) => {
          const count = entries.items.length;
          const shown = entries.items.slice(0, MAX_ROWS);
          return <g key={key} transform={`translate(${slot.x},${slot.y})`} className="container-box">
            <rect className="box" width={STACK_WIDTH} height={slot.height} rx="10" />
            <text x="12" y="19" className="box-title">{truncate(label, 18)}
              <tspan className="box-meta"> {entries.kind} · {count}{entries.truncated ? '+' : ''}</tspan></text>
            {shown.map((item, i) => <text key={item[0] + i} x="12" y={HEADER + i * ROW + 14} className="box-row">
              <title>{item.join(' → ')}</title>
              <tspan className="entry-key">{truncate(entryText(item[0]), entries.kind === 'map' ? 11 : 24)}</tspan>
              {entries.kind === 'map' && <><tspan className="entry-sep"> → </tspan>{truncate(entryText(item[1] ?? ''), 10)}</>}
            </text>)}
            {(count > MAX_ROWS || entries.truncated) && <text x="12" y={HEADER + shown.length * ROW + 14} className="box-row">
              +{count > MAX_ROWS ? count - MAX_ROWS : ''} more</text>}
          </g>;
        })}

        {[...slots.values()].map(slot => {
          const node = snapshot.heap[slot.key];
          return <g key={slot.key} transform={`translate(${slot.x},${slot.y})`}
            className={`heap-box ${node.kind} ${fresh(slot.key) ? 'fresh' : ''}`}>
            <rect width={slot.width} height={slot.height} rx="10" />
            <text x="12" y="19" className="box-title"><title>{node.type}</title>{truncate(shortType(node.type), 24)}
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
                  <title>{field.value ?? ''}</title>
                  {field.name}{' '}
                  <tspan className={`state ${field.state ?? ''}`}>{field.state
                    ? pointerText({state: field.state, target: field.target}, snapshot)
                    : `= ${truncate(shortValue(field.value ?? '').text, 20)}`}</tspan>
                </text>)}
            {!isCells(node) && node.fields.length > MAX_ROWS && <text x="12" y={HEADER + MAX_ROWS * ROW + 14}
              className="box-row">+{node.fields.length - MAX_ROWS} more</text>}
          </g>;
        })}
      </svg>
    </div>
    <GraphOverview canvas={ref} width={view.width} height={view.height} zoom={zoom} nodes={[...stackSlots.values(), ...containers.map(item => item.slot), ...slots.values()].map(({x, y, width, height}) => ({x, y, width, height}))} />
    </div>
  </section>;
}
