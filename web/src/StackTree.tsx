import type {Frame, PointerState} from './trace';

const pointerText: Record<PointerState, string> = {
  null: 'null', heap: 'heap object', stack: 'stack', dangling: 'dangling', unknown: 'unproven',
};

/** A snapshot contains the active branch, not the history of completed calls. */
export function StackTree({frames}: {frames: Frame[]}) {
  const path = [...frames].reverse();
  return <section className="stack-panel">
    <div className="panel-title"><h2>Call stack</h2><span>{frames.length} frames</span></div>
    <p className="note">Caller → callee. Each bubble is a separate call with its own locals.</p>
    <div className="stack-tree" aria-label="Active call tree">
      {path.length ? <ol className="call-path">{path.map((frame, depth) => {
        const current = depth === path.length - 1;
        const recursive = path.slice(0, depth).some(parent => parent.function === frame.function);
        return <li className="call-node" key={`${depth}:${frame.id}`} style={{marginLeft: Math.min(depth, 6) * 12}}>
          {depth > 0 && <div className="call-connector" aria-hidden="true"><span>↓ {recursive ? 'recursive call' : 'calls'}</span></div>}
          <article className={`call-bubble ${current ? 'current-call' : ''}`} aria-label={`${frame.function}, depth ${depth}${current ? ', active' : ''}`}>
            <div className="call-heading"><h3>{frame.function}</h3><span className="call-state">{current ? 'Executing' : 'Waiting'}</span></div>
            <div className="call-meta"><span>Depth {depth}</span><span>Line {frame.location.line}</span>{recursive && <span className="recursion-tag">Recursion</span>}</div>
            <details open={current} className="call-values"><summary>{frame.locals.length} locals{!current && frame.locals[0]?.status === 'readable' ? ` · ${frame.locals[0].name} = ${frame.locals[0].value?.slice(0, 36)}` : ''}</summary>
            <div className="bubble-locals">{frame.locals.map(local => <div className="local-box" key={local.id}>
              <div><strong>{local.name}</strong><small>{local.type}</small></div>
              <code title={local.address ?? undefined}>{local.status === 'readable' ? local.value : local.status.replace('_', ' ')}</code>
              {local.pointers?.length ? <div className="pointer-chips">{local.pointers.map(edge =>
                <span key={edge.path} className={`pointer-chip ${edge.state}`}>{edge.path ? `${edge.path} ` : ''}{pointerText[edge.state]}</span>)}</div> : null}
            </div>)}</div>
            {!frame.locals.length && <p className="note">No visible locals.</p>}
            </details>
            {frame.truncated && <p className="note">Some frame data is unavailable or truncated.</p>}
          </article>
        </li>;
      })}</ol> : <p className="empty">No active calls at this stop.</p>}
    </div>
    <p className="note">Shows the active branch; returned calls disappear. Readable locals may still be uninitialized.</p>
  </section>;
}
