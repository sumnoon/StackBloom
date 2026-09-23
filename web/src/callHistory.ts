import type {Frame, Local, Snapshot, Trace} from './trace';
import {ownPointer, shortValue} from './display';

export type CallNode = {id: string; parent: string | null; children: string[]; frame: Frame;
  first: number; last: number; state: 'active' | 'waiting' | 'completed' | 'interrupted'; label: string;
  returned: boolean; returnValue: string | null};

/** An argument as the reader thinks of it: a pointer names the object it points
 *  at (a3, null) rather than an address that changes on every run. */
function argument(local: Local, stop: Snapshot) {
  const pointer = ownPointer(local);
  if (pointer) {
    if (pointer.state === 'null') return 'null';
    if (pointer.state === 'heap' && pointer.target) return stop.heap[pointer.target]?.allocation_id ?? 'ptr';
    if (pointer.state === 'dangling') return 'dangling';
    return local.value ?? '?';
  }
  const text = shortValue(local.value ?? '?').text;
  return text.length > 14 ? text.slice(0, 13) + '…' : text;
}

/** A return value the same way: a returned pointer names the heap object it points at. */
function returned(value: string | null, stop: Snapshot) {
  if (value === null) return null;
  const address = value.match(/^(?:\([^)]*\)\s*)?(0x[0-9a-f]+)$/)?.[1];
  if (address) return address === '0x0' ? 'null' : stop.heap[address]?.allocation_id ?? value;
  return shortValue(value).text;
}

/** Replay only the prefix: backward seeking must not reveal future calls. */
export function callHistory(trace: Trace, index: number) {
  const nodes = new Map<string, CallNode>();
  let previous: CallNode[] = [];
  let serial = 0;
  let approximate = false;
  for (let i = 0; i <= index; i++) {
    const stop = trace.snapshots[i];
    const path: CallNode[] = [];
    let matching = true;
    for (const [depth, frame] of [...stop.frames].reverse().entries()) {
      if (!frame.call_id) approximate = true;
      matching = matching && previous[depth]?.frame.function === frame.function;
      const id = frame.call_id ?? (matching ? previous[depth].id : `legacy-${serial++}`);
      let node = nodes.get(id);
      if (!node) {
        node = {id, parent: path.at(-1)?.id ?? null, children: [], frame, first: i, last: i,
          state: 'completed', label: frame.function, returned: false, returnValue: null};
        nodes.set(id, node);
        if (node.parent) nodes.get(node.parent)?.children.push(id);
      }
      node.frame = frame;
      node.last = i;
      // Display observed parameter values, not guessed locals or inferred returns.
      // A call's first stop is its entry address, before the prologue stores arguments.
      const entering = i === node.first && i > 0;
      const args = frame.locals.filter(local => local.is_argument).map(local =>
        !entering && local.status === 'readable' ? argument(local, stop) : '?');
      node.label = `${frame.function}(${args.join(', ')})`;
      path.push(node);
    }
    for (const {call_id, value} of stop.returns ?? []) {
      const node = nodes.get(call_id);
      if (node) {node.returned = true; node.returnValue = returned(value, stop);}
    }
    previous = path;
  }
  previous.forEach((node, i) => {node.state = i === previous.length - 1 ? 'active' : 'waiting';});
  const stop = trace.snapshots[index];
  if (!['step', 'exit'].includes(stop.event)) previous.forEach(node => {node.state = 'interrupted';});
  return {nodes, roots: [...nodes.values()].filter(node => node.parent === null), approximate};
}
