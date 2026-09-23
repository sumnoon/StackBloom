import type {Frame, PointerState} from './trace';
import type {Watch} from './Watches';

const pointerText: Record<PointerState, string> = {
  null: 'null', heap: 'heap object', stack: 'stack', dangling: 'dangling', unknown: 'unproven',
};

/** A snapshot contains the active branch, not the history of completed calls. */
export function StackTree({frames, previousFrames = [], watched = [], onWatch}: {
  frames: Frame[]; previousFrames?: Frame[]; watched?: Watch[]; onWatch?: (watch: Watch) => void;
}) {
  const path = [...frames].reverse();
  return <section className="stack-panel">
    <div className="panel-title"><h2>Call stack</h2><span>{frames.length} frames</span></div>
    <p className="note">Caller → callee. Each bubble is a separate call with its own locals.</p>
    <div className="stack-tree" aria-label="Active call tree">
      {path.length ? <ol className="call-path">{path.map((frame, depth) => {
        const current = depth === path.length - 1;
        const recursive = path.slice(0, depth).some(parent => parent.function === frame.function);
        const previous = frame.call_id ? previousFrames.find(item => item.call_id === frame.call_id) : undefined;
        // Remember what a value was, not merely that it moved.
        const changed = new Map(frame.locals.flatMap(local => {
          const old = previous?.locals.find(item => item.id === local.id);
          return old && (old.value !== local.value || old.status !== local.status)
            ? [[local.id, old.status === 'readable' ? old.value ?? '' : old.status.replace('_', ' ')] as const] : [];
        }));
        return <li className="call-node" key={`${depth}:${frame.id}`} style={{marginLeft: Math.min(depth, 6) * 12}}>
          {depth > 0 && <div className="call-connector" aria-hidden="true"><span>↓ {recursive ? 'recursive call' : 'calls'}</span></div>}
          <article className={`call-bubble ${current ? 'current-call' : ''}`} aria-label={`${frame.function}, depth ${depth}${current ? ', active' : ''}`}>
            <div className="call-heading"><h3>{frame.function}</h3><span className="call-state">{current ? 'Executing' : 'Waiting'}</span></div>
            <div className="call-meta"><span>Depth {depth}</span><span>Line {frame.location.line}</span>{recursive && <span className="recursion-tag">Recursion</span>}</div>
            <details open={current} className="call-values"><summary>{frame.locals.length} locals{!current && frame.locals[0]?.status === 'readable' ? ` · ${frame.locals[0].name} = ${frame.locals[0].value?.slice(0, 36)}` : ''}</summary>
            <div className="bubble-locals">{frame.locals.map(local => <div className={`local-box ${changed.has(local.id) ? 'value-changed' : ''}`} key={local.id}>
              <div><strong>{local.name}</strong><small>{local.type}</small>
                {onWatch && <button className={`watch-toggle ${watched.some(w => w.fn === frame.function && w.name === local.name) ? 'on' : ''}`}
                  aria-pressed={watched.some(w => w.fn === frame.function && w.name === local.name)}
                  title={`Watch ${local.name} across the whole run`}
                  onClick={() => onWatch({fn: frame.function, name: local.name})}>Watch</button>}</div>
              <code title={local.address ?? undefined}>{local.status === 'readable' ? local.value : local.status.replace('_', ' ')}{changed.has(local.id) && <span className="value-change-label">
                  was <s>{(changed.get(local.id) || '—').slice(0, 24)}</s></span>}</code>
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
