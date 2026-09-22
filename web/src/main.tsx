import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import sample from '../../examples/sample.trace.json';
import {parseTrace, type Trace} from './trace';
import './style.css';
import {StackTree} from './StackTree';
import {CallTree} from './CallTree';
import {MemoryGraph} from './MemoryGraph';
import {SubmissionPane} from './SubmissionPane';

function App() {
  const [trace, setTrace] = useState<Trace>(() => parseTrace(sample));
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const active = useRef<HTMLDivElement>(null);
  const step = trace.snapshots[index];
  const last = trace.snapshots.length - 1;
  const move = (delta: number) => setIndex(i => Math.max(0, Math.min(last, i + delta)));

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, button, textarea, select')) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault(); move(e.key === 'ArrowRight' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [last]);
  useEffect(() => {
    const line = active.current;
    const pane = line?.parentElement;
    if (!line || !pane) return;
    // Scroll only the code pane, so stepping does not move the page/controls.
    if (line.offsetTop < pane.scrollTop) pane.scrollTop = line.offsetTop;
    else if (line.offsetTop + line.offsetHeight > pane.scrollTop + pane.clientHeight)
      pane.scrollTop = line.offsetTop + line.offsetHeight - pane.clientHeight;
  }, [index, trace]);

  async function load(file?: File) {
    if (!file) return;
    try {
      if (file.size > 64 * 1024 * 1024) throw new Error('Choose a trace smaller than 64 MiB.');
      const next = parseTrace(JSON.parse(await file.text()));
      setTrace(next); setIndex(0); setError('');
    } catch (e) {setError(e instanceof Error ? e.message : 'Cannot read this trace.');}
  }

  return <main>
    <header><div><h1>StackBloom</h1><p>Watch your C++ grow, one call at a time.</p></div>
      <label className="upload">Open trace <input aria-label="Open JSON trace" type="file" accept=".json" onChange={e => {void load(e.target.files?.[0]); e.target.value = '';}} /></label>
    </header>
    <SubmissionPane initialSource={sample.source.text} onTrace={next => {setTrace(next); setIndex(next.snapshots[0].event === 'step' ? 0 : next.snapshots.length - 1); setError('');}} />
    {error && <div role="alert" className="diagnostic">{error}</div>}
    <div className="toolbar">
      <button onClick={() => setIndex(0)} disabled={index === 0} aria-label="First snapshot">First</button>
      <button onClick={() => move(-1)} disabled={index === 0}>← Back</button>
      <button className="primary" onClick={() => move(1)} disabled={index === last}>Forward →</button>
      <button onClick={() => setIndex(trace.snapshots.reduce((best, stop, i, stops) => stop.frames.length >= stops[best].frames.length ? i : best, 0))} disabled={!trace.snapshots.some(stop => stop.frames.length > 1)}>Deepest call</button>
      <span aria-live="polite">Stop {index + 1} of {last + 1}</span><span className={`event ${step.event}`}>{step.event.replace('_', ' ')}</span>
    </div>
    <div className="workspace">
      <section className="source-panel"><div className="panel-title"><h2>{trace.source.path}</h2><span>C++17</span></div>
        <div className="source" tabIndex={0} aria-label="Source code">
          {trace.source.text.split('\n').map((line, i) => <div key={i} ref={step.location?.line === i + 1 ? active : null}
            className={`code-line ${step.location?.line === i + 1 ? 'active' : ''}`} aria-current={step.location?.line === i + 1 ? 'step' : undefined}>
            <span className="line-number">{i + 1}</span><code>{line || ' '}</code></div>)}
        </div>
        <p className="note">Highlight marks the next line to execute. A line may produce several stops.</p>
      </section>
      <StackTree frames={step.frames} />
    </div>
    <MemoryGraph trace={trace} index={index} />
    <CallTree trace={trace} index={index} onSeek={setIndex} />
    <section className="timeline"><label htmlFor="timeline">Execution timeline</label><input id="timeline" type="range" min="0" max={last} value={index} onChange={e => setIndex(Number(e.target.value))} /><small>Use ← / → to step through recorded state.</small></section>
    {step.diagnostic && <div className={`diagnostic ${step.event === 'exit' && step.diagnostic.exit_code === 0 ? 'success' : ''}`} role="status"><strong>{step.event.replace('_', ' ')}</strong><pre>{step.diagnostic.message}</pre></div>}
    <section className="output"><div><h2>stdout</h2><pre>{step.stdout || 'No output flushed yet.'}</pre></div><div><h2>stderr</h2><pre>{step.stderr || 'No diagnostic output.'}</pre></div></section>
    {step.output_truncated && <p role="status">Output was truncated at the configured byte limit.</p>}
    <footer>StackBloom · C++ execution visualizer · Replay never re-executes the program</footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
