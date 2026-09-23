import {forwardRef, useImperativeHandle, useRef} from 'react';

export type Issue = {line: number; column: number; severity: 'error' | 'warning' | 'note'; message: string};

/** Pull `main.cpp:LINE:COL: error: ...` lines out of GCC or Clang output. */
export function parseIssues(output: string): Issue[] {
  const issues: Issue[] = [];
  for (const match of output.matchAll(/main\.cpp:(\d+):(\d+):\s*(fatal error|error|warning|note):\s*(.+)/g)) {
    const severity = match[3] === 'fatal error' ? 'error' : match[3] as Issue['severity'];
    issues.push({line: Number(match[1]), column: Number(match[2]), severity, message: match[4].trim()});
  }
  return issues;
}

export type EditorHandle = {reveal: (line: number, column?: number) => void};

/** A plain textarea with a line-number gutter that stays scrolled with it and
 *  marks the lines the compiler complained about. */
export const CodeEditor = forwardRef<EditorHandle, {
  value: string; onChange: (value: string) => void; disabled?: boolean; issues?: Issue[];
}>(function CodeEditor({value, onChange, disabled, issues = []}, handle) {
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const lines = value.split('\n');
  const marks = new Map<number, Issue>();
  // Errors outrank warnings, which outrank notes, on a shared line.
  const rank = {error: 0, warning: 1, note: 2};
  for (const issue of issues) {
    const current = marks.get(issue.line);
    if (!current || rank[issue.severity] < rank[current.severity]) marks.set(issue.line, issue);
  }

  useImperativeHandle(handle, () => ({
    reveal(line, column = 1) {
      const element = area.current;
      if (!element) return;
      const start = lines.slice(0, line - 1).reduce((total, text) => total + text.length + 1, 0);
      const end = start + (lines[line - 1]?.length ?? 0);
      element.focus();
      element.setSelectionRange(Math.min(start + column - 1, end), end);
      // Centre the line: selection alone does not scroll a textarea reliably.
      const height = parseFloat(getComputedStyle(element).lineHeight) || 21;
      element.scrollTop = Math.max(0, (line - 1) * height - element.clientHeight / 2);
    },
  }), [lines]);

  return <div className={`code-editor ${disabled ? 'disabled' : ''}`}>
    <div className="editor-gutter" ref={gutter} aria-hidden="true">
      {lines.map((_, i) => {
        const issue = marks.get(i + 1);
        return <div key={i} className={issue ? `gutter-${issue.severity}` : undefined} title={issue?.message}>{i + 1}</div>;
      })}
    </div>
    <textarea ref={area} aria-label="C++ source" spellCheck={false} value={value} disabled={disabled}
      wrap="off" onChange={e => onChange(e.target.value)}
      onScroll={e => {if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;}} />
  </div>;
});
