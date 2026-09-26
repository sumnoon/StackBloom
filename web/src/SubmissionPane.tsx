import {lazy, Suspense, useEffect, useMemo, useRef, useState} from 'react';
import {parseIssues, type EditorHandle} from './editorIssues';
const CodeEditor = lazy(() => import('./CodeEditor').then(module => ({default: module.CodeEditor})));
import {parseTrace, type Trace} from './trace';
import {ExampleGlyph} from './ExampleGlyph';
import {Icon} from './Icon';

const recursion = `#include <iostream>

int factorial(int n) {
    if (n <= 1) return 1;
    int child = factorial(n - 1);
    int result = n * child;
    return result;
}

int main() {
    int n = 4;
    std::cin >> n;
    int answer = factorial(n);
    std::cout << answer << std::endl;
    return 0;
}
`;

const fibonacci = `#include <iostream>

int fib(int n) {
    if (n <= 1) return n;
    int left = fib(n - 1);
    int right = fib(n - 2);
    return left + right;
}

int main() {
    int n = 4;
    std::cin >> n;
    int answer = fib(n);
    std::cout << "fib(" << n << ") = " << answer << std::endl;
    return 0;
}
`;

const linkedList = `#include <iostream>

struct Node {
    int value;
    Node* next;
};

int main() {
    Node* head = new Node{1, nullptr};
    head->next = new Node{2, nullptr};
    head->next->next = new Node{3, nullptr};

    Node* alias = head->next;   // a second pointer to one node
    int total = 0;
    for (Node* walk = head; walk != nullptr; walk = walk->next) {
        total += walk->value;
    }
    std::cout << "total=" << total << " alias=" << alias->value << std::endl;

    Node* stale = head;
    delete head;                // stale now dangles
    head = nullptr;
    std::cout << "freed the head" << std::endl;
    return total;
}
`;

const bst = `#include <iostream>

struct Node {
    int key;
    Node* left;
    Node* right;
};

Node* insert(Node* node, int key) {
    if (node == nullptr) return new Node{key, nullptr, nullptr};
    if (key < node->key) node->left = insert(node->left, key);
    else node->right = insert(node->right, key);
    return node;
}

int sum(Node* node) {
    if (node == nullptr) return 0;
    return node->key + sum(node->left) + sum(node->right);
}

int main() {
    Node* root = nullptr;
    for (int key : {5, 3, 8, 4}) {
        root = insert(root, key);
    }
    std::cout << "sum=" << sum(root) << std::endl;
    return 0;
}
`;

const memoFib = `#include <iostream>
#include <map>

// memo[n] remembers fib(n) once it is known, so no subproblem is computed twice.
std::map<int, long long> memo;

long long fib(int n) {
    if (n <= 1) return n;
    if (memo.count(n)) return memo[n];
    long long value = fib(n - 1) + fib(n - 2);
    memo[n] = value;
    return value;
}

int main() {
    int n = 4;
    std::cin >> n;
    std::cout << "fib(" << n << ") = " << fib(n) << std::endl;
    return 0;
}
`;

const gridPaths = `#include <iostream>
#include <vector>

int main() {
    int rows = 4, cols = 5;
    // paths[i][j] = ways to reach (i, j) moving only right or down.
    std::vector<std::vector<int>> paths(rows, std::vector<int>(cols, 1));
    for (int i = 1; i < rows; ++i)
        for (int j = 1; j < cols; ++j)
            paths[i][j] = paths[i - 1][j] + paths[i][j - 1];
    std::cout << "paths = " << paths[rows - 1][cols - 1] << std::endl;
    return 0;
}
`;

/** Draft state lives in the shell, so switching screens never discards edits. */
export type Draft = {source: string; stdin: string; maxSteps: number; timeout: number};
export const DEFAULT_LIMITS = {maxSteps: 1000, timeout: 15};

type Recent = {source: string; stdin: string; at: number; title: string};
const RECENT_KEY = 'stackbloom.recent';

/** Name a run after its first function other than main, which says more than "main.cpp". */
function titleOf(source: string) {
  for (const match of source.matchAll(/^[ \t]*[\w:<>*&\s]+?\b(\w+)\s*\([^;]*\)\s*\{/gm))
    if (match[1] !== 'main' && !['if', 'for', 'while', 'switch'].includes(match[1])) return `${match[1]}()`;
  return 'main.cpp';
}

// Browser storage can be unavailable (private windows, blocked site data); never fail on it.
function readRecent(): Recent[] {
  try {return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');} catch {return [];}
}
function remember(source: string, stdin: string) {
  try {
    const kept = readRecent().filter(item => item.source !== source || item.stdin !== stdin);
    localStorage.setItem(RECENT_KEY, JSON.stringify(
      [{source, stdin, at: Date.now(), title: titleOf(source)}, ...kept].slice(0, 8)));
  } catch {/* Recent runs are a convenience only. */}
}
function ago(time: number) {
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

export function SubmissionPane({draft, onDraft, onTrace, compilerOutput = ''}: {
  draft: Draft; onDraft: (draft: Draft) => void; onTrace: (trace: Trace) => void; compilerOutput?: string;
}) {
  const {source, stdin, maxSteps, timeout} = draft;
  const update = (change: Partial<Draft>) => onDraft({...draft, ...change});
  const load = (example: string, input: string) => {update({source: example, stdin: input}); setError('');};
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [recent, setRecent] = useState<Recent[]>(readRecent);
  const editor = useRef<EditorHandle>(null);
  const recentMenu = useRef<HTMLDetailsElement>(null);
  const issues = useMemo(() => parseIssues(compilerOutput), [compilerOutput]);
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);
  const examples = [
    {title: 'Factorial', description: 'Follow calls down, then back up.', kind: 'chain' as const, code: recursion, input: '4\n'},
    {title: 'Fibonacci', description: 'Watch one call become a tree.', kind: 'fork' as const, code: fibonacci, input: '4\n'},
    {title: 'Memo Fibonacci', description: 'Remember answers in a map.', kind: 'memo' as const, code: memoFib, input: '5\n'},
    {title: 'Linked list', description: 'Trace pointers from node to node.', kind: 'list' as const, code: linkedList, input: ''},
    {title: 'Binary search tree', description: 'See a tree take shape in memory.', kind: 'tree' as const, code: bst, input: ''},
    {title: 'Grid paths', description: 'Watch a DP table fill in.', kind: 'grid' as const, code: gridPaths, input: ''},
  ];

  async function run() {
    setBusy(true); setElapsed(0); setError('');
    remember(source, stdin);
    setRecent(readRecent());
    try {
      const response = await fetch('/api/trace', {
        method: 'POST', headers: {'Content-Type': 'application/json', 'X-CPPV-Request': 'trace'},
        body: JSON.stringify({source, stdin, max_steps: maxSteps, timeout}),
      });
      const text = await response.text();
      if (!text) throw new Error('Start the local backend with python tracer/server.py, then try again.');
      let data;
      try {data = JSON.parse(text);} catch {throw new Error('The trace API is unavailable. Start python tracer/server.py and use npm run dev.');}
      if (!response.ok) throw new Error(data.error || 'The local tracer could not run this program.');
      onTrace(parseTrace(data));
    } catch (e) {
      // A failed fetch means the local server is gone, which "Failed to fetch" hides.
      setError(e instanceof TypeError
        ? 'Cannot reach the local tracer. Is it still running? Start it again with python stackbloom.py.'
        : e instanceof Error ? e.message : 'Cannot connect to the local tracer.');
    }
    finally {setBusy(false);}
  }

  const errors = issues.filter(issue => issue.severity === 'error').length;
  return <section className="submission" aria-label="Submit C++ code">
    <div className="example-gallery" aria-label="Example programs">{examples.map(example => <button key={example.title}
      className={`example-choice ${source === example.code ? 'chosen' : ''}`} aria-pressed={source === example.code}
      disabled={busy} onClick={() => load(example.code, example.input)}>
      <ExampleGlyph kind={example.kind} /><span><strong>{example.title}</strong><small>{example.description}</small></span>
    </button>)}</div>
    <div className="panel-title"><h2>Your program</h2>
      <div className="panel-title-actions">
        {recent.length > 0 && <details className="recent-runs" ref={recentMenu}>
          <summary>Recent runs ({recent.length})<Icon name="chevron" size={16} /></summary>
          <ul>{recent.map(item => <li key={item.at}><button disabled={busy} onClick={() => {
            update({source: item.source, stdin: item.stdin}); setError('');
            recentMenu.current?.removeAttribute('open');
          }}><strong>{item.title}</strong>
            <small>{item.source.split('\n').length} lines{item.stdin.trim() ? ` · input ${item.stdin.trim().slice(0, 12)}` : ''} · {ago(item.at)}</small></button></li>)}</ul>
        </details>}
        <span className="language-badge">C++17 <span aria-hidden="true">/</span> main.cpp</span>
      </div>
    </div>
    <div className="submission-fields">
      <div className="editor-column"><span className="field-label">C++ source</span>
        <Suspense fallback={<div className="code-editor">Loading editor…</div>}><CodeEditor ref={editor} value={source} onChange={value => update({source: value})} disabled={busy} issues={issues} /></Suspense>
        <div className="editor-footer"><span>{source.split('\n').length} lines</span>
          <span>Single file · {maxSteps.toLocaleString()} stop limit</span></div>
        {compilerOutput && <div className="compiler-issues" role="alert">
          <h3>{errors ? `${errors} compile ${errors === 1 ? 'error' : 'errors'}` : 'The program did not compile'}</h3>
          {issues.length > 0 && <ul>{issues.map((issue, i) => <li key={i} className={issue.severity}>
            <button onClick={() => editor.current?.reveal(issue.line, issue.column)}>
              <span className="issue-where">Line {issue.line}</span>{issue.message}</button></li>)}</ul>}
          <details open={!issues.length}><summary>Full compiler output</summary><pre>{compilerOutput}</pre></details>
        </div>}
      </div>
      <div className="submission-options"><label>Program input <span className="optional">Optional</span><textarea aria-label="Standard input" spellCheck={false} value={stdin} onChange={e => update({stdin: e.target.value})} disabled={busy} placeholder="Values your program reads with std::cin" /></label>
        <details className="execution-limits"><summary>Execution limits</summary><div className="limits">
          <label>Stop limit<select value={maxSteps} disabled={busy} onChange={e => update({maxSteps: Number(e.target.value)})}>
            {[1000, 2500, 5000].map(value => <option key={value} value={value}>{value.toLocaleString()} stops</option>)}</select></label>
          <label>Time limit<select value={timeout} disabled={busy} onChange={e => update({timeout: Number(e.target.value)})}>
            {[15, 30, 60].map(value => <option key={value} value={value}>{value} seconds</option>)}</select></label>
        </div>
        </details>
        <div className="run-explainer"><h3>From code to a picture.</h3><p>Run your program, then explore its calls, memory and output at your own pace.</p></div>

        {busy ? <div className="run-progress" role="status"><div className="run-clock"><span className="working-dot" />Working locally <strong>{elapsed}s</strong></div><p>Capturing your program’s execution. It stops after {timeout} seconds or {maxSteps.toLocaleString()} stops, whichever comes first.</p><div className="run-tip">While you wait: {elapsed < 8 ? 'The highlight marks the next line to execute, before its values change.' : elapsed < 16 ? 'Use Play to watch calls unfold, then pause to inspect any value.' : 'Repeated calls appear as separate branches in the recursion tree.'}</div></div>
          : <p className="run-help">No setup between runs. Change a value and try again.</p>}
      </div>
    </div>
    <div className="run-dock" aria-label="Run controls">
      <div className="run-dock-inner"><div className="run-dock-status" role="status">
        <strong>{busy ? `Capturing execution · ${elapsed}s` : 'Ready to explore?'}</strong>
        <span>{maxSteps.toLocaleString()} stops · {timeout}s execution limit</span>
      </div>
        <button className="primary run-button" disabled={busy || !source.trim()} onClick={() => void run()}>{busy ? <span className="working-dot" aria-hidden="true" /> : <Icon name="run" size={20} />}{busy ? 'Compiling & tracing…' : 'Run & visualize'}</button>
      </div>
    </div>
    {error && <div className="diagnostic" role="alert">{error}</div>}
  </section>;
}
