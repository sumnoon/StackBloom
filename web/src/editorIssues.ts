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

