import React, {useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import sample from '../../examples/sample.trace.json';
import {parseTrace, type Trace} from './trace';
import './style.css';
import {StackTree} from './StackTree';
import {CallTree} from './CallTree';
import {MemoryGraph} from './MemoryGraph';
import {DEFAULT_LIMITS, SubmissionPane, type Draft} from './SubmissionPane';
import {Watches, type Watch} from './Watches';
import {highlight} from './highlight';
import {DepthSparkline, lineHeat, runStats} from './Sparkline';

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
  const [draft, setDraft] = useState<Draft>({source: sample.source.text, stdin: '3\n', ...DEFAULT_LIMITS});
  const [compileOutput, setCompileOutput] = useState('');
  const [watches, setWatches] = useState<Watch[]>([]);
  const [dragging, setDragging] = useState(false);
  const jumpMenu = useRef<HTMLDetailsElement>(null);
  const [tab, setTab] = useState<TabId>('stack');
  const [showCode, setShowCode] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [interval, setIntervalMs] = useState(750);
  const active = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const step = trace.snapshots[index];
  const last = trace.snapshots.length - 1;
  const highlighted = useMemo(() => highlight(trace.source.text), [trace.source.text]);
  const heat = useMemo(() => lineHeat(trace), [trace]);
  const stats = useMemo(() => runStats(trace), [trace]);
  const seek = (position: number) => {setPlaying(false); setIndex(position);};
  const move = (delta: number) => {setPlaying(false); setIndex(i => Math.max(0, Math.min(last, i + delta)));};
  const togglePlayback = () => {
    if (index === last) setIndex(0);
    setPlaying(value => !value);
  };
  useEffect(() => {
    if (!playing || view !== 'trace') return;
    if (index >= last) {setPlaying(false); return;}
    const timer = window.setTimeout(() => setIndex(i => Math.min(last, i + 1)), interval);
    return () => window.clearTimeout(timer);
  }, [playing, index, interval, last, view]);
  useEffect(() => {
    const pauseWhenHidden = () => {if (document.hidden) setPlaying(false);};
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => document.removeEventListener('visibilitychange', pauseWhenHidden);
  }, []);

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
  // Debugger verbs over recorded stops: nothing is re-executed.
  const depth = step.frames.length;
  const findAfter = (test: (i: number) => boolean) => {
    for (let i = index + 1; i <= last; i++) if (test(i)) return i;
    return undefined;
  };
  const stepOver = () => findAfter(i => trace.snapshots[i].frames.length <= depth);
  const stepOut = () => depth > 1 ? findAfter(i => trace.snapshots[i].frames.length < depth) : undefined;
  const runToLine = (line: number) => {
    const at = (i: number) => trace.snapshots[i].location?.line === line;
    const next = findAfter(at) ?? trace.snapshots.findIndex((_, i) => at(i));
    if (next >= 0) seek(next);
  };
  const jump = (target: number | undefined) => {
    if (target !== undefined) seek(target);
    jumpMenu.current?.removeAttribute('open');
  };
  const toggleWatch = (watch: Watch) => setWatches(current =>
    current.some(item => item.fn === watch.fn && item.name === watch.name)
      ? current.filter(item => item.fn !== watch.fn || item.name !== watch.name)
      : [...current, watch].slice(-3));
  const download = () => {
    const blob = new Blob([JSON.stringify(trace)], {type: 'application/json'});
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${trace.source.path.replace(/\.cpp$/, '')}-trace.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const drop = {
    onDragOver: (event: React.DragEvent) => {
      if (![...event.dataTransfer.types].includes('Files')) return;
      event.preventDefault(); setDragging(true);
    },
    onDragLeave: (event: React.DragEvent) => {if (event.currentTarget === event.target) setDragging(false);},
    onDrop: (event: React.DragEvent) => {
      event.preventDefault(); setDragging(false);
      void load(event.dataTransfer.files[0]);
    },
  };
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
      if ((e.target as HTMLElement).closest('input, button, textarea, select, summary, [role="button"], [contenteditable="true"]')) return;
      if (view !== 'trace') return;
      if (e.code === 'Space' && !e.repeat) {e.preventDefault(); togglePlayback(); return;}
      // GDB's own verbs: s(tep) into, n(ext) over, f(inish) out.
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const target = e.key === 'n' ? stepOver() : e.key === 'f' ? stepOut() : e.key === 's' ? Math.min(last, index + 1) : undefined;
        if (target !== undefined) {e.preventDefault(); seek(target); return;}
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault(); move(e.key === 'ArrowRight' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [last, view, index, trace]);
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
    setPlaying(false);
    setTrace(next);
    setIndex(next.snapshots[0].event === 'step' ? 0 : next.snapshots.length - 1);
    // A program that never ran has nothing to step through: stay on the editor
    // with the compiler's message, where the code can be fixed.
    const failed = next.snapshots.every(stop => stop.event === 'compile_error');
    setCompileOutput(failed ? next.snapshots[0].diagnostic?.message ?? 'The program did not compile.' : '');
    setError('');
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

  if (view === 'editor') return <div className={`app editor-view ${dragging ? 'dragging' : ''}`} {...drop}>
    <header className="topbar">
      <div className="brand"><span className="mark" aria-hidden="true" />
        <div><h1>StackBloom</h1><p>Watch your C++ grow, one call at a time.</p></div></div>
      <div className="topbar-actions">
        {trace.snapshots.length > 1 && <button onClick={() => setView('trace')}>Back to trace →</button>}
        {openTrace}
      </div>
    </header>
    <div className="editor-scroll">
      <section className="editor-intro"><div><h2>See what your code is thinking.</h2><p>Follow a call. Watch a value change. Make the next step click.</p></div>
        <button className="demo-link" onClick={() => {setView('trace'); setPlaying(false);}}>Explore the {trace === sample ? 'sample' : 'recorded'} trace <span aria-hidden="true">↗</span></button></section>
      {error && <div role="alert" className="diagnostic">{error}</div>}
      <SubmissionPane draft={draft} onDraft={setDraft} onTrace={show} compilerOutput={compileOutput} />
      <p className="hint">Your program is compiled and traced on this machine. Submit only code you trust.</p>
    </div>
  </div>;

  return <div className={`app trace-view ${dragging ? 'dragging' : ''}`} {...drop}>
    <header className="topbar">
      <div className="brand"><span className="mark" aria-hidden="true" />
        <div><h1>StackBloom</h1><p className="file">{trace.source.path} · C++17</p></div></div>
      <div className="topbar-actions">
        <span className={`event ${step.event}`}>{step.event.replace('_', ' ')}</span>
        <button onClick={() => {setPlaying(false); setView('editor');}}>← Edit code</button>
        <button onClick={download} title="Save this trace as JSON to open later or share">Download</button>
        {openTrace}
      </div>
    </header>

    <div className="controls">
      <div className="control-buttons">
        <button onClick={() => seek(0)} disabled={index === 0} aria-label="First stop" title="First stop">⏮</button>
        <button onClick={() => move(-1)} disabled={index === 0} aria-label="Previous stop" title="Back (←)">←</button>
        <button className="primary play-button" onClick={togglePlayback} disabled={last === 0} title="Play / pause (Space)">{playing ? 'Ⅱ Pause' : index === last ? '↻ Replay' : '▶ Play'}</button>
        <button onClick={() => move(1)} disabled={index === last} title="Step into: the very next stop (→ or s)">Step →</button>
        <button onClick={() => seek(stepOver()!)} disabled={stepOver() === undefined}
          title="Step over: the next stop in this call, skipping the calls it makes (n)">Over</button>
        <button onClick={() => seek(stepOut()!)} disabled={stepOut() === undefined}
          title="Step out: the first stop after this call returns (f)">Out</button>
        <label className="playback-speed"><span className="sr-only">Playback speed</span><select aria-label="Playback speed" value={interval} onChange={e => setIntervalMs(Number(e.target.value))}><option value={1500}>0.5×</option><option value={750}>1×</option><option value={375}>2×</option></select></label>
        <details className="jump-menu" ref={jumpMenu}><summary>Jump to</summary>
          <div className="jump-list">
            <button onClick={() => jump(deepest)} disabled={!trace.snapshots.some(s => s.frames.length > 1)}>Deepest call</button>
            <button onClick={() => jump(nextChange('heap'))} disabled={nextChange('heap') === undefined}>Next memory change</button>
            <button onClick={() => jump(nextChange('output'))} disabled={nextChange('output') === undefined}>Next output</button>
          </div>
        </details>
      </div>
      <div className="timeline">
        <div className="timeline-track">
          <DepthSparkline trace={trace} index={index} onSeek={seek} />
          <input id="timeline" type="range" min="0" max={last} value={index} aria-label="Execution timeline"
          style={{background: `linear-gradient(to right, var(--brand) ${last ? index / last * 100 : 0}%, var(--line-strong) ${last ? index / last * 100 : 0}%)`}}
          onChange={e => seek(Number(e.target.value))} />
        </div>
        <span className="stop-count">Stop <strong>{index + 1}</strong> / {last + 1}</span>
      </div>
    </div>

    {/* Announces where you are when stepping; silent during playback, which would chatter. */}
    <div className="execution-context" aria-live={playing ? 'off' : 'polite'}>
      <span className={`context-dot ${playing ? 'is-playing' : ''}`} /><strong>{step.frames[0]?.function ?? (step.event === 'exit' ? 'Execution finished' : 'Execution stopped')}</strong>
      <span>{step.location ? `Line ${step.location.line}` : step.event.replace('_', ' ')}</span><span className="context-stat">{step.frames.length} active {step.frames.length === 1 ? 'call' : 'calls'}</span>
      {changes.heap.includes(index) && <span className="change-tag">Memory changed</span>}{changes.output.includes(index) && <span className="change-tag">New output</span>}
      <span className="shortcut-hint">Space play · ← → step · n over · f out</span></div>

    {watches.length > 0 && <Watches trace={trace} index={index} watches={watches} onRemove={toggleWatch} onSeek={seek} />}

    {error && <div role="alert" className="diagnostic">{error}</div>}

    <div className={`workspace ${showCode ? '' : 'code-hidden'}`}>
      {showCode && <section className="source-panel">
        <div className="panel-title"><h2>{trace.source.path}</h2>
          <button className="ghost" onClick={() => setShowCode(false)} title="Hide the source to widen the panels">Hide code</button></div>
        <div className="source" tabIndex={0} aria-label="Source code">
          {trace.source.text.split('\n').map((line, i) => <div key={i} ref={step.location?.line === i + 1 ? active : null}
            className={`code-line ${step.location?.line === i + 1 ? 'active' : ''}`}
            aria-current={step.location?.line === i + 1 ? 'step' : undefined}>
            {/* Lines the program stopped at double as "run to this line" targets. */}
            {heat.counts.has(i + 1)
              ? <button className="line-number" onClick={() => runToLine(i + 1)}
                  style={{'--heat': (heat.counts.get(i + 1)! / heat.hottest).toFixed(3)} as React.CSSProperties}
                  aria-label={`Run to line ${i + 1}`}
                  title={`Run to line ${i + 1} · stopped here ${heat.counts.get(i + 1)} ${heat.counts.get(i + 1) === 1 ? 'time' : 'times'}`}>
                  {i + 1}</button>
              : <span className="line-number">{i + 1}</span>}<code>{highlighted[i]?.length ? highlighted[i] : line || ' '}</code></div>)}
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
          {tab === 'stack' && <StackTree frames={step.frames} previousFrames={trace.snapshots[index - 1]?.frames}
            watched={watches} onWatch={toggleWatch} />}
          {tab === 'calls' && <CallTree trace={trace} index={index} onSeek={seek} />}
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
      role="status">
      <div className="diagnostic-text"><strong>{step.event.replace('_', ' ')}</strong><pre>{step.diagnostic.message}</pre></div>
      {/* The whole recording in numbers, once the program has reached its end. */}
      <dl className="run-stats" aria-label="Run summary">
        <div><dt>Stops</dt><dd>{stats.stops.toLocaleString()}</dd></div>
        {stats.calls > 0 && <div><dt>Calls</dt><dd>{stats.calls}</dd></div>}
        <div><dt>Deepest stack</dt><dd>{stats.depth}</dd></div>
        {stats.allocations > 0 && <div><dt>Heap objects</dt><dd>{stats.allocations}{stats.live ? ` · ${stats.live} at the end` : ''}</dd></div>}
        {stats.output > 0 && <div><dt>Output</dt><dd>{stats.output.toLocaleString()} bytes</dd></div>}
      </dl>
    </div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
