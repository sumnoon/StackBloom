import {useMemo, useState} from 'react';
import type {Trace} from './trace';
import {traceEvents, type TraceEvent} from './traceEvents';
import {Icon} from './Icon';

export function EventTimeline({trace, index, onSeek}: {trace: Trace; index: number; onSeek: (index: number) => void}) {
  const [filter, setFilter] = useState('all');
  const events = useMemo(() => traceEvents(trace), [trace]);
  const filtered = events.filter(event => filter === 'all' || event.kind === filter);
  const last = trace.snapshots.length - 1;
  // Bin dense recordings into at most 80 hit targets. Next/previous still visits every event stop.
  const bins = new Map<number, TraceEvent[]>();
  for (const event of filtered) {
    const bin = last ? Math.floor(event.index / last * 79) : 0;
    bins.set(bin, [...(bins.get(bin) ?? []), event]);
  }
  const previous = [...filtered].reverse().find(event => event.index < index);
  const next = filtered.find(event => event.index > index);
  return <div className="event-timeline">
    <div className="event-markers" aria-label="Timeline events">{[...bins].map(([bin, group]) => {
      const event = group.find(item => item.kind === 'error') ?? group.find(item => item.kind === 'output') ?? group[0];
      const label = `Stop ${event.index + 1}: ${event.label}${group.length > 1 ? ` · ${group.length} events in this region` : ''}`;
      return <button key={bin} className={`event-marker ${event.kind}`} style={{left: `${last ? event.index / last * 100 : 0}%`}}
        title={label} aria-label={label} onClick={() => onSeek(event.index)}><span /></button>;
    })}</div>
    <div className="event-key"><label>Events <select aria-label="Filter timeline events" value={filter} onChange={e => setFilter(e.target.value)}>
      <option value="all">All</option><option value="call">Calls</option><option value="return">Returns</option>
      <option value="memory">Heap objects</option><option value="output">Output</option><option value="error">Issues</option>
    </select></label><button disabled={!previous} onClick={() => previous && onSeek(previous.index)} aria-label="Previous event"><Icon name="prev" size={16} /></button>
      <button disabled={!next} onClick={() => next && onSeek(next.index)} aria-label="Next event"><Icon name="next" size={16} /></button>
      <span>{filtered.length ? `${filtered.length} events` : 'No matching events'}</span>
    </div>
  </div>;
}
