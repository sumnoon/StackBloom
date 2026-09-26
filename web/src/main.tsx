import React, {useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import sample from '../../examples/sample.trace.json';
import {parseTrace, type Trace, type Frame} from './trace';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/jetbrains-mono/400-italic.css';
import '@fontsource/patrick-hand/400.css';
import './style.css';
import {Icon, SproutMark} from './Icon';
import {StackTree} from './StackTree';
import {CallTree} from './CallTree';
import {repeatedWork, type WorkSummary} from './RepeatReport';
import {callHistory} from './callHistory';
import {MemoryGraph} from './MemoryGraph';
import {DpTables, tableCount} from './DpTables';
import {DEFAULT_LIMITS, SubmissionPane, type Draft} from './SubmissionPane';
import {Watches, type Watch} from './Watches';
import {highlight} from './highlight';
import {DepthSparkline, lineHeat, runStats} from './Sparkline';
import {unsetLocals} from './display';
import {InfoTip} from './InfoTip';
import {EventTimeline} from './EventTimeline';
import {findQuestion, PredictCard, type Question} from './Predict';
import {ExportMenu, ExportProgress, type ExportKind} from './ExportMenu';
import {captureSvg, download as saveBlob, encodeGif, encodeVideo, exportPicture, type Frame as VideoFrame} from './exporter';

type TabId = 'stack' | 'calls' | 'tables' | 'memory' | 'output';
const TABS: {id: TabId; label: string}[] = [
  {id: 'stack', label: 'Call stack'},
  {id: 'calls', label: 'Recursion tree'},
  {id: 'tables', label: 'Tables'},
  {id: 'memory', label: 'Memory'},
  {id: 'output', label: 'Output'},
];

function App() {
  const [trace, setTrace] = useState<Trace>(() => parseTrace(sample));
  const [index, setIndex] = useState(0);
  const [selectedCall, setSelectedCall] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<'editor' | 'trace'>('editor');
  const [draft, setDraft] = useState<Draft>({source: sample.source.text, stdin: '3\n', ...DEFAULT_LIMITS});
  const [compileOutput, setCompileOutput] = useState('');
  const [watches, setWatches] = useState<Watch[]>([]);
  const [dragging, setDragging] = useState(false);
  const jumpMenu = useRef<HTMLDetailsElement>(null);
  const [tab, setTab] = useState<TabId>('stack');
  const [sourceWidth, setSourceWidth] = useState(42);
  const workspace = useRef<HTMLDivElement>(null);
  const detailPanel = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const changed = () => setExpanded(document.fullscreenElement === detailPanel.current);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  async function toggleExpanded() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await detailPanel.current?.requestFullscreen();
    } catch {setError('Fullscreen is unavailable in this browser. Use Hide code to widen the graph.');}
  }
  const [showCode, setShowCode] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [interval, setIntervalMs] = useState(750);
  const active = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const step = trace.snapshots[index];
  const inspected = step.frames.find(frame => (frame.call_id ?? frame.id) === selectedCall);
  const sourceLine = inspected?.location.line ?? step.location?.line;
  const inspectCall = (frame: Frame, at = index) => {
    setPlaying(false); setIndex(at); setSelectedCall(frame.call_id ?? frame.id); setShowCode(true);
  };
  const last = trace.snapshots.length - 1;
  const highlighted = useMemo(() => highlight(trace.source.text), [trace.source.text]);
  const heat = useMemo(() => lineHeat(trace), [trace]);
  const stats = useMemo(() => runStats(trace), [trace]);
  const unset = useMemo(() => unsetLocals(trace, index), [trace, index]);
  const previousUnset = useMemo(() => unsetLocals(trace, index - 1), [trace, index]);
  const [wrap, setWrap] = useState(false);
  // Predict mode: forward steps pause before a call returns and ask for the value first.
  const [predict, setPredict] = useState(false);
  const [question, setQuestion] = useState<Question | null>(null);
  const asked = useRef(new Set<string>());
  const [score, setScore] = useState({right: 0, total: 0});
  // Export: pictures of the current graph, and the recursion tree growing as a video or GIF.
  const [exporting, setExporting] = useState<{done: number; total: number; phase: string} | null>(null);
  const cancelExport = useRef(false);
  const baseName = trace.source.path.replace(/\.cpp$/, '');
  async function exportAs(kind: ExportKind) {
    setError('');
    const svg = document.querySelector<SVGSVGElement>(tab === 'memory' ? '.graph-canvas svg' : '.tree-canvas svg');
    try {
      if (kind === 'picture') {
        if (!svg) throw new Error('Open the recursion tree or the memory graph to export a picture.');
        await exportPicture(svg, `${baseName}-${tab === 'memory' ? 'memory' : 'tree'}-stop${index + 1}.png`);
        return;
      }
      await recordTree(kind);
    } catch (e) {setError(e instanceof Error ? e.message : 'The export failed.');}
  }
  /** Replays the run stop by stop on the recursion tree, capturing one frame per stop (at most 240). */
  async function recordTree(kind: 'video' | 'gif') {
    const start = index, startTab = tab;
    const every = Math.max(1, Math.ceil((last + 1) / 240));
    const stops = Array.from({length: Math.ceil((last + 1) / every)}, (_, n) => Math.min(last, n * every));
    if (stops[stops.length - 1] !== last) stops.push(last);
    cancelExport.current = false;
    setPlaying(false);
    // A recording replays the run itself; an open Predict question would only get in the way.
    setQuestion(null);
    document.documentElement.classList.add('exporting');
    const frames: VideoFrame[] = [];
    try {
      flushSync(() => setTab('calls'));
      await document.fonts.ready;
      for (const [n, stop] of stops.entries()) {
        if (cancelExport.current) return;
        flushSync(() => {setIndex(stop); setExporting({done: n + 1, total: stops.length, phase: 'Capturing stop'});});
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const svg = document.querySelector<SVGSVGElement>('.tree-canvas svg');
        if (!svg) continue;
        frames.push({drawing: await captureSvg(svg), note: document.querySelector('.step-note')?.textContent ?? '',
          stop: `Stop ${stop + 1} / ${last + 1}`});
      }
      if (!frames.length) throw new Error('This run has no calls to draw.');
      setExporting({done: 0, total: 0, phase: kind === 'video' ? 'Recording the video…' : 'Encoding the GIF…'});
      const frameMs = Math.max(120, Math.min(420, Math.round(14000 / frames.length)));
      if (kind === 'video') {
        const {blob, extension} = await encodeVideo(frames, trace.source.path, frameMs);
        if (!cancelExport.current) saveBlob(blob, `${baseName}-tree.${extension}`);
      } else {
        const blob = await encodeGif(frames, trace.source.path, frameMs);
        if (!cancelExport.current) saveBlob(blob, `${baseName}-tree.gif`);
      }
    } finally {
      document.documentElement.classList.remove('exporting');
      setIndex(start); setTab(startTab); setExporting(null);
    }
  }
  // The previous run's totals, so a memoized version can be compared with the plain one.
  const [baseline, setBaseline] = useState<WorkSummary | null>(null);
  const seek = (position: number) => {setSelectedCall(null); setPlaying(false); setIndex(position);};
  const move = (delta: number) => {
    if (delta > 0) {forward(Math.min(last, index + delta)); return;}
    setSelectedCall(null); setPlaying(false); setIndex(i => Math.max(0, Math.min(last, i + delta)));
  };
  /** Step, Over, Out and Play go through here; in Predict mode they stop to ask about a return first. */
  const forward = (target: number) => {
    const pending = predict && target > index ? findQuestion(trace, target, asked.current) : null;
    if (pending) {setPlaying(false); setQuestion(pending); return;}
    seek(target);
  };
  const answered = () => {
    if (!question) return;
    asked.current.add(question.callId);
    const target = question.target;
    setQuestion(null);
    seek(target);
  };
  const togglePlayback = () => {
    setSelectedCall(null);
    if (index === last) setIndex(0);
    setPlaying(value => !value);
  };
  useEffect(() => {
    if (!playing || view !== 'trace') return;
    if (index >= last) {setPlaying(false); return;}
    const timer = window.setTimeout(() => {
      const pending = predict ? findQuestion(trace, index + 1, asked.current) : null;
      if (pending) {setPlaying(false); setQuestion(pending); return;}
      setIndex(i => Math.min(last, i + 1));
    }, interval);
    return () => window.clearTimeout(timer);
  }, [playing, index, interval, last, view, predict, trace]);
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
    tables: tableCount(step) || '',
    memory: Object.keys(step.heap).length,
    output: (step.stdout + step.stderr).length ? '•' : '',
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, button, textarea, select, summary, [role="button"], [role="separator"], [contenteditable="true"]')) return;
      if (view !== 'trace') return;
      if (e.code === 'Space' && !e.repeat) {e.preventDefault(); togglePlayback(); return;}
      // GDB's own verbs: s(tep) into, n(ext) over, f(inish) out.
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const target = e.key === 'n' ? stepOver() : e.key === 'f' ? stepOut() : e.key === 's' ? Math.min(last, index + 1) : undefined;
        if (target !== undefined) {e.preventDefault(); forward(target); return;}
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault(); move(e.key === 'ArrowRight' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [last, view, index, trace, predict]);
  useEffect(() => {
    const line = active.current;
    const pane = line?.parentElement;
    if (!line || !pane) return;
    // Scroll only the code pane, so stepping never moves the controls.
    if (line.offsetTop < pane.scrollTop) pane.scrollTop = line.offsetTop;
    else if (line.offsetTop + line.offsetHeight > pane.scrollTop + pane.clientHeight)
      pane.scrollTop = line.offsetTop + line.offsetHeight - pane.clientHeight;
  }, [index, trace, view, showCode, selectedCall]);

  async function load(file?: File) {
    if (!file) return;
    try {
      if (file.size > 64 * 1024 * 1024) throw new Error('Choose a trace smaller than 64 MiB.');
      const next = parseTrace(JSON.parse(await file.text()));
      show(next);
    } catch (e) {setError(e instanceof Error ? e.message : 'Cannot read this trace.');}
  }

  function show(next: Trace) {
    setSelectedCall(null);
    setQuestion(null); asked.current = new Set(); setScore({right: 0, total: 0});
    if (trace !== sample) {
      const previous = repeatedWork(callHistory(trace, trace.snapshots.length - 1).nodes.values()).summary;
      setBaseline(previous.calls ? previous : null);
    }
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

  const openTrace = <label className="upload"><Icon name="open" /><span className="btn-label">Open trace</span>
    <input aria-label="Open JSON trace" type="file" accept=".json"
      onChange={e => {void load(e.target.files?.[0]); e.target.value = '';}} /></label>;

  if (view === 'editor') return <div className={`app editor-view ${dragging ? 'dragging' : ''}`} {...drop}>
    <header className="topbar">
      <div className="brand"><SproutMark />
        <div><h1>StackBloom</h1><p>Watch your C++ grow, one call at a time.</p></div></div>
      <div className="topbar-actions">
        {trace.snapshots.length > 1 && <button onClick={() => setView('trace')}>Back to trace<Icon name="forward" /></button>}
        {openTrace}
      </div>
    </header>
    <div className="editor-scroll">
      <section className="editor-intro"><div><h2>See what your code is thinking.</h2><p>Follow a call. Watch a value change. Make the next step click.</p></div>
        <button className="demo-link" onClick={() => {setView('trace'); setPlaying(false);}}>Explore the {trace === sample ? 'sample' : 'recorded'} trace<Icon name="external" size={16} /></button></section>
      {error && <div role="alert" className="diagnostic">{error}</div>}
      <SubmissionPane draft={draft} onDraft={setDraft} onTrace={show} compilerOutput={compileOutput} />
      <p className="hint">Your program is compiled and traced on this machine. Submit only code you trust.</p>
    </div>
  </div>;

  return <div className={`app trace-view ${dragging ? 'dragging' : ''}`} {...drop}>
    {/* One rail: brand, transport and where you are, then the file actions. Wraps to two rows below 1280px. */}
    <header className="topbar trace-rail">
      <div className="brand"><SproutMark />
        <div><h1>StackBloom</h1><p className="file">{trace.source.path} · C++17</p></div></div>
      <div className="controls">
        <div className="control-buttons">
          <button onClick={() => seek(0)} disabled={index === 0} aria-label="First stop" title="First stop"><Icon name="first" /></button>
          <button onClick={() => move(-1)} disabled={index === 0} aria-label="Previous stop" title="Back (←)"><Icon name="back" /></button>
          <button className="primary play-button" onClick={togglePlayback} disabled={last === 0} title="Play / pause (Space)">
            <Icon name={playing ? 'pause' : index === last ? 'replay' : 'play'} />{playing ? 'Pause' : index === last ? 'Replay' : 'Play'}</button>
          <button onClick={() => move(1)} disabled={index === last} title="Step into: the very next stop (→ or s)">Step<Icon name="forward" /></button>
          <button onClick={() => forward(stepOver()!)} disabled={stepOver() === undefined}
            title="Step over: the next stop in this call, skipping the calls it makes (n)"><Icon name="over" />Over</button>
          <button onClick={() => forward(stepOut()!)} disabled={stepOut() === undefined}
            title="Step out: the first stop after this call returns (f)"><Icon name="out" />Out</button>
          <label className="playback-speed"><span className="sr-only">Playback speed</span><select aria-label="Playback speed" value={interval} onChange={e => setIntervalMs(Number(e.target.value))}><option value={1500}>0.5×</option><option value={750}>1×</option><option value={375}>2×</option></select></label>
          <details className="jump-menu" ref={jumpMenu}><summary>Jump to<Icon name="chevron" size={16} /></summary>
            <div className="jump-list">
              <button onClick={() => jump(deepest)} disabled={!trace.snapshots.some(s => s.frames.length > 1)}>Deepest call</button>
              <button onClick={() => jump(nextChange('heap'))} disabled={nextChange('heap') === undefined}>Next memory change</button>
              <button onClick={() => jump(nextChange('output'))} disabled={nextChange('output') === undefined}>Next output</button>
            </div>
          </details>
          <button className={`ghost predict-toggle ${predict ? 'on' : ''}`} aria-pressed={predict}
            title="Predict: before a call returns, guess its value, then step on to check"
            onClick={() => {setPredict(value => !value); setQuestion(null);}}>Predict</button>
        </div>

        {/* Announces where you are when stepping; silent during playback, which would chatter. */}
        <div className="execution-context" aria-live={playing ? 'off' : 'polite'}>
          <span className={`context-dot ${playing ? 'is-playing' : ''}`} /><strong>{step.frames[0]?.function ?? (step.event === 'exit' ? 'Finished' : 'Stopped')}</strong>
          <span>{step.location ? `Line ${step.location.line}` : step.event.replace('_', ' ')}</span><span className="context-stat">{step.frames.length} active {step.frames.length === 1 ? 'call' : 'calls'}</span>
          {changes.heap.includes(index) && <span className="change-tag">Memory changed</span>}{changes.output.includes(index) && <span className="change-tag">New output</span>}
          {inspected && <button className="inspection-chip" onClick={() => setSelectedCall(null)} title="Clear call selection">
            Inspecting {inspected.function} · line {inspected.location.line}<Icon name="close" size={14} /></button>}
          <span className="shortcut-hint">Space play · ← → step · n over · f out</span></div>
      </div>
      <div className="topbar-actions">
        <button onClick={() => {setPlaying(false); setView('editor');}} title="Edit code"><Icon name="edit" /><span className="btn-label">Edit code</span></button>
        <ExportMenu canPicture={tab === 'calls' || tab === 'memory'} canRecord={trace.snapshots.some(stop => stop.frames.length > 1)} busy={!!exporting} onExport={kind => void exportAs(kind)} />
        <button onClick={download} title="Download: save this trace as JSON to open later or share"><Icon name="download" /><span className="btn-label">Download</span></button>
        {openTrace}
      </div>
    </header>


    {watches.length > 0 && <Watches trace={trace} index={index} watches={watches} onRemove={toggleWatch} onSeek={seek} />}

    {error && <div role="alert" className="diagnostic">{error}</div>}

    <div ref={workspace} className={`workspace ${showCode ? '' : 'code-hidden'}`} style={{'--source-width': `${sourceWidth}%`} as React.CSSProperties}>
      {showCode && <section className="source-panel">
        <div className="panel-title"><h2>{trace.source.path}</h2>
          <div className="panel-title-actions">
            <button className={`ghost ${wrap ? 'on' : ''}`} aria-pressed={wrap} onClick={() => setWrap(value => !value)}
              title="Wrap long lines instead of scrolling sideways">Wrap</button>
            <InfoTip label="About the source view">The highlighted line is the next one to run. A line can produce several
              stops, for example a loop condition. Line numbers the program stopped at are shaded by how often it did,
              and clicking one runs to its next stop.</InfoTip>
            <button className="ghost" onClick={() => setShowCode(false)} title="Hide the source to widen the panels">Hide code</button>
          </div></div>
        <div className={`source ${wrap ? 'wrap' : ''}`} tabIndex={0} aria-label="Source code">
          {trace.source.text.split('\n').map((line, i) => <div key={i} ref={sourceLine === i + 1 ? active : null}
            className={`code-line ${step.location?.line === i + 1 ? 'active' : ''} ${inspected && sourceLine === i + 1 ? 'inspected-line' : ''}`}
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
      </section>}

      {showCode && <div className="panel-resizer" role="separator" tabIndex={0} aria-label="Source panel width"
        aria-orientation="vertical" aria-valuemin={25} aria-valuemax={65} aria-valuenow={Math.round(sourceWidth)}
        onPointerDown={event => {event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();}}
        onPointerMove={event => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const box = workspace.current!.getBoundingClientRect();
          setSourceWidth(Math.max(25, Math.min(65, (event.clientX - box.left - 20) / (box.width - 40) * 100)));
        }}
        onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)}
        onDoubleClick={() => setSourceWidth(42)}
        onKeyDown={event => {
          if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          setSourceWidth(value => event.key === 'Home' ? 25 : event.key === 'End' ? 65 : Math.max(25, Math.min(65, value + (event.key === 'ArrowRight' ? 2 : -2))));
        }} />}
      <section className="detail-panel" ref={detailPanel}>
        <div className="tabs">
          <div className="tab-list" role="tablist" aria-label="Execution views">
          {TABS.map((item, position) => <button key={item.id} role="tab" id={`tab-${item.id}`}
            ref={element => {tabRefs.current[position] = element;}}
            aria-selected={tab === item.id} aria-controls={`panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1}
            className={`tab ${tab === item.id ? 'selected' : ''}`}
            onClick={() => setTab(item.id)} onKeyDown={e => tabKey(e, position)}>
            {item.label}{counts[item.id] !== '' && <span className="tab-badge">{counts[item.id]}</span>}
          </button>)}
          </div>
          {/* Fullscreen covers the toolbar, so the panel carries its own stepping controls. */}
          {expanded && <div className="fullscreen-controls" role="group" aria-label="Playback">
            <button onClick={() => move(-1)} disabled={index === 0} aria-label="Previous stop" title="Back (←)"><Icon name="back" /></button>
            <button className="primary" onClick={togglePlayback} disabled={last === 0} title="Play / pause (Space)">
              <Icon name={playing ? 'pause' : index === last ? 'replay' : 'play'} />{playing ? 'Pause' : index === last ? 'Replay' : 'Play'}</button>
            <button onClick={() => move(1)} disabled={index === last} aria-label="Next stop" title="Step into (→ or s)"><Icon name="forward" /></button>
            <span className="stop-count">Stop <strong>{index + 1}</strong> / {last + 1}</span>
          </div>}
          <button className="ghost expand-graph" onClick={() => void toggleExpanded()} aria-label={expanded ? 'Exit fullscreen graph' : 'Fullscreen graph'}>
            <Icon name={expanded ? 'restore' : 'expand'} /><span className="btn-label">{expanded ? 'Restore' : 'Expand'}</span></button>
          {!showCode && <button className="ghost show-code" onClick={() => setShowCode(true)}>Show code</button>}
        </div>
        <div className="tab-panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'stack' && <StackTree snapshot={step} previousFrames={trace.snapshots[index - 1]?.frames}
            selectedCall={selectedCall} onInspect={inspectCall} unset={unset} previousUnset={previousUnset} watched={watches} onWatch={toggleWatch} />}
          {tab === 'calls' && <CallTree trace={trace} index={index} onSelect={inspectCall} selectedCall={selectedCall} baseline={baseline} />}
          {tab === 'tables' && <DpTables trace={trace} index={index} unset={unset} previousUnset={previousUnset} />}
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

    {question && <PredictCard question={question} score={score}
      onScore={right => setScore(value => ({right: value.right + (right ? 1 : 0), total: value.total + 1}))}
      onContinue={answered} onSkip={answered} />}
    {exporting && <ExportProgress {...exporting} onCancel={() => {cancelExport.current = true;}} />}

    {/* The chalk tray along the bottom of the board, in two strips so the scrubber can stay in view on
        phones: event marks above, then the depth of the run, the scrubber and the stop count. */}
    <div className="tray tray-events">
      <div className="timeline">
        <div className="timeline-track"><EventTimeline trace={trace} index={index} onSeek={seek} /></div>
        <span className="stop-spacer" aria-hidden="true" />
      </div>
    </div>
    <footer className="tray tray-strip">
      <div className="timeline">
        <div className="timeline-track">
          <DepthSparkline trace={trace} index={index} onSeek={seek} />
          <input id="timeline" type="range" min="0" max={last} value={index} aria-label="Execution timeline"
          style={{background: `linear-gradient(to right, var(--run) ${last ? index / last * 100 : 0}%, var(--rail) ${last ? index / last * 100 : 0}%)`}}
          onChange={e => seek(Number(e.target.value))} />
        </div>
        <span className="stop-count">Stop <strong>{index + 1}</strong> / {last + 1}</span>
      </div>
    </footer>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
