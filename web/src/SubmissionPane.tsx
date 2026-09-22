import {useEffect, useState} from 'react';
import {parseTrace, type Trace} from './trace';
import {ExampleGlyph} from './ExampleGlyph';

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

/** Draft state lives in the shell, so switching screens never discards edits. */
export type Draft = {source: string; stdin: string};

export function SubmissionPane({draft, onDraft, onTrace}:
    {draft: Draft; onDraft: (draft: Draft) => void; onTrace: (trace: Trace) => void}) {
  const {source, stdin} = draft;
  const setSource = (value: string) => onDraft({source: value, stdin});
  const setStdin = (value: string) => onDraft({source, stdin: value});
  const load = (example: string, input: string) => {onDraft({source: example, stdin: input}); setError('');};
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);
  const examples = [
    {title: 'Factorial', description: 'Follow calls down, then back up.', kind: 'chain' as const, code: recursion, input: '4\n'},
    {title: 'Fibonacci', description: 'Watch one call become a tree.', kind: 'fork' as const, code: fibonacci, input: '4\n'},
    {title: 'Linked list', description: 'Trace pointers from node to node.', kind: 'list' as const, code: linkedList, input: ''},
    {title: 'Binary search tree', description: 'See a tree take shape in memory.', kind: 'tree' as const, code: bst, input: ''},
  ];

  async function run() {
    setBusy(true); setElapsed(0); setError('');
    try {
      const response = await fetch('/api/trace', {
        method: 'POST', headers: {'Content-Type': 'application/json', 'X-CPPV-Request': 'trace'},
        body: JSON.stringify({source, stdin}),
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

  return <section className="submission" aria-label="Submit C++ code">
    <div className="example-gallery" aria-label="Example programs">{examples.map(example => <button key={example.title}
      className={`example-choice ${source === example.code ? 'chosen' : ''}`} aria-pressed={source === example.code}
      disabled={busy} onClick={() => load(example.code, example.input)}>
      <ExampleGlyph kind={example.kind} /><span><strong>{example.title}</strong><small>{example.description}</small></span>
    </button>)}</div>
    <div className="panel-title"><h2>Your program</h2><span className="language-badge">C++17 <span aria-hidden="true">/</span> main.cpp</span></div>
    <div className="submission-fields">
      <div className="editor-column"><label className="editor-label">C++ source<textarea aria-label="C++ source" spellCheck={false} value={source} onChange={e => setSource(e.target.value)} disabled={busy} /></label>
        <div className="editor-footer"><span>{source.split('\n').length} lines</span><span>Single file · 1,000 stop limit</span></div></div>
      <div className="submission-options"><label>Program input <span className="optional">Optional</span><textarea aria-label="Standard input" spellCheck={false} value={stdin} onChange={e => setStdin(e.target.value)} disabled={busy} placeholder="Values your program reads with std::cin" /></label>
        <div className="run-explainer"><h3>From code to a picture.</h3><p>Run your program, then explore its calls, memory and output at your own pace.</p></div>
        <button className="primary run-button" disabled={busy || !source.trim()} onClick={() => void run()}><span aria-hidden="true">{busy ? '◌' : '▶'}</span> {busy ? 'Compiling & tracing…' : 'Run & visualize'}</button>
        {busy ? <div className="run-progress" role="status"><div className="run-clock"><span className="working-dot" />Working locally <strong>{elapsed}s</strong></div><p>Capturing your program’s execution. Usually finishes within 45 seconds.</p><div className="run-tip">While you wait: {elapsed < 8 ? 'The highlight marks the next line to execute, before its values change.' : elapsed < 16 ? 'Use Play to watch calls unfold, then pause to inspect any value.' : 'Repeated calls appear as separate branches in the recursion tree.'}</div></div>
          : <p className="run-help">No setup between runs. Change a value and try again.</p>}
      </div>
    </div>
    {error && <div className="diagnostic" role="alert">{error}</div>}
  </section>;
}
