import type {HeapNode, Snapshot} from './trace';

/** Structure heuristics and positions for the memory graph.
 *
 * Field names are suggestions, never proof: `left`/`right` is a tree only after
 * cycle and indegree checks, and a shared child makes it a DAG. Every shape
 * falls back to the layered graph, which draws any structure correctly.
 */
export type Shape = 'list' | 'tree' | 'grid' | 'graph';
export type Placed = {key: string; x: number; y: number; width: number; height: number; row: number};
export type Layout = {
  shape: Shape; places: Map<string, Placed>; width: number; height: number;
  cycles: Set<string>;  // "source->target" edges that close a cycle
};

export const NODE_WIDTH = 210, CELL = 46, ROW = 20, HEADER = 30, GAP_X = 40, GAP_Y = 26, MAX_ROWS = 10;

export function isCells(node: HeapNode) {
  return node.kind === 'array' && node.fields.every(field => !field.state || field.state === 'null');
}

export function nodeSize(node: HeapNode) {
  if (isCells(node)) {
    const columns = Math.min(node.fields.length, 8) || 1;
    const rows = Math.ceil(node.fields.length / 8) || 1;
    return {width: Math.max(140, columns * CELL + 24), height: HEADER + rows * CELL + 10};
  }
  const rows = Math.min(node.fields.length, MAX_ROWS) + (node.fields.length > MAX_ROWS ? 1 : 0);
  return {width: NODE_WIDTH, height: HEADER + rows * ROW + 10};
}

type Edges = Map<string, string[]>;

function buildEdges(snapshot: Snapshot): Edges {
  const edges: Edges = new Map();
  for (const [key, node] of Object.entries(snapshot.heap))
    edges.set(key, node.fields
      .filter(field => field.state === 'heap' && field.target && snapshot.heap[field.target])
      .map(field => field.target!));
  return edges;
}

/** Depth-first from the given roots; also reports edges that close a cycle. */
function traverse(edges: Edges, roots: string[]) {
  const order: string[] = [];
  const depth = new Map<string, number>();
  const cycles = new Set<string>();
  const active = new Set<string>();
  const walk = (key: string, level: number) => {
    if (!edges.has(key)) return;
    if (active.has(key)) return;
    if (depth.has(key)) {
      depth.set(key, Math.max(depth.get(key)!, level));
      return;
    }
    depth.set(key, level);
    order.push(key);
    active.add(key);
    for (const next of edges.get(key)!) {
      if (active.has(next)) cycles.add(`${key}->${next}`);
      walk(next, level + 1);
    }
    active.delete(key);
  };
  roots.forEach(root => walk(root, 0));
  edges.forEach((_, key) => walk(key, 0));
  return {order, depth, cycles};
}

function classify(snapshot: Snapshot, edges: Edges, order: string[], cycles: Set<string>): Shape {
  const indegree = new Map(order.map(key => [key, 0]));
  let branching = 0;
  for (const key of order)
    for (const target of edges.get(key) ?? []) indegree.set(target, (indegree.get(target) ?? 0) + 1);
  for (const key of order) if ((edges.get(key) ?? []).length > 1) branching++;
  const shared = [...indegree.values()].some(count => count > 1);
  const rows = order.filter(key => isCells(snapshot.heap[key]));
  if (rows.length >= 2 && rows.length === order.filter(key => snapshot.heap[key].kind === 'array').length
      && new Set(rows.map(key => snapshot.heap[key].fields.length)).size === 1)
    return 'grid';                                   // Equal-length rows only; T** is not generally rectangular.
  if (cycles.size || shared) return 'graph';         // A shared child is a DAG, not a tree.
  if (branching === 0 && order.length >= 3) return 'list';
  if (branching > 0) return 'tree';
  return 'graph';
}

/** Tidy tree: leaves take the next column, parents centre over their children. */
function treePositions(snapshot: Snapshot, edges: Edges, roots: string[]) {
  const places = new Map<string, Placed>();
  const seen = new Set<string>();
  let column = 0;
  const walk = (key: string, level: number): number => {
    if (seen.has(key)) return places.get(key)?.x ?? 0;
    seen.add(key);
    const size = nodeSize(snapshot.heap[key]);
    const children = (edges.get(key) ?? []).filter(child => !seen.has(child));
    const xs = children.map(child => walk(child, level + 1));
    const x = xs.length ? (xs[0] + xs[xs.length - 1]) / 2 : column++ * (NODE_WIDTH + GAP_X);
    places.set(key, {key, x, y: level * (HEADER + 4 * ROW + GAP_Y + 20), ...size, row: level});
    return x;
  };
  roots.forEach(root => walk(root, 0));
  Object.keys(snapshot.heap).forEach(key => walk(key, 0));
  return places;
}

export function layoutHeap(snapshot: Snapshot, roots: string[], originX: number): Layout {
  const edges = buildEdges(snapshot);
  const {order, depth, cycles} = traverse(edges, roots);
  const shape = classify(snapshot, edges, order, cycles);
  let places = new Map<string, Placed>();

  if (shape === 'tree') {
    places = treePositions(snapshot, edges, roots);
  } else if (shape === 'list') {
    // One straight run, wrapping so long lists stay on screen.
    order.forEach((key, index) => {
      const size = nodeSize(snapshot.heap[key]);
      const column = index % 4, row = Math.floor(index / 4);
      places.set(key, {key, x: column * (NODE_WIDTH + GAP_X), y: row * (size.height + GAP_Y), ...size, row});
    });
  } else if (shape === 'grid') {
    // Rows of one logical grid stack directly under each other.
    let y = 0;
    order.filter(key => isCells(snapshot.heap[key])).forEach((key, row) => {
      const size = nodeSize(snapshot.heap[key]);
      places.set(key, {key, x: 0, y, ...size, row});
      y += size.height + 8;
    });
    order.filter(key => !places.has(key)).forEach((key, index) => {
      const size = nodeSize(snapshot.heap[key]);
      places.set(key, {key, x: 0, y: y + index * (size.height + GAP_Y), ...size, row: index});
    });
  } else {
    // Layered by distance from the stack, which draws cycles without overlap.
    const bottom = new Map<number, number>();
    [...order].sort((a, b) => (depth.get(a) ?? 0) - (depth.get(b) ?? 0)).forEach(key => {
      const level = depth.get(key) ?? 0;
      const size = nodeSize(snapshot.heap[key]);
      const y = bottom.get(level) ?? 0;
      places.set(key, {key, x: level * (NODE_WIDTH + GAP_X + 20), y, ...size, row: level});
      bottom.set(level, y + size.height + GAP_Y);
    });
  }

  for (const place of places.values()) place.x += originX;
  const width = Math.max(0, ...[...places.values()].map(p => p.x + p.width));
  const height = Math.max(0, ...[...places.values()].map(p => p.y + p.height));
  return {shape, places, width, height, cycles};
}
