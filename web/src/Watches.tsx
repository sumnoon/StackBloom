import {useMemo} from 'react';
import type {Snapshot, Trace} from './trace';

/** A watched variable: a local name inside a function. Recursive calls share it,
 *  and the innermost (newest) call is the one watched at each stop. */
export type Watch = {fn: string; name: string};

function valueAt(stop: Snapshot, previous: Snapshot | undefined, watch: Watch) {
  for (const frame of stop.frames) {
    if (frame.function !== watch.fn) continue;
    // A call's first stop is its entry address, before the prologue stores the
    // arguments: what is there is leftover stack, so treat it as not yet known.
    if (frame.call_id && previous && !previous.frames.some(item => item.call_id === frame.call_id)) return null;
    const local = frame.locals.find(item => item.name === watch.name);
    if (local) return local.status === 'readable' ? local.value : null;
  }
  return undefined;  // Not in scope at this stop.
}

function WatchCard({trace, index, watch, onRemove, onSeek}:
    {trace: Trace; index: number; watch: Watch; onRemove: () => void; onSeek: (index: number) => void}) {
  const last = trace.snapshots.length - 1;
  const {values, numbers, low, high} = useMemo(() => {
    const values = trace.snapshots.map((stop, i) => valueAt(stop, trace.snapshots[i - 1], watch));
    // Chart only values that read as numbers; pointers and text still show as text.
    const numbers = values.map(value => value != null && /^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(value) ? Number(value) : null);
    const present = numbers.filter((n): n is number => n !== null);
    return {values, numbers, low: Math.min(...present), high: Math.max(...present)};
  }, [trace, watch]);
  const current = values[index];
  const span = high - low || 1;
  // A step line that holds the last known value: solid while the variable is in
  // scope, faint while it is not, so a value that comes and goes still reads as a sequence.
  const solid: string[] = [], faint: string[] = [];
  let held: number | null = null, lastKnown: string | null = null;
  numbers.forEach((n, i) => {
    const x = ((last ? i / last : 0) * 100).toFixed(2);
    const next = n ?? held;
    if (next === null) return;
    const y = (16 - ((next - low) / span) * 14).toFixed(2);
    const target = n === null ? faint : solid;
    target.push(held === null ? `M${x},${y}` : `M${x},${(16 - ((held - low) / span) * 14).toFixed(2)} L${x},${y}`);
    const nextX = ((last ? (i + 1) / last : 0) * 100).toFixed(2);
    if (i < last) target.push(`M${x},${y} L${nextX},${y}`);
    held = next;
    if (i <= index && values[i] != null) lastKnown = values[i] ?? lastKnown;
  });
  const charted = solid.length > 1 && Number.isFinite(low);

  const inScope = current !== undefined;
  return <div className={`watch-card ${inScope ? '' : 'out-of-scope'}`}>
    <div className="watch-text">
      <span className="watch-name">{watch.fn} · <strong>{watch.name}</strong></span>
      <code className="watch-value" title={inScope ? undefined : 'Not in scope at this stop; showing its last value'}>
        {inScope ? current ?? 'not set yet' : lastKnown ?? '—'}</code>
    </div>
    {charted && <svg className="watch-chart" viewBox="0 0 100 18" preserveAspectRatio="none" role="img"
      aria-label={`${watch.name} over the run, from ${low} to ${high}`}
      onClick={event => {
        const box = event.currentTarget.getBoundingClientRect();
        onSeek(Math.round(((event.clientX - box.left) / box.width) * last));
      }}>
      <path d={faint.join(' ')} className="watch-line faint" />
      <path d={solid.join(' ')} className="watch-line" />
      <line x1={(last ? index / last : 0) * 100} x2={(last ? index / last : 0) * 100} y1="0" y2="18" className="depth-cursor" />
    </svg>}
    {charted && <div className="watch-range"><span>{high}</span><span>{low}</span></div>}
    <button className="ghost watch-remove" onClick={onRemove} aria-label={`Stop watching ${watch.name}`}>×</button>
  </div>;
}

export function Watches({trace, index, watches, onRemove, onSeek}: {
  trace: Trace; index: number; watches: Watch[]; onRemove: (watch: Watch) => void; onSeek: (index: number) => void;
}) {
  return <section className="watches" aria-label="Watched variables">
    {watches.map(watch => <WatchCard key={`${watch.fn}:${watch.name}`} trace={trace} index={index} watch={watch}
      onRemove={() => onRemove(watch)} onSeek={onSeek} />)}
  </section>;
}
