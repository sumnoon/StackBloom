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

export function SubmissionPane({initialSource, onTrace}: {initialSource: string; onTrace: (trace: Trace) => void}) {
  const [source, setSource] = useState(initialSource);
  const [stdin, setStdin] = useState('3\n');
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
      <button disabled={busy} onClick={() => {setSource(recursion); setStdin('4\n'); setError('');}}>Factorial (linear recursion)</button>
      <button disabled={busy} onClick={() => {setSource(fibonacci); setStdin('4\n'); setError('');}}>Fibonacci (branching recursion)</button>
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
