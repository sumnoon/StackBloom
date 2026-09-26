import {useState, type CSSProperties} from 'react';
import {InfoTip} from './InfoTip';
import {localKey, shortType} from './display';
import type {Frame, Local, Snapshot, Trace} from './trace';
import './dp.css';

type Grid = NonNullable<Local['table']>;
type Entry = {key: string; name: string; owner: string; local: Local; grid: Grid; unset: boolean;
  cursor: {row?: Cursor; col?: Cursor}; frame?: Frame};
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
    return {key, name: local.name, owner, local, grid, unset: isUnset, cursor, frame};
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

/** Sorting and searching name their indexes more freely than DP loops do; bars mark all of them. */
const BAR_NAMES = ['i', 'j', 'k', 'lo', 'hi', 'low', 'high', 'mid', 'l', 'r', 'left', 'right'];
const BARS_KEY = 'stackbloom.bars';

/** The values of a 1D table when every cell is a number, else null. */
function numbers(grid: Grid) {
  if (grid.dims !== 1 || !grid.rows[0]?.length) return null;
  const values = grid.rows[0].map(cell => /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(cell) ? Number(cell) : NaN);
  return values.every(Number.isFinite) ? values : null;
}

function barCursors(frame: Frame | undefined, size: number) {
  const at = new Map<number, string[]>();
  for (const name of BAR_NAMES) {
    const local = frame?.locals.find(item => item.name === name && item.status === 'readable' && !item.table);
    if (!local?.value || !/^-?\d+$/.test(local.value)) continue;
    const index = Number(local.value);
    if (index >= 0 && index < size) at.set(index, [...(at.get(index) ?? []), name]);
  }
  return at;
}

const PLOT = 132;

/** A 1D array as bars: height is the value, green bars were written this step, index names sit underneath. */
function Bars({entry, before, values}: {entry: Entry; before?: Entry; values: number[]}) {
  const high = Math.max(0, ...values), low = Math.min(0, ...values);
  const range = high - low || 1;
  const zero = PLOT * high / range;
  const cursors = barCursors(entry.frame, values.length);
  const cells = entry.grid.rows[0];
  const was = (c: number) => before && !before.unset ? before.grid.rows[0]?.[c] : undefined;
  return <div className="dp-scroll" tabIndex={0} role="region" aria-label={`${entry.name} as bars`}>
    <ol className="dp-bars" style={{'--plot': `${PLOT}px`} as CSSProperties}>
      {values.map((value, c) => {
        const old = was(c);
        const isNew = old !== undefined && old !== cells[c];
        const names = cursors.get(c);
        const height = value === 0 ? 0 : Math.max(PLOT * Math.abs(value) / range, 2);
        return <li key={c} className={[isNew ? 'dp-new' : '', names ? 'dp-aimed' : ''].join(' ').trim() || undefined}
          title={isNew ? `${entry.name}[${c}] = ${cells[c]}, was ${old}` : `${entry.name}[${c}] = ${cells[c]}`}>
          <span className="dp-plot"><span className="dp-bar" style={{top: value >= 0 ? zero - height : zero, height}} />
            {low < 0 && <span className="dp-zero" style={{top: zero}} />}</span>
          <span className="dp-bar-value">{cells[c]}</span>
          <span className="dp-bar-index">{c}</span>
          <span className="dp-bar-names">{names?.join(' ')}</span>
        </li>;
      })}
    </ol>
  </div>;
}

function Table({entry, before, bars}: {entry: Entry; before?: Entry; bars: boolean}) {
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
  const values = bars && !entry.unset ? numbers(grid) : null;
  return <figure className="dp-table">
    <figcaption>
      <strong>{entry.name}</strong>
      <span className="dp-owner">{entry.owner}</span>
      <span className="dp-type" title={entry.local.type}>{shortType(entry.local.type)} · {size}</span>
    </figcaption>
    {entry.unset
      ? <p className="dp-unset">not set yet</p>
      : values ? <Bars entry={entry} before={before} values={values} />
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
  // Browser storage may be unavailable; the choice then lasts only for this visit.
  const [bars, setBars] = useState(() => {try {return localStorage.getItem(BARS_KEY) === '1';} catch {return false;}});
  const toggleBars = () => setBars(on => {
    try {localStorage.setItem(BARS_KEY, on ? '0' : '1');} catch {/* a convenience only */}
    return !on;
  });
  const canBar = entries.some(entry => numbers(entry.grid));
  return <section className="dp-panel" aria-label="Arrays and DP tables">
    <div className="panel-title"><h2>Tables</h2><span>{entries.length} at this stop</span></div>
    <div className="tree-controls">
      <ul className="tree-legend" aria-label="Legend">
        <li><span className="dp-swatch new" aria-hidden="true">7</span>Written this step</li>
        <li><span className="dp-swatch cursor" aria-hidden="true">i</span>Where the loop index points</li>
      </ul>
      {canBar && <button className={`ghost ${bars ? 'on' : ''}`} aria-pressed={bars} onClick={toggleBars}
        title="Draw one-dimensional arrays of numbers as bars">Bars</button>}
      <InfoTip label="About tables">Arrays, <code>std::array</code> and <code>vector</code>s of numbers show up here as
        grids, including 2D tables like <code>dp[i][j]</code> and file-scope arrays such as a global
        <code> int dp[100]</code>. A cell marked green was written at this stop; hover it for the value it had before.
        The debugger records values, not reads, so the <strong>i</strong> and <strong>j</strong> marks show where loop
        indexes named i, j (or r, c) point: usually the cells the current line reads and writes. Large tables show
        their first rows and columns. <strong>Bars</strong> draws 1D arrays of numbers as bar heights, which suits
        sorting and searching; there the marks also cover indexes named k, lo, hi, mid, left and right.</InfoTip>
    </div>
    <div className="dp-list">
      {entries.length
        ? entries.map(entry => <Table key={entry.key} entry={entry} before={before.get(entry.key)} bars={bars} />)
        : <p className="empty">No arrays or vectors of numbers at this stop.</p>}
    </div>
  </section>;
}
