import type {CallNode} from './callHistory';
import './repeats.css';

export type Repeat = {label: string; count: number; value: string | null; first: number};
export type WorkSummary = {name: string; calls: number; distinct: number; wasted: number};

/** Calls that recompute a subproblem: the same function with the same arguments again.
 *  Only calls that take arguments count, and a call whose arguments are not read yet waits. */
export function repeatedWork(nodes: Iterable<CallNode>) {
  const groups = new Map<string, Repeat>();
  let calls = 0;
  let name = '';
  for (const node of nodes) {
    if (!node.frame.locals.some(local => local.is_argument) || node.label.includes('?')) continue;
    calls++;
    name ||= node.frame.function;
    const group = groups.get(node.label);
    if (group) {
      group.count++;
      group.value ??= node.returned ? node.returnValue : null;
    } else groups.set(node.label, {label: node.label, count: 1, value: node.returned ? node.returnValue : null, first: node.first});
  }
  const rows = [...groups.values()].filter(row => row.count > 1)
    .sort((a, b) => b.count - a.count || a.first - b.first);
  const summary: WorkSummary = {name, calls, distinct: groups.size, wasted: calls - groups.size};
  return {summary, rows};
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function RepeatReport({rows, summary, baseline, spotlight, onSpotlight}: {
  rows: Repeat[]; summary: WorkSummary; baseline: WorkSummary | null;
  spotlight: string | null; onSpotlight: (label: string | null) => void;
}) {
  const share = summary.calls ? Math.round(summary.wasted / summary.calls * 100) : 0;
  return <section className="repeat-report" aria-label="Repeated work">
    <p className="repeat-summary">
      {summary.wasted
        ? <><strong>{plural(summary.wasted, 'call')}</strong> of {summary.calls} ({share}%) recomputed a subproblem already
            computed. {plural(summary.distinct, 'different subproblem')} so far.</>
        : summary.calls
          ? <>No call has recomputed anything yet: {plural(summary.calls, 'call')}, each with new arguments.</>
          : <>No calls with arguments yet.</>}
    </p>
    {baseline && <p className="repeat-compare">
      Last run{baseline.name ? ` (${baseline.name})` : ''}: {plural(baseline.calls, 'call')}, {baseline.wasted} repeated.
      {' '}This run so far: {plural(summary.calls, 'call')}, {summary.wasted} repeated.
    </p>}
    {rows.length > 0 && <>
      <table className="repeat-table">
        <thead><tr><th scope="col">Subproblem</th><th scope="col">Computed</th><th scope="col">Result</th><th scope="col">Wasted</th></tr></thead>
        <tbody>{rows.map(row => {
          const on = spotlight === row.label;
          return <tr key={row.label} className={on ? 'on' : undefined}>
            <th scope="row"><button type="button" className="repeat-pick" aria-pressed={on}
              title={on ? 'Stop highlighting these calls' : 'Highlight every copy of this call in the tree'}
              onClick={() => onSpotlight(on ? null : row.label)}>{row.label}</button></th>
            <td><span className="repeat-times">×{row.count}</span></td>
            <td>{row.value !== null ? <code>{row.value}</code> : <span className="repeat-pending">not yet</span>}</td>
            <td>{plural(row.count - 1, 'call')}</td>
          </tr>;
        })}</tbody>
      </table>
      <p className="repeat-hint">With memoization, each subproblem is computed once and every other call becomes a table lookup.</p>
    </>}
  </section>;
}
