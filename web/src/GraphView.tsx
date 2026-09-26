import {InfoTip} from './InfoTip';
import {shortType} from './display';
import {annotate, graphsAt, labelText, type Graph} from './graph';
import type {Snapshot, Trace} from './trace';
import './graph.css';

const R = 19;

function GraphFigure({graph, snapshot, before, unset}: {graph: Graph; snapshot: Snapshot; before?: Graph; unset: Set<string>}) {
  const {n, edges, directed} = graph;
  const notes = annotate(snapshot, n, unset);
  // Nodes sit on a circle, node 0 at the top, going clockwise: stable from stop to stop.
  const radius = Math.max(110, (n * (R * 2 + 30)) / (2 * Math.PI));
  const pad = R + 46, size = 2 * (radius + pad);
  const at = (i: number) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return {x: size / 2 + radius * Math.cos(angle), y: size / 2 + radius * Math.sin(angle)};
  };
  const known = new Set(before?.edges.map(([u, v]) => `${u}>${v}`));
  const onPath = new Set(notes.path.slice(0, -1).map((u, i) => `${notes.path[i + 1]}>${u}`));
  const examining = (u: number, v: number) => notes.current !== undefined && notes.neighbour !== undefined
    && ((u === notes.current && v === notes.neighbour) || (!directed && v === notes.current && u === notes.neighbour));
  const arrowId = `arrow-${graph.key.replace(/[^\w-]/g, '_')}`;
  const waiting = [...notes.waiting.entries()].sort((a, b) => a[1] - b[1]).map(([node]) => node);
  const summary = `${graph.name}: ${n} nodes, ${edges.length} ${directed ? 'directed' : ''} edges`;
  return <figure className="graph-figure">
    <figcaption>
      <strong>{graph.name}</strong>
      <span className="dp-owner">{graph.owner}</span>
      <span className="dp-type" title={graph.type}>{shortType(graph.type)} · {n} nodes · {edges.length} {directed ? 'arrows' : 'edges'}</span>
    </figcaption>
    <div className="graph-scroll">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={summary} className="graph-svg">
        <defs>
          {/* One arrowhead per edge colour: a marker cannot take its line's stroke everywhere yet. */}
          {['', 'path', 'examining', 'new'].map(kind => <marker key={kind} id={`${arrowId}-${kind}`} viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" className={`graph-arrow ${kind}`} /></marker>)}
        </defs>
        {edges.map(([u, v], i) => {
          const a = at(u), b = at(v);
          const kind = examining(u, v) ? 'examining' : onPath.has(`${u}>${v}`) || (!directed && onPath.has(`${v}>${u}`)) ? 'path'
            : before && !known.has(`${u}>${v}`) ? 'new' : '';
          if (u === v) return <circle key={i} className={`graph-edge ${kind}`} cx={a.x} cy={a.y - R - 9} r={10} fill="none" />;
          const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
          const ux = dx / length, uy = dy / length;
          return <line key={i} className={`graph-edge ${kind}`} x1={a.x + ux * R} y1={a.y + uy * R}
            x2={b.x - ux * (R + (directed ? 3 : 0))} y2={b.y - uy * (R + (directed ? 3 : 0))}
            markerEnd={directed ? `url(#${arrowId}-${kind})` : undefined} />;
        })}
        {Array.from({length: n}, (_, i) => {
          const p = at(i);
          const state = i === notes.current ? 'current' : notes.path.includes(i) ? 'on-path' : notes.visited.has(i) ? 'visited' : '';
          const queued = notes.waiting.get(i);
          // Annotations sit outside the circle, along the line from its centre, so edges never cross them.
          const out = (distance: number) => ({x: p.x + (p.x - size / 2) / radius * distance, y: p.y + (p.y - size / 2) / radius * distance});
          const values = notes.labels.map(table => labelText(table.row[i])).join(' · ');
          const name = i === notes.current ? notes.currentName : i === notes.neighbour ? notes.neighbourName : undefined;
          const valueAt = out(R + 12), nameAt = out(R + (values ? 32 : 14));
          return <g key={i} className={`graph-node ${state} ${queued ? 'queued' : ''} ${i === notes.neighbour ? 'neighbour' : ''}`}>
            <circle cx={p.x} cy={p.y} r={R} />
            <text x={p.x} y={p.y} className="graph-id">{i}</text>
            {values && <text x={valueAt.x} y={valueAt.y} className="graph-label">{values}</text>}
            {name && <text x={nameAt.x} y={nameAt.y} className={`graph-name ${i === notes.current ? '' : 'soft'}`}>{name}</text>}
          </g>;
        })}
      </svg>
    </div>
    {notes.frontierName && <div className="graph-frontier">
      <span><code>{notes.frontierName}</code>, {notes.stack ? 'top' : 'front'} first</span>
      {waiting.length ? <ol aria-label={`${notes.frontierName}, ${notes.stack ? 'top' : 'front'} first`}>{waiting.map(node => <li key={node}>{node}</li>)}</ol>
        : <span className="graph-frontier-empty">empty</span>}
    </div>}
    <ul className="graph-key" aria-label="What the marks mean">
      {notes.currentName && <li><span className="graph-swatch current" aria-hidden="true" /><span><code>{notes.currentName}</code> is the node being worked on
        {notes.neighbourName && notes.neighbour !== undefined ? <>, and <code>{notes.neighbourName}</code> the neighbour it is looking at</> : null}</span></li>}
      {notes.path.length > 1 && <li><span className="graph-swatch on-path" aria-hidden="true" /><span>Still on the call stack</span></li>}
      {notes.visitedName && <li><span className="graph-swatch visited" aria-hidden="true" /><span>Marked in <code>{notes.visitedName}</code></span></li>}
      {notes.frontierName && <li><span className="graph-swatch queued" aria-hidden="true" /><span>Waiting in <code>{notes.frontierName}</code></span></li>}
      {notes.labels.length > 0 && <li><span className="graph-label-key" aria-hidden="true">2</span><span>Beside each node: {notes.labels.map(item => item.local.name).join(' · ')}</span></li>}
      {before && edges.some(([u, v]) => !known.has(`${u}>${v}`)) && <li><span className="graph-line new" aria-hidden="true" /><span>Added at this stop</span></li>}
    </ul>
  </figure>;
}

export function GraphView({trace, index, unset, previousUnset}: {
  trace: Trace; index: number; unset: Set<string>; previousUnset: Set<string>;
}) {
  const snapshot = trace.snapshots[index];
  const found = graphsAt(snapshot, unset);
  const before = new Map(graphsAt(trace.snapshots[index - 1], previousUnset).map(item => [item.graph.key, item.graph]));
  return <section className="graph-panel" aria-label="Graphs from adjacency lists">
    <div className="panel-title"><h2>Graph</h2><span>{found.length ? `${found.length} at this stop` : 'none at this stop'}</span></div>
    <div className="tree-controls">
      <span />
      <InfoTip label="About the graph view">A <code>vector&lt;vector&lt;int&gt;&gt;</code> whose values are all valid row
        numbers is drawn as a graph: row <em>u</em> lists the neighbours of node <em>u</em>. It needs a name such as
        <code> adj</code>, <code>graph</code> or <code>g</code>, or rows of different lengths; a named square table of 0s and
        1s is read as an adjacency matrix. The marks come from your variable names: <code>u</code> or <code>node</code> is the
        current node and <code>v</code> the neighbour being looked at, a <code>bool</code> array such as <code>visited</code>
        fills nodes in, a <code>std::queue</code> or <code>std::stack</code> numbers the nodes waiting in it, and arrays
        like <code>dist</code> or <code>parent</code> are written under each node.</InfoTip>
    </div>
    <div className="graph-list">
      {found.length
        ? found.map(({graph}) => <GraphFigure key={graph.key} graph={graph} snapshot={snapshot} before={before.get(graph.key)} unset={unset} />)
        : <p className="empty">No adjacency list at this stop. It appears once the program has built one.</p>}
    </div>
  </section>;
}
