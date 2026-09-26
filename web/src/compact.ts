import type {HeapNode, Snapshot} from './trace';

/** Reader for `trace.py --compact` files: checkpoints plus bounded deltas.
 *
 * Mirrors tracer/compact.py. Reconstruction is exact, so an expanded trace is
 * validated against the ordinary schema like any other trace.
 */
export const COMPACT_FORMAT = 'cppv-compact-1.0';

type Changes = {
  event?: string; location?: unknown; thread_id?: unknown; diagnostic?: unknown;
  output_truncated?: boolean; heap_truncated?: boolean; returns?: unknown[]; globals?: unknown[];
  frames?: (unknown | null)[]; heap_upsert?: Record<string, HeapNode>; heap_remove?: string[];
  stdout?: string; stderr?: string; stdout_append?: string; stderr_append?: string; drop?: string[];
};
type Entry = {kind: 'full'; snapshot: Snapshot} | {kind: 'delta'; id: number; changes: Changes};
type Compact = {format: string; checkpoint_interval: number; schema_version: string;
  source: unknown; limits: unknown; entries: Entry[]};

const SIMPLE = ['event', 'location', 'thread_id', 'output_truncated', 'diagnostic',
  'heap_truncated', 'returns', 'globals'] as const;

export function isCompact(value: unknown): value is Compact {
  return !!value && typeof value === 'object' && (value as Compact).format === COMPACT_FORMAT;
}

function patch(before: Snapshot, changes: Changes): Snapshot {
  const after = structuredClone(before) as Snapshot & Record<string, unknown>;
  for (const key of changes.drop ?? []) delete after[key];
  for (const key of SIMPLE) if (key in changes) after[key] = structuredClone(changes[key]) as never;
  for (const name of ['stdout', 'stderr'] as const) {
    if (changes[name] !== undefined) after[name] = changes[name]!;
    else if (changes[`${name}_append`] !== undefined) after[name] = (after[name] ?? '') + changes[`${name}_append`];
  }
  if (changes.frames)
    // null keeps the frame that was at that position in the previous stop.
    after.frames = changes.frames.map((frame, i) => structuredClone(frame ?? before.frames[i])) as Snapshot['frames'];
  if (changes.heap_upsert || changes.heap_remove) {
    const heap = {...after.heap};
    for (const key of changes.heap_remove ?? []) delete heap[key];
    Object.assign(heap, structuredClone(changes.heap_upsert ?? {}));
    after.heap = heap;
  }
  return after;
}

export function expandCompact(value: unknown): unknown {
  if (!isCompact(value)) throw new Error(`Not a ${COMPACT_FORMAT} trace.`);
  const snapshots: Snapshot[] = [];
  let state: Snapshot | null = null;
  for (const entry of value.entries) {
    if (entry.kind === 'full') state = structuredClone(entry.snapshot);
    else {
      if (!state) throw new Error('Compact trace must start with a checkpoint.');
      state = patch(state, entry.changes);
      state.id = entry.id;
    }
    snapshots.push(state);
  }
  return {schema_version: value.schema_version, source: value.source, limits: value.limits, snapshots};
}
