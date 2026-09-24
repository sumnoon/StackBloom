import {localKey, ownPointer, pointerText, shortType, shortValue} from './display';
import {InfoTip} from './InfoTip';
import type {Frame, Local, Snapshot} from './trace';
import type {Watch} from './Watches';

/** How a local reads in the panel: leftover memory is labelled, pointers name
 *  where they go, containers lose the printer's preamble. Raw text is the tooltip. */
function display(local: Local, unset: boolean, snapshot: Snapshot) {
  if (local.status !== 'readable') return {text: local.status.replace('_', ' '), muted: true};
  if (unset) return {text: 'not set yet', muted: true, title: `Leftover memory until it is assigned: ${local.value}`};
  const pointer = ownPointer(local);
  if (pointer) return {text: pointerText(pointer, snapshot), title: `${local.value} · ${pointer.state}`};
  const {text, count} = shortValue(local.value ?? '');
  return {text, count, title: text === local.value ? undefined : local.value ?? undefined};
}

/** A snapshot contains the active branch, not the history of completed calls. */
export function StackTree({snapshot, previousFrames = [], unset, previousUnset, watched = [], onWatch, selectedCall, onInspect}: {
  selectedCall?: string | null; onInspect?: (frame: Frame) => void;
  snapshot: Snapshot; previousFrames?: Frame[]; unset: Set<string>; previousUnset: Set<string>;
  watched?: Watch[]; onWatch?: (watch: Watch) => void;
}) {
  const frames = snapshot.frames;
  const path = [...frames].reverse();
  return <section className="stack-panel">
    <div className="panel-title"><h2>Call stack</h2><span>{frames.length} frames</span></div>
    <InfoTip>Caller at the top, the call running now at the bottom. Each bubble is one call with its own
      locals; returned calls disappear. A value marked <em>not set yet</em> is leftover memory: the line
      that declares it, or the call's argument setup, has not run.</InfoTip>
    <div className="stack-tree" aria-label="Active call tree">
      {path.length ? <ol className="call-path">{path.map((frame, depth) => {
        const current = depth === path.length - 1;
        const recursive = path.slice(0, depth).some(parent => parent.function === frame.function);
        const previous = frame.call_id ? previousFrames.find(item => item.call_id === frame.call_id) : undefined;
        // Remember what a value was, not merely that it moved; leftover memory is "not set", never a number.
        const changed = new Map(frame.locals.flatMap(local => {
          const old = previous?.locals.find(item => item.id === local.id);
          if (!old || unset.has(localKey(frame, local))) return [];
          if (old.value === local.value && old.status === local.status) return [];
          const was = previousUnset.has(localKey(previous!, old)) ? 'not set'
            : old.status === 'readable' ? display(old, false, snapshot).text : old.status.replace('_', ' ');
          return [[local.id, was] as const];
        }));
        const first = frame.locals[0];
        const summary = first ? display(first, unset.has(localKey(frame, first)), snapshot).text : '';
        return <li className="call-node" key={`${depth}:${frame.id}`} style={{marginLeft: Math.min(depth, 6) * 12}}>
          {depth > 0 && <div className="call-connector" aria-hidden="true"><span>↓ {recursive ? 'recursive call' : 'calls'}</span></div>}
          <article className={`call-bubble ${current ? 'current-call' : ''} ${selectedCall === (frame.call_id ?? frame.id) ? 'inspected-call' : ''}`} aria-label={`${frame.function}, depth ${depth}${current ? ', active' : ''}`}>
            <div className="call-heading"><h3><button className="inspect-call-button" onClick={() => onInspect?.(frame)} aria-pressed={selectedCall === (frame.call_id ?? frame.id)} title="Inspect this call in the source and recursion tree">{frame.function}</button></h3><span className="call-state">{current ? 'Executing' : 'Waiting'}</span></div>
            <div className="call-meta"><span>Depth {depth}</span><span>Line {frame.location.line}</span>{recursive && <span className="recursion-tag">Recursion</span>}</div>
            <details open={current} className="call-values"><summary>{frame.locals.length} locals{!current && first ? ` · ${first.name} = ${summary.slice(0, 36)}` : ''}</summary>
            <div className="bubble-locals">{frame.locals.map(local => {
              const shown = display(local, unset.has(localKey(frame, local)), snapshot);
              const members = local.pointers?.filter(edge => edge.path !== '') ?? [];
              return <div className={`local-box ${changed.has(local.id) ? 'value-changed' : ''}`} key={local.id}>
                <div><strong>{local.name}</strong><small title={local.type === shortType(local.type) ? undefined : local.type}>{shortType(local.type)}</small>
                  {onWatch && <button className={`watch-toggle ${watched.some(w => w.fn === frame.function && w.name === local.name) ? 'on' : ''}`}
                    aria-pressed={watched.some(w => w.fn === frame.function && w.name === local.name)}
                    title={`Watch ${local.name} across the whole run`}
                    onClick={() => onWatch({fn: frame.function, name: local.name})}>Watch</button>}</div>
                <code className={shown.muted ? 'unset' : undefined} title={[shown.title, local.address && `at ${local.address}`].filter(Boolean).join(' · ') || undefined}>
                  {shown.text}{shown.count !== undefined && <span className="count-badge">{shown.count} {shown.count === 1 ? 'item' : 'items'}</span>}
                  {changed.has(local.id) && <span className="value-change-label">was <s>{(changed.get(local.id) || '—').slice(0, 24)}</s></span>}</code>
                {members.length > 0 && <div className="pointer-chips">{members.map(edge =>
                  <span key={edge.path} className={`pointer-chip ${edge.state}`} title={edge.target ?? undefined}>{edge.path} {pointerText(edge, snapshot)}</span>)}</div>}
              </div>;
            })}</div>
            {!frame.locals.length && <p className="note">No visible locals.</p>}
            </details>
            {frame.truncated && <p className="note">Some frame data is unavailable or truncated.</p>}
          </article>
        </li>;
      })}</ol> : <p className="empty">No active calls at this stop.</p>}
    </div>
  </section>;
}
