import Ajv2020 from 'ajv/dist/2020';
import {expandCompact, isCompact} from './compact';
import schema from '../../trace.schema.json';

export type Location = {file: string; line: number};
export type PointerState = 'null' | 'heap' | 'stack' | 'dangling' | 'unknown';
export type PointerEdge = {path: string; target: string | null; state: PointerState; target_local?: string};
export type HeapField = {name: string; type: string; value: string | null; target: string | null; state?: PointerState | null};
export type HeapNode = {type: string; kind: 'object' | 'array' | 'opaque' | 'container'; allocation_id: string | null;
  size_bytes: number | null; fields: HeapField[]; truncated: boolean};
export type Local = {id: string; name: string; type: string; value: string | null;
  address: string | null; status: 'readable' | 'optimized_out' | 'unavailable'; initialization: 'unknown';
  is_argument?: boolean; decl_line?: number; pointers?: PointerEdge[];
  /** Arrays and vectors of numbers, as a bounded grid (one row when 1D). */
  table?: {dims: 1 | 2; rows: string[][]; truncated: boolean};
  /** Maps and sets: [key, value] per entry for maps, [key] for sets, in the container's own order. */
  entries?: {kind: 'map' | 'set'; items: string[][]; truncated: boolean}};
export type Frame = {id: string; call_id?: string; function: string; location: Location; locals: Local[]; truncated: boolean};
export type Snapshot = {id: number; event: string; location: Location | null; thread_id: number | null;
  frames: Frame[]; heap: Record<string, HeapNode>; heap_truncated?: boolean;
  stdout: string; stderr: string; output_truncated: boolean;
  diagnostic: {kind: string; message: string; exit_code: number | null; signal: string | null} | null;
  returns?: {call_id: string; value: string | null}[];
  /** File-scope arrays and vectors of the program, recorded only when they read as a table. */
  globals?: Local[]};
export type Trace = {schema_version: '1.0'; source: {path: string; text: string};
  limits: {max_steps: number; timeout_seconds: number; max_output_bytes: number}; snapshots: Snapshot[]};

const validate = new Ajv2020({allErrors: false}).compile(schema);
export function parseTrace(value: unknown): Trace {
  if (isCompact(value)) value = expandCompact(value);
  if (!validate(value)) throw new Error(`Invalid trace: ${validate.errors?.[0]?.instancePath || '/'} ${validate.errors?.[0]?.message}`);
  const trace = value as Trace;
  if (trace.snapshots.some((s, i) => s.id !== i)) throw new Error('Snapshot IDs must be contiguous.');
  if (trace.snapshots.at(-1)?.event === 'step') throw new Error('Trace has no terminal snapshot.');
  return trace;
}
