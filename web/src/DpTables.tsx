import {InfoTip} from './InfoTip';
import {localKey, shortType} from './display';
import type {Frame, Local, Snapshot, Trace} from './trace';
import './dp.css';

type Grid = NonNullable<Local['table']>;
type Entry = {key: string; name: string; owner: string; local: Local; grid: Grid; unset: boolean;
  cursor: {row?: Cursor; col?: Cursor}};
type Cursor = {name: string; at: number};

/** Loop indexes point at the cells a DP step reads and writes; the debugger records neither directly. */
const ROW_NAMES = ['i', 'r', 'row'];
const COL_NAMES = ['j', 'c', 'col', 'w'];

function indexCursor(frame: Frame | undefined, names: string[], size: number): Cursor | undefined {
  for (const name of names) {
    const local = frame?.locals.find(item => item.name === name && item.status === 'readable');
    const at = local?.value !== null && local?.value !== undefined && /^-?\d+$/.test(local.value) ? Number(local.value) : NaN;
    if (Number.isInteger(at) && at >= 0 && at < size) return {name, at};
  }
  return undefined;
}

/** Every table visible at a stop: file-scope ones first, then each frame's, outermost call first. */
function tablesAt(snapshot: Snapshot | undefined, unset: Set<string>): Entry[] {
  if (!snapshot) return [];
  const innermost = snapshot.frames[0];
  const entry = (key: string, owner: string, local: Local, frame: Frame | undefined, isUnset: boolean): Entry => {
    const grid = local.table!;
    const width = Math.max(...grid.rows.map(row => row.length));
    const cursor = grid.dims === 2
      ? {row: indexCursor(frame, ROW_NAMES, grid.rows.length), col: indexCursor(frame, COL_NAMES, width)}
      : {col: indexCursor(frame, [...ROW_NAMES, ...COL_NAMES], width)};
    return {key, name: local.name, owner, local, grid, unset: isUnset, cursor};
  };
  const globals = (snapshot.globals ?? []).filter(local => local.table)
    .map(local => entry(`global|${local.name}`, 'file scope', local, innermost, false));
  const locals = [...snapshot.frames].reverse().flatMap(frame => frame.locals.filter(local => local.table)
    .map(local => entry(localKey(frame, local), frame.function, local, frame, unset.has(localKey(frame, local)))));
  return [...globals, ...locals];
}

export function tableCount(snapshot: Snapshot) {
  return (snapshot.globals?.filter(l => l.table).length ?? 0) + snapshot.frames.reduce((n, frame) => n + frame.locals.filter(l => l.table).length, 0);
}

function Table({entry, before}: {entry: Entry; before?: Entry}) {
  const {grid, cursor} = entry;
  const width = Math.max(...grid.rows.map(row => row.length));
  const columns = Array.from({length: width}, (_, c) => c);
  // A cell is new when this stop wrote a different value there (the table existed a stop ago).
  const was = (r: number, c: number) => before && !before.unset ? before.grid.rows[r]?.[c] : undefined;
  const written = (r: number, c: number) => {
    const old = was(r, c);
    return old !== undefined && old !== grid.rows[r][c];
  };
  const size = grid.dims === 2 ? `${grid.rows.length} × ${width}` : `${width} ${width === 1 ? 'cell' : 'cells'}`;
  return <figure className="dp-table">
    <figcaption>
      <strong>{entry.name}</strong>
      <span className="dp-owner">{entry.owner}</span>
      <span className="dp-type" title={entry.local.type}>{shortType(entry.local.type)} · {size}</span>
    </figcaption>
    {entry.unset
      ? <p className="dp-unset">not set yet</p>
      : <div className="dp-scroll" tabIndex={0} role="region" aria-label={`${entry.name} table`}>
          <table>
            <thead><tr>
              <th scope="col" className="dp-corner" aria-label="index" />
              {columns.map(c => <th scope="col" key={c} className={cursor.col?.at === c ? 'dp-cursor' : undefined}>
                {cursor.col?.at === c && <span className="dp-cursor-name">{cursor.col.name}</span>}{c}</th>)}
            </tr></thead>
            <tbody>{grid.rows.map((row, r) => <tr key={r}>
              <th scope="row" className={cursor.row?.at === r ? 'dp-cursor' : undefined}>
                {cursor.row?.at === r && <span className="dp-cursor-name">{cursor.row.name}</span>}{grid.dims === 2 ? r : ''}</th>
              {columns.map(c => {
                const value = row[c];
                const isNew = value !== undefined && written(r, c);
                const aimed = (grid.dims === 1 || cursor.row?.at === r) && cursor.col?.at === c;
                return <td key={c} className={[isNew ? 'dp-new' : '', aimed ? 'dp-aimed' : ''].join(' ').trim() || undefined}
                  title={isNew ? `was ${was(r, c)}` : undefined}>{value ?? ''}</td>;
              })}
            </tr>)}</tbody>
          </table>
        </div>}
    {grid.truncated && <p className="note">Showing the first {grid.dims === 2 ? `${grid.rows.length} rows × ${width} columns` : `${width} cells`}.</p>}
  </figure>;
}

export function DpTables({trace, index, unset, previousUnset}: {
  trace: Trace; index: number; unset: Set<string>; previousUnset: Set<string>;
}) {
  const entries = tablesAt(trace.snapshots[index], unset);
  const before = new Map(tablesAt(trace.snapshots[index - 1], previousUnset).map(item => [item.key, item]));
  return <section className="dp-panel" aria-label="Arrays and DP tables">
    <div className="panel-title"><h2>Tables</h2><span>{entries.length} at this stop</span></div>
    <div className="tree-controls">
      <ul className="tree-legend" aria-label="Legend">
        <li><span className="dp-swatch new" aria-hidden="true">7</span>Written this step</li>
        <li><span className="dp-swatch cursor" aria-hidden="true">i</span>Where the loop index points</li>
      </ul>
      <InfoTip label="About tables">Arrays, <code>std::array</code> and <code>vector</code>s of numbers show up here as
        grids, including 2D tables like <code>dp[i][j]</code> and file-scope arrays such as a global
        <code> int dp[100]</code>. A cell marked green was written at this stop; hover it for the value it had before.
        The debugger records values, not reads, so the <strong>i</strong> and <strong>j</strong> marks show where loop
        indexes named i, j (or r, c) point: usually the cells the current line reads and writes. Large tables show
        their first rows and columns.</InfoTip>
    </div>
    <div className="dp-list">
      {entries.length
        ? entries.map(entry => <Table key={entry.key} entry={entry} before={before.get(entry.key)} />)
        : <p className="empty">No arrays or vectors of numbers at this stop.</p>}
    </div>
  </section>;
}
