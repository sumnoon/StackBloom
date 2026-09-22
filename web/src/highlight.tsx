import type {ReactNode} from 'react';

/** Presentation-only C++ highlighting; the compiler remains the syntax authority. */
export function highlight(source: string): ReactNode[][] {
  const lines: ReactNode[][] = [[]];
  let offset = 0, key = 0;
  const append = (text: string, kind?: string) => text.split('\n').forEach((part, i) => {
    if (i) lines.push([]);
    if (part) lines[lines.length - 1].push(kind ? <span key={key++} className={`syntax-${kind}`}>{part}</span> : part);
  });
  const tokens = /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|^\s*#[^\n]*|\b(?:int|float|double|char|bool|void|auto|const|unsigned|long|short|struct|class|public|private|return|if|else|for|while|break|continue|new|delete|using|namespace|template|typename|virtual|override|static|include)\b|\b(?:nullptr|true|false|\d+(?:\.\d+)?)\b/gm;
  for (const match of source.matchAll(tokens)) {
    append(source.slice(offset, match.index));
    const text = match[0];
    const kind = text.startsWith('//') || text.startsWith('/*') ? 'comment'
      : text.startsWith('"') || text.startsWith("'") ? 'string'
      : text.trimStart().startsWith('#') ? 'directive'
      : /^(?:\d|nullptr|true|false)/.test(text) ? 'literal' : 'keyword';
    append(text, kind);
    offset = match.index! + text.length;
  }
  append(source.slice(offset));
  return lines;
}
