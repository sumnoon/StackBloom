import {forwardRef, useEffect, useImperativeHandle, useRef, useState} from 'react';
import {Compartment, EditorState} from '@codemirror/state';
import {Decoration, EditorView, ViewPlugin, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers} from '@codemirror/view';
import {cpp} from '@codemirror/lang-cpp';
import {bracketMatching, HighlightStyle, indentUnit, syntaxHighlighting} from '@codemirror/language';
import {defaultKeymap, history, historyKeymap, indentWithTab} from '@codemirror/commands';
import {tags} from '@lezer/highlight';

import type {Issue, EditorHandle} from './editorIssues';

const colors = HighlightStyle.define([
  {tag: tags.keyword, color: 'var(--accent)'},
  {tag: [tags.string, tags.character], color: 'var(--ok)'},
  {tag: [tags.number, tags.bool, tags.null], color: 'var(--warn)'},
  {tag: tags.comment, color: 'var(--muted)', fontStyle: 'italic'},
  {tag: [tags.typeName, tags.meta], color: 'var(--brand)'},
]);

// Only decorate visible lines. Guides occupy leading whitespace, never the code.
const guides = ViewPlugin.fromClass(class {
  decorations;
  constructor(view: EditorView) {this.decorations = this.build(view);}
  update(update: import('@codemirror/view').ViewUpdate) {
    if (update.docChanged || update.viewportChanged) this.decorations = this.build(update.view);
  }
  build(view: EditorView) {
    const ranges = [];
    for (const {from, to} of view.visibleRanges) {
      for (let pos = from; pos <= to;) {
        const line = view.state.doc.lineAt(pos);
        const indent = line.text.match(/^[ \t]*/)?.[0].replace(/\t/g, '    ').length ?? 0;
        if (indent >= 4) ranges.push(Decoration.line({attributes: {
          class: 'cm-indent-guides', style: `background-size: ${indent}ch 100%`,
        }}).range(line.from));
        pos = line.to + 1;
      }
    }
    return Decoration.set(ranges, true);
  }
}, {decorations: plugin => plugin.decorations});

/** A language-aware editor; React owns the draft, CodeMirror owns editing and undo. */
export const CodeEditor = forwardRef<EditorHandle, {
  value: string; onChange: (value: string) => void; disabled?: boolean; issues?: Issue[];
}>(function CodeEditor({value, onChange, disabled, issues = []}, handle) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const change = useRef(onChange);
  change.current = onChange;
  const editable = useRef(new Compartment());
  const diagnostics = useRef(new Compartment());
  const [fontSize, setFontSize] = useState(14);

  useEffect(() => {
    const editor = new EditorView({parent: host.current!, state: EditorState.create({doc: value, extensions: [
      cpp(), history(), drawSelection(), lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(),
      bracketMatching(), indentUnit.of('    '), EditorState.tabSize.of(4), guides,
      syntaxHighlighting(colors), keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
      editable.current.of(EditorState.readOnly.of(!!disabled)), diagnostics.current.of([]),
      EditorView.contentAttributes.of({'aria-label': 'C++ source', 'aria-describedby': 'editor-keyboard-help', spellcheck: 'false'}),
      EditorView.updateListener.of(update => {if (update.docChanged) change.current(update.state.doc.toString());}),
    ]})});
    view.current = editor;
    return () => {editor.destroy(); view.current = null;};
    // Initialize once: draft and configuration changes are synchronized below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = view.current!;
    if (value !== editor.state.doc.toString()) editor.dispatch({changes: {from: 0, to: editor.state.doc.length, insert: value}});
  }, [value]);
  useEffect(() => {view.current?.dispatch({effects: editable.current.reconfigure(EditorState.readOnly.of(!!disabled))});}, [disabled]);
  useEffect(() => {
    const editor = view.current!;
    const marks = new Map<number, Issue>();
    const rank = {error: 0, warning: 1, note: 2};
    for (const issue of issues) {
      if (issue.line < 1 || issue.line > editor.state.doc.lines) continue;
      const previous = marks.get(issue.line);
      if (!previous || rank[issue.severity] < rank[previous.severity]) marks.set(issue.line, issue);
    }
    editor.dispatch({effects: diagnostics.current.reconfigure(EditorView.decorations.of(Decoration.set(
      [...marks].map(([line, issue]) => Decoration.line({attributes: {
        class: `cm-issue-${issue.severity}`, title: issue.message,
      }}).range(editor.state.doc.line(line).from)), true)))});
  }, [issues, value]);

  useImperativeHandle(handle, () => ({reveal(line, column = 1) {
    const editor = view.current;
    if (!editor) return;
    const target = editor.state.doc.line(Math.max(1, Math.min(line, editor.state.doc.lines)));
    const anchor = Math.min(target.to, target.from + Math.max(0, column - 1));
    editor.dispatch({selection: {anchor}, effects: EditorView.scrollIntoView(anchor, {y: 'center'})});
    editor.focus();
  }}), []);

  return <div className="editor-workbench" style={{'--editor-font-size': `${fontSize}px`} as React.CSSProperties}>
    <div className="editor-tools"><span id="editor-keyboard-help">Tab indents · Esc then Tab leaves editor</span>
      <label>Text size <select aria-label="Editor text size" value={fontSize} onChange={e => setFontSize(Number(e.target.value))}>
        {[12, 14, 16, 18, 20].map(size => <option key={size} value={size}>{size}px</option>)}
      </select></label></div>
    <div className={`code-editor cm-host ${disabled ? 'disabled' : ''}`} ref={host} />
  </div>;
});
