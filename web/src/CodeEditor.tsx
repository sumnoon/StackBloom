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

// Matches the examples and the tab-size the editor displays.
const INDENT = 4;

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

  // Escape hands the next Tab back to the browser, so the editor is never a keyboard trap.
  const escaped = useRef(false);

  /** Replace [start, end) through the browser's own editing, which keeps Ctrl+Z working. */
  function replace(element: HTMLTextAreaElement, start: number, end: number, text: string,
                   selectStart: number, selectEnd: number) {
    element.setSelectionRange(start, end);
    // execCommand is deprecated but remains the only way to edit a textarea without
    // wiping its undo history; fall back to setRangeText where it is unavailable.
    if (!document.execCommand('insertText', false, text)) {
      element.setRangeText(text, start, end, 'end');
      onChange(element.value);
    }
    element.setSelectionRange(selectStart, selectEnd);
  }

  function keyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape') {escaped.current = true; return;}
    if (event.key !== 'Tab' || event.ctrlKey || event.altKey || event.metaKey || escaped.current) {
      escaped.current = false;
      return;
    }
    event.preventDefault();
    const element = event.currentTarget;
    const text = element.value;
    const {selectionStart: start, selectionEnd: end} = element;
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    // A selection ending at the start of a line does not include that line.
    const lastLine = end > start && text[end - 1] === '\n' ? end - 1 : end;
    const lineEnd = text.indexOf('\n', lastLine) === -1 ? text.length : text.indexOf('\n', lastLine);
    const block = text.slice(lineStart, lineEnd);

    if (!event.shiftKey && !text.slice(start, end).includes('\n')) {
      // Tab inside one line: spaces up to the next indent stop, like a code editor.
      const spaces = ' '.repeat(INDENT - ((start - lineStart) % INDENT));
      replace(element, start, end, spaces, start + spaces.length, start + spaces.length);
      return;
    }
    const lines = block.split('\n');
    const changed = event.shiftKey
      ? lines.map(line => line.replace(new RegExp(`^(\\t| {1,${INDENT}})`), ''))
      : lines.map(line => line.length ? ' '.repeat(INDENT) + line : line);
    const updated = changed.join('\n');
    if (updated === block) return;
    if (start === end) {
      // Outdenting at a caret keeps the caret on its character.
      const moved = Math.max(lineStart, start - (block.length - updated.length));
      replace(element, lineStart, lineEnd, updated, moved, moved);
    } else {
      replace(element, lineStart, lineEnd, updated, lineStart, lineStart + updated.length);
    }
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
      wrap="off" onChange={e => onChange(e.target.value)} onKeyDown={keyDown} onBlur={() => {escaped.current = false;}}
      onScroll={e => {if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;}} />
  </div>;
});
