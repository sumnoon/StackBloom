import type {Trace} from './trace';

export type TraceEvent = {index: number; kind: 'call' | 'return' | 'memory' | 'output' | 'error'; label: string};
/** Event summaries use observations only; a disappearing frame is not proof of a return. */
export function traceEvents(trace: Trace): TraceEvent[] {
  const events: TraceEvent[] = [];
  trace.snapshots.forEach((stop, index) => {
    const previous = trace.snapshots[index - 1];
    const add = (kind: TraceEvent['kind'], label: string) => events.push({index, kind, label});
    if (stop.event !== 'step' && stop.event !== 'exit') add('error', stop.diagnostic?.message ?? stop.event.replaceAll('_', ' '));
    if (stop.event === 'exit' && stop.diagnostic?.exit_code) add('error', `Exit code ${stop.diagnostic.exit_code}`);
    if (stop.stdout !== (previous?.stdout ?? '') || stop.stderr !== (previous?.stderr ?? '')) add('output', 'Output changed');
    const before = new Set(Object.entries(previous?.heap ?? {}).map(([address, node]) => node.allocation_id ?? address));
    const after = new Set(Object.entries(stop.heap).map(([address, node]) => node.allocation_id ?? address));
    const added = [...after].filter(id => !before.has(id)).length;
    const removed = [...before].filter(id => !after.has(id)).length;
    if (added || removed) add('memory', `${added} new, ${removed} removed heap objects`);
    for (const returned of stop.returns ?? []) add('return', `Return ${returned.value ?? '(value unavailable)'}`);
    const oldCalls = new Set(previous?.frames.map(frame => frame.call_id).filter(Boolean));
    const entering = stop.frames.filter(frame => frame.call_id && !oldCalls.has(frame.call_id));
    if (entering.length) add('call', `Entered ${entering.map(frame => frame.function).reverse().join(' → ')}`);
    else if (previous && stop.frames.length > previous.frames.length && stop.frames.some(frame => !frame.call_id))
      add('call', `Stack grew to ${stop.frames.length} calls (legacy trace)`);
  });
  return events;
}
