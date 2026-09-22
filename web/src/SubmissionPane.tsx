import {useState} from 'react';
import {parseTrace, type Trace} from './trace';

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

  async function run() {
    setBusy(true); setError('');
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
    } catch (e) {setError(e instanceof Error ? e.message : 'Cannot connect to the local tracer.');}
    finally {setBusy(false);}
  }

  return <section className="submission" aria-label="Submit C++ code">
    <div className="panel-title"><h2>Your program</h2><div className="example-buttons">
      <button disabled={busy} onClick={() => load(recursion, '4\n')}>Factorial (linear recursion)</button>
      <button disabled={busy} onClick={() => load(fibonacci, '4\n')}>Fibonacci (branching recursion)</button>
      <button disabled={busy} onClick={() => load(linkedList, '')}>Linked list (pointers)</button>
      <button disabled={busy} onClick={() => load(bst, '')}>Binary search tree</button>
    </div></div>
    <div className="submission-fields">
      <label className="editor-label">C++ source<textarea aria-label="C++ source" spellCheck={false} value={source} onChange={e => setSource(e.target.value)} disabled={busy} /></label>
      <div className="submission-options"><label>stdin<textarea aria-label="Standard input" spellCheck={false} value={stdin} onChange={e => setStdin(e.target.value)} disabled={busy} placeholder="Optional input for std::cin" /></label>
        <p>Single-file C++17 · Up to 1,000 stops</p><p>Runs on your machine. Submit only code you trust.</p>
        <button className="primary" disabled={busy || !source.trim()} onClick={() => void run()}>{busy ? 'Compiling and tracing…' : 'Run & visualize'}</button>
        <span role="status">{busy ? 'Recording execution. This may take up to 45 seconds.' : 'Edit code, run it, then step through the trace below.'}</span>
      </div>
    </div>
    {error && <div className="diagnostic" role="alert">{error}</div>}
  </section>;
}
