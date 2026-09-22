import React, {useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import sample from '../../examples/sample.trace.json';
import {parseTrace, type Trace} from './trace';
import './style.css';
import {StackTree} from './StackTree';
import {CallTree} from './CallTree';
import {MemoryGraph} from './MemoryGraph';
import {SubmissionPane, type Draft} from './SubmissionPane';

type TabId = 'stack' | 'calls' | 'memory' | 'output';
const TABS: {id: TabId; label: string}[] = [
  {id: 'stack', label: 'Call stack'},
  {id: 'calls', label: 'Recursion tree'},
  {id: 'memory', label: 'Memory'},
  {id: 'output', label: 'Output'},
];

function App() {
  const [trace, setTrace] = useState<Trace>(() => parseTrace(sample));
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [view, setView] = useState<'editor' | 'trace'>('editor');
  const [draft, setDraft] = useState<Draft>({source: sample.source.text, stdin: '3\n'});
  const [tab, setTab] = useState<TabId>('stack');
  const [showCode, setShowCode] = useState(true);
  const active = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const step = trace.snapshots[index];
  const last = trace.snapshots.length - 1;
  const move = (delta: number) => setIndex(i => Math.max(0, Math.min(last, i + delta)));

  /** Stops where memory or output actually differs, for the skip buttons. */
  const changes = useMemo(() => {
    const heap: number[] = [], output: number[] = [];
    for (let i = 1; i <= last; i++) {
      const before = trace.snapshots[i - 1], now = trace.snapshots[i];
      if (JSON.stringify(now.heap) !== JSON.stringify(before.heap)) heap.push(i);
      if (now.stdout !== before.stdout || now.stderr !== before.stderr) output.push(i);
    }
    return {heap, output};
  }, [trace]);
  const nextChange = (kind: 'heap' | 'output') => changes[kind].find(i => i > index);
  const deepest = useMemo(() => trace.snapshots.reduce(
    (best, stop, i, stops) => stop.frames.length >= stops[best].frames.length ? i : best, 0), [trace]);
  // Badges answer "is there anything here?" before the tab is opened.
  const counts: Record<TabId, string | number> = {
    stack: step.frames.length,
    calls: '',
    memory: Object.keys(step.heap).length,
    output: (step.stdout + step.stderr).length ? '•' : '',
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, button, textarea, select')) return;
      if (view !== 'trace') return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault(); move(e.key === 'ArrowRight' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [last, view]);
  useEffect(() => {
    const line = active.current;
    const pane = line?.parentElement;
    if (!line || !pane) return;
    // Scroll only the code pane, so stepping never moves the controls.
    if (line.offsetTop < pane.scrollTop) pane.scrollTop = line.offsetTop;
    else if (line.offsetTop + line.offsetHeight > pane.scrollTop + pane.clientHeight)
      pane.scrollTop = line.offsetTop + line.offsetHeight - pane.clientHeight;
  }, [index, trace, view, showCode]);

  async function load(file?: File) {
    if (!file) return;
    try {
      if (file.size > 64 * 1024 * 1024) throw new Error('Choose a trace smaller than 64 MiB.');
      const next = parseTrace(JSON.parse(await file.text()));
      show(next);
    } catch (e) {setError(e instanceof Error ? e.message : 'Cannot read this trace.');}
  }

  function show(next: Trace) {
    setTrace(next);
    setIndex(next.snapshots[0].event === 'step' ? 0 : next.snapshots.length - 1);
    // A program that never ran has nothing to step through: stay on the editor
    // with the compiler's message, where the code can be fixed.
    const failed = next.snapshots.every(stop => stop.event === 'compile_error');
    setError(failed ? next.snapshots[0].diagnostic?.message ?? 'The program did not compile.' : '');
    setView(failed ? 'editor' : 'trace');
  }

  /** Roving focus across the tab strip, as expected of a tablist. */
  function tabKey(event: React.KeyboardEvent, position: number) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (position + step + TABS.length) % TABS.length;
    setTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  }

  const openTrace = <label className="upload">Open trace
    <input aria-label="Open JSON trace" type="file" accept=".json"
      onChange={e => {void load(e.target.files?.[0]); e.target.value = '';}} /></label>;

  if (view === 'editor') return <div className="app editor-view">
    <header className="topbar">
      <div className="brand"><span className="mark" aria-hidden="true" />
        <div><h1>StackBloom</h1><p>Watch your C++ grow, one call at a time.</p></div></div>
      <div className="topbar-actions">
        {trace.snapshots.length > 1 && <button onClick={() => setView('trace')}>Back to trace →</button>}
        {openTrace}
      </div>
    </header>
    <div className="editor-scroll">
      {error && <div role="alert" className="diagnostic"><strong>Compiler output</strong><pre>{error}</pre></div>}
      <SubmissionPane draft={draft} onDraft={setDraft} onTrace={show} />
      <p className="hint">Your program is compiled and traced on this machine. Submit only code you trust.</p>
    </div>
  </div>;

  return <div className="app trace-view">
    <header className="topbar">
      <div className="brand"><span className="mark" aria-hidden="true" />
        <div><h1>StackBloom</h1><p className="file">{trace.source.path} · C++17</p></div></div>
      <div className="topbar-actions">
        <span className={`event ${step.event}`}>{step.event.replace('_', ' ')}</span>
        <button onClick={() => setView('editor')}>← Edit code</button>
        {openTrace}
      </div>
    </header>

    <div className="controls">
      <div className="control-buttons">
        <button onClick={() => setIndex(0)} disabled={index === 0} aria-label="First stop" title="First stop">⏮</button>
        <button onClick={() => move(-1)} disabled={index === 0} aria-label="Previous stop" title="Back (←)">←</button>
        <button className="primary" onClick={() => move(1)} disabled={index === last} title="Forward (→)">Forward →</button>
        <button onClick={() => setIndex(deepest)} disabled={!trace.snapshots.some(s => s.frames.length > 1)}
          title="Jump to the deepest point of the call stack">Deepest call</button>
        <button onClick={() => setIndex(nextChange('heap')!)} disabled={nextChange('heap') === undefined}
          title="Next stop where a heap object changes">Next memory change</button>
        <button onClick={() => setIndex(nextChange('output')!)} disabled={nextChange('output') === undefined}
          title="Next stop that flushes new output">Next output</button>
      </div>
      <div className="timeline">
        <input id="timeline" type="range" min="0" max={last} value={index} aria-label="Execution timeline"
          onChange={e => setIndex(Number(e.target.value))} />
        <span className="stop-count" aria-live="polite">Stop {index + 1} / {last + 1}</span>
      </div>
    </div>

    {error && <div role="alert" className="diagnostic">{error}</div>}

    <div className={`workspace ${showCode ? '' : 'code-hidden'}`}>
      {showCode && <section className="source-panel">
        <div className="panel-title"><h2>{trace.source.path}</h2>
          <button className="ghost" onClick={() => setShowCode(false)} title="Hide the source to widen the panels">Hide code</button></div>
        <div className="source" tabIndex={0} aria-label="Source code">
          {trace.source.text.split('\n').map((line, i) => <div key={i} ref={step.location?.line === i + 1 ? active : null}
            className={`code-line ${step.location?.line === i + 1 ? 'active' : ''}`}
            aria-current={step.location?.line === i + 1 ? 'step' : undefined}>
            <span className="line-number">{i + 1}</span><code>{line || ' '}</code></div>)}
        </div>
        <p className="note">The highlight marks the next line to execute. A line may produce several stops.</p>
      </section>}

      <section className="detail-panel">
        <div className="tabs" role="tablist" aria-label="Execution views">
          {TABS.map((item, position) => <button key={item.id} role="tab" id={`tab-${item.id}`}
            ref={element => {tabRefs.current[position] = element;}}
            aria-selected={tab === item.id} aria-controls={`panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1}
            className={`tab ${tab === item.id ? 'selected' : ''}`}
            onClick={() => setTab(item.id)} onKeyDown={e => tabKey(e, position)}>
            {item.label}{counts[item.id] !== '' && <span className="tab-badge">{counts[item.id]}</span>}
          </button>)}
          {!showCode && <button className="ghost show-code" onClick={() => setShowCode(true)}>Show code</button>}
        </div>
        <div className="tab-panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'stack' && <StackTree frames={step.frames} />}
          {tab === 'calls' && <CallTree trace={trace} index={index} onSeek={setIndex} />}
          {tab === 'memory' && <MemoryGraph trace={trace} index={index} />}
          {tab === 'output' && <section className="output">
            <div><h2>stdout</h2><pre>{step.stdout || 'No output flushed yet.'}</pre></div>
            <div><h2>stderr</h2><pre>{step.stderr || 'No diagnostic output.'}</pre></div>
            {step.output_truncated && <p role="status" className="note">Output was truncated at the byte limit.</p>}
          </section>}
        </div>
      </section>
    </div>

    {step.diagnostic && <div className={`diagnostic strip ${step.event === 'exit' && step.diagnostic.exit_code === 0 ? 'success' : ''}`}
      role="status"><strong>{step.event.replace('_', ' ')}</strong><pre>{step.diagnostic.message}</pre></div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
