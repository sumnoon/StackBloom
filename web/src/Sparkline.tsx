import {useMemo} from 'react';
import type {Trace} from './trace';

/** Call depth over time, drawn behind the scrubber: recursion has a visible shape. */
export function DepthSparkline({trace, index, onSeek}:
    {trace: Trace; index: number; onSeek: (index: number) => void}) {
  const last = trace.snapshots.length - 1;
  const {path, peak} = useMemo(() => {
    const depths = trace.snapshots.map(stop => stop.frames.length);
    const peak = Math.max(1, ...depths);
    // A filled area across a 100x20 box; the viewBox scales to whatever width it gets.
    const points = depths.map((depth, i) =>
      `${(last ? i / last : 0) * 100},${20 - (depth / peak) * 18}`);
    return {path: `M0,20 L${points.join(' L')} L100,20 Z`, peak};
  }, [trace, last]);
  if (last < 2) return null;

  const jump = (event: React.MouseEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onSeek(Math.round(((event.clientX - box.left) / box.width) * last));
  };
  return <svg className="depth-sparkline" viewBox="0 0 100 20" preserveAspectRatio="none" onClick={jump}
    role="img" aria-label={`Call depth across the run, peaking at ${peak} frames`}>
    <path d={path} className="depth-area" />
    <line className="depth-cursor" x1={(last ? index / last : 0) * 100} x2={(last ? index / last : 0) * 100} y1="0" y2="20" />
  </svg>;
}

export type RunStats = {stops: number; calls: number; depth: number; allocations: number; live: number; output: number};

/** Totals for the whole recording, shown once a program reaches its final stop. */
export function runStats(trace: Trace): RunStats {
  const calls = new Set<string>();
  const allocations = new Set<string>();
  let depth = 0;
  for (const stop of trace.snapshots) {
    depth = Math.max(depth, stop.frames.length);
    for (const frame of stop.frames) if (frame.call_id) calls.add(frame.call_id);
    for (const node of Object.values(stop.heap)) if (node.allocation_id) allocations.add(node.allocation_id);
  }
  const final = trace.snapshots[trace.snapshots.length - 1];
  return {
    stops: trace.snapshots.length, calls: calls.size, depth,
    allocations: allocations.size, live: Object.keys(final.heap).length,
    output: final.stdout.length + final.stderr.length,
  };
}

/** How often each source line was stopped at, for the gutter heat. */
export function lineHeat(trace: Trace) {
  const counts = new Map<number, number>();
  for (const stop of trace.snapshots)
    if (stop.location) counts.set(stop.location.line, (counts.get(stop.location.line) ?? 0) + 1);
  return {counts, hottest: Math.max(1, ...counts.values())};
}
