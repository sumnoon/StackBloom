import {localKey} from './display.ts';
import type {Frame, Local, Snapshot, Trace} from './trace';

/** An adjacency list (or named 0/1 matrix) read out of a 2D table of node indexes. */
export type Graph = {key: string; name: string; owner: string; type: string; n: number; edges: [number, number][]; directed: boolean};
type Rows = string[][];

const GRAPH_NAME = /^(adj\w*|graph\w*|g|gr|neighbou?rs|nbrs?|children|tree)$/i;
const VISITED_NAME = /^(vis|visited|seen|used|done|marked|explored|in_?q(ueue)?)$/i;
const LABEL_NAME = /^(dist|d|depth|level|lvl|parent|par|prev|pred|colou?r|comp|indeg\w*|order|tin|low)$/i;
const FRONTIER_NAME = /^(q|queue|st|stk|stack|frontier|todo|pq|bfs)$/i;
const FRONTIER_TYPE = /^std::(queue|stack|deque|priority_queue)</;
const CURRENT_NAME = ['u', 'node', 'cur', 'curr', 'at', 'x', 'from', 'src'];
const NEIGHBOUR_NAME = ['v', 'nei', 'next', 'nb', 'to', 'w', 'child', 'y'];
const INTEGER = /^-?\d+$/;

function asGraph(rows: Rows, name: string): Pick<Graph, 'n' | 'edges' | 'directed'> | null {
  const n = rows.length;
  if (n < 2 || !rows.every(row => row.every(cell => INTEGER.test(cell)))) return null;
  const named = GRAPH_NAME.test(name);
  const square = rows.every(row => row.length === n);
  const edges: [number, number][] = [];
  // A named square 0/1 table is an adjacency matrix; with two nodes it cannot be told from a list.
  if (named && square && n > 2 && rows.every(row => row.every(cell => cell === '0' || cell === '1'))) {
    rows.forEach((row, u) => row.forEach((cell, v) => {if (cell === '1') edges.push([u, v]);}));
  } else {
    // Lists: every value names a node. Jagged rows say "list" even without a telling name.
    if (!named && (square || new Set(rows.map(row => row.length)).size === 1)) return null;
    for (const [u, row] of rows.entries())
      for (const cell of row) {
        const v = Number(cell);
        if (v < 0 || v >= n) return null;
        edges.push([u, v]);
      }
  }
  const has = new Set(edges.map(([u, v]) => `${u}>${v}`));
  const directed = edges.some(([u, v]) => !has.has(`${v}>${u}`));
  return {n, edges: directed ? edges : edges.filter(([u, v]) => u <= v), directed};
}

type Found = {graph: Graph; frame?: Frame};

/** Adjacency lists visible at a stop: file-scope ones, then each frame's, outermost first. */
export function graphsAt(snapshot: Snapshot | undefined, unset: Set<string> = new Set()): Found[] {
  if (!snapshot) return [];
  const found: Found[] = [];
  const consider = (local: Local, key: string, owner: string, frame?: Frame) => {
    if (local.table?.dims !== 2 || unset.has(key)) return;
    const shape = asGraph(local.table.rows, local.name);
    if (shape) found.push({graph: {key, name: local.name, owner, type: local.type, ...shape}, frame});
  };
  for (const local of snapshot.globals ?? []) consider(local, `global|${local.name}`, 'file scope');
  for (const frame of [...snapshot.frames].reverse())
    for (const local of frame.locals) consider(local, localKey(frame, local), frame.function, frame);
  return found;
}

/** Whether any stop holds an adjacency list, which decides whether the Graph tab is offered. */
export function traceHasGraph(trace: Trace) {
  return trace.snapshots.some(stop => graphsAt(stop).length > 0);
}

/** 1D tables of length n near the graph: the innermost frame first, then outer frames and file scope. */
function nearbyTables(snapshot: Snapshot, n: number, unset: Set<string>) {
  const tables: {local: Local; row: string[]}[] = [];
  for (const frame of snapshot.frames)
    for (const local of frame.locals)
      if (local.table?.dims === 1 && !unset.has(localKey(frame, local))) tables.push({local, row: local.table.rows[0] ?? []});
  for (const local of snapshot.globals ?? [])
    if (local.table?.dims === 1) tables.push({local, row: local.table.rows[0] ?? []});
  return {
    sized: tables.filter(t => t.row.length === n),
    any: tables,
  };
}

const integerAt = (local: Local | undefined, n: number) => {
  const value = local?.status === 'readable' && local.value && INTEGER.test(local.value) ? Number(local.value) : NaN;
  return Number.isInteger(value) && value >= 0 && value < n ? value : undefined;
};

function localNamed(frame: Frame | undefined, names: string[]) {
  for (const name of names) {
    const local = frame?.locals.find(item => item.name === name && !item.table);
    if (local) return local;
  }
  return undefined;
}

/** What the program is doing to the graph at this stop, read from its own variable names. */
export function annotate(snapshot: Snapshot, n: number, unset: Set<string>) {
  const {sized, any} = nearbyTables(snapshot, n, unset);
  const visitedTable = sized.find(t => t.row.every(c => c === 'true' || c === 'false'))
    ?? sized.find(t => VISITED_NAME.test(t.local.name) && t.row.every(c => c === '0' || c === '1'));
  const visited = new Set(visitedTable ? visitedTable.row.flatMap((c, i) => c === 'true' || c === '1' ? [i] : []) : []);
  const labels = sized.filter(t => t !== visitedTable && LABEL_NAME.test(t.local.name)).slice(0, 2);
  const frontierTable = any.find(t => (FRONTIER_TYPE.test(t.local.type) || FRONTIER_NAME.test(t.local.name))
    && t.row.every(c => INTEGER.test(c) && Number(c) >= 0 && Number(c) < n));
  // A queue pops from the front, a stack from the back: number nodes in the order they will come out.
  const stack = !!frontierTable && (/^std::stack</.test(frontierTable.local.type) || /^(st|stk|stack)$/i.test(frontierTable.local.name));
  const order = frontierTable ? (stack ? [...frontierTable.row].reverse() : frontierTable.row) : [];
  const waiting = new Map<number, number>();
  order.forEach((c, i) => {if (!waiting.has(Number(c))) waiting.set(Number(c), i + 1);});
  // The node being worked on: the innermost frame's u (or node, cur...). Outer frames with one are
  // the recursion path, as in a DFS.
  const path: number[] = [];
  for (const frame of snapshot.frames) {
    const at = integerAt(localNamed(frame, CURRENT_NAME), n);
    if (at !== undefined && path[path.length - 1] !== at) path.push(at);
  }
  const neighbour = integerAt(localNamed(snapshot.frames[0], NEIGHBOUR_NAME), n);
  return {visited, visitedName: visitedTable?.local.name, labels, waiting, frontierName: frontierTable?.local.name, stack,
    current: path[0], path, neighbour, currentName: localNamed(snapshot.frames[0], CURRENT_NAME)?.name,
    neighbourName: localNamed(snapshot.frames[0], NEIGHBOUR_NAME)?.name};
}

export const labelText = (cell: string) => /^-?\d+$/.test(cell) && Math.abs(Number(cell)) >= 1e9 ? '∞' : cell;
