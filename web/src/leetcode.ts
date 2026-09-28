/**
 * LeetCode mode: turn a solution and a LeetCode-style test case into a whole program.
 *
 * The solution can be LeetCode's `class Solution`, or plain functions with their own node
 * structs; the harness calls the entry point, builds lists and trees for any struct shaped
 * like one, and prints the result. The generated file keeps the pasted code at its own lines,
 * then adds builders and printers under `#line ... "stackbloom_harness.h"`. GDB files that code
 * under another name, so the tracer never stops in it, while `main` returns to main.cpp.
 */

type Kind = 'int' | 'double' | 'bool' | 'string' | 'char' | 'vector' | 'node';
/** A struct the harness can build from a list: one value field, one link (a list) or two (a tree). */
export type NodeShape = {name: string; field: string; value: Ty; links: string[]; construct: 'value' | 'default'};
export type Ty = {kind: Kind; name: string; of?: Ty; node?: NodeShape};
type Param = {ty: Ty; name: string; output: boolean};
/** The function the harness calls: a Solution method (`owner`) or a free function. */
export type Method = {name: string; owner: string | null; returns: Ty | null; params: Param[]};
export type Harness = {program: string; firstLine: number; lines: number; method: Method | null};

export const LEETCODE_STARTER = `// StackBloom defines ListNode and TreeNode for you, as LeetCode does.
// Plain functions and your own node structs work too.
class Solution {
public:
    ListNode* reverseList(ListNode* head) {
        ListNode* prev = nullptr;
        while (head != nullptr) {
            ListNode* next = head->next;
            head->next = prev;
            prev = head;
            head = next;
        }
        return prev;
    }
};
`;
export const LEETCODE_TESTCASE = 'head = [1,2,3,4]\n';

const INTEGERS = /^(unsigned\s+)?(int|long|long\s+long|short|size_t|int64_t|int32_t|uint64_t|uint32_t)$/;
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'return', 'sizeof', 'catch']);

const normalise = (text: string) => text.replace(/\bstd::/g, '').replace(/\bconst\b/g, '').replace(/&/g, '')
  .replace(/\b(struct|class)\s+/g, '').replace(/\s+/g, ' ').replace(/\s*([<>*,])\s*/g, '$1').trim();

function scalar(name: string): Ty | null {
  if (INTEGERS.test(name)) return {kind: 'int', name};
  if (name === 'double' || name === 'float') return {kind: 'double', name};
  if (name === 'bool' || name === 'string' || name === 'char') return {kind: name, name};
  return null;
}

export function parseType(text: string, nodes: Map<string, NodeShape | string> = new Map()): Ty {
  const name = normalise(text);
  const vector = name.match(/^vector<(.+)>$/);
  if (vector) {
    const of = parseType(vector[1], nodes);
    return {kind: 'vector', name: `vector<${of.name}>`, of};
  }
  const known = scalar(name);
  if (known) return known;
  const pointer = name.match(/^([A-Za-z_]\w*)\*$/);
  const node = pointer && nodes.get(pointer[1]);
  if (node && typeof node !== 'string') return {kind: 'node', name, node};
  // A struct the harness found but cannot build says why, rather than "unsupported type".
  if (typeof node === 'string') throw new Error(node);
  throw new Error(`LeetCode mode cannot build a ${name || 'parameter'} yet. Switch to Whole program and write main() yourself.`);
}

/** Blank out comments and string contents, keeping every offset, so searches see only code. */
function codeOnly(source: string) {
  return source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g,
    text => text.replace(/[^\n]/g, ' '));
}

/** Keep only what sits directly inside a scope: everything nested in braces becomes spaces. */
function flatten(body: string) {
  let flat = '', level = 0;
  for (const c of body) {
    if (c === '}') level--;
    flat += level > 0 ? (c === '\n' ? c : ' ') : c;
    if (c === '{') level++;
  }
  return flat;
}

function closing(code: string, open: number) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) return i;
  }
  return code.length;
}

/** Split at top-level separators, outside brackets and strings. */
function splitTop(text: string, separators: string) {
  const parts: string[] = [];
  let depth = 0, quote = '', start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if ('[{(<'.includes(c)) depth++;
    else if (']})>'.includes(c)) depth--;
    else if (depth === 0 && separators.includes(c)) {parts.push(text.slice(start, i)); start = i + 1;}
  }
  parts.push(text.slice(start));
  return parts.map(part => part.trim()).filter(Boolean);
}

/** Every struct or class at file scope: a buildable node shape, or the reason it is not one. */
function findStructs(code: string) {
  const nodes = new Map<string, NodeShape | string>();
  for (const match of code.matchAll(/\b(struct|class)\s+([A-Za-z_]\w*)\s*(?::[^{;]*)?\{/g)) {
    const name = match[2];
    if (name === 'Solution') continue;
    const open = match.index! + match[0].length - 1;
    const body = flatten(code.slice(open + 1, closing(code, open)));
    const fields: {type: string; name: string}[] = [];
    // A constructor or method body ends a statement as a semicolon does.
    for (const statement of body.replace(/\{[^}]*\}/g, ';').split(';')) {
      const text = statement.replace(/\b(public|private|protected)\s*:/g, '').trim();
      if (!text || text.includes('(') || /^(using|typedef|static|friend|template|enum)\b/.test(text)) continue;
      const [first, ...rest] = splitTop(text, ',');
      const head = first.replace(/=.*$/, '').trim().match(/^(.*?)([A-Za-z_]\w*)(\s*\[[^\]]*\])?$/);
      if (!head || head[3] || !head[1].trim()) continue;
      const base = head[1].replace(/[*&\s]+$/, '');
      fields.push({type: head[1], name: head[2]});
      for (const more of rest) {
        const next = more.replace(/=.*$/, '').trim().match(/^([*&\s]*)([A-Za-z_]\w*)$/);
        if (next) fields.push({type: base + next[1], name: next[2]});
      }
    }
    const links = fields.filter(field => normalise(field.type) === `${name}*`).map(field => field.name);
    const valueField = fields.find(field => scalar(normalise(field.type)));
    const constructors = [...body.matchAll(new RegExp(`\\b${name}\\s*\\(([^()]*)\\)`, 'g'))].map(m => splitTop(m[1], ',').length);
    const construct = constructors.includes(1) ? 'value' : !constructors.length || constructors.includes(0) ? 'default' : null;
    const why = `LeetCode mode builds ${name}* when ${name} has one value field and one ${name}* link (a list) or two (a tree)`;
    if (!valueField || !(links.length === 1 || links.length === 2)) nodes.set(name, `${why}; this one has ${links.length} links${valueField ? '' : ' and no value field'}.`);
    else if (!construct) nodes.set(name, `${why}, and a constructor taking the value (or none).`);
    else nodes.set(name, {name, field: valueField.name, value: scalar(normalise(valueField.type))!, links, construct});
  }
  return nodes;
}

function readParams(text: string, nodes: Map<string, NodeShape | string>) {
  return splitTop(text, ',').filter(param => normalise(param) !== 'void').map(param => {
    const named = param.replace(/=.*$/, '').trim().match(/^(.*?)([A-Za-z_]\w*)$/);
    if (!named) throw new Error(`Cannot read the parameter "${param}".`);
    const output = /&/.test(named[1]) && !/\bconst\b/.test(named[1]);
    return {ty: parseType(named[1], nodes), name: named[2], output};
  });
}

const DEFINITION = /([A-Za-z_][\w:<>,\s*&]*?)[\s*&]*?\b([A-Za-z_]\w*)\s*\(([^()]*)\)\s*(?:const\s*)?\{/g;

/** The first public method of `class Solution`, which is the one LeetCode calls. */
function solutionMethod(code: string, start: number, nodes: Map<string, NodeShape | string>): Method {
  const open = code.indexOf('{', start);
  const flat = flatten(code.slice(open + 1, closing(code, open)));
  const publicAt = code.slice(start, open).includes('struct') ? 0 : flat.search(/\bpublic\s*:/);
  if (publicAt < 0) throw new Error('Solution has no public: section, so there is no method to call.');
  const pattern = new RegExp(DEFINITION.source, 'g');
  pattern.lastIndex = publicAt;
  for (let match; (match = pattern.exec(flat));) {
    const sections = flat.slice(0, match.index + match[0].indexOf(match[2])).match(/\b(public|private|protected)\s*:/g);
    if (sections && !sections[sections.length - 1].startsWith('public')) continue;
    const name = match[2];
    if (name === 'Solution' || KEYWORDS.has(name)) continue;
    const full = flat.slice(match.index, pattern.lastIndex).replace(/\b(public|private|protected)\s*:/g, '');
    const returnText = full.slice(0, full.lastIndexOf(name, full.indexOf('('))).replace(/\b(static|inline|virtual)\b/g, '').trim();
    return {name, owner: 'Solution', returns: returnText === 'void' ? null : parseType(returnText, nodes), params: readParams(match[3], nodes)};
  }
  throw new Error('Solution has no public method to call.');
}

/** Free functions: the one nothing else calls, or the first one the pasted main() calls. */
function freeFunction(code: string, nodes: Map<string, NodeShape | string>): Method {
  const flat = flatten(code);
  const found: {name: string; returnText: string; params: string; body: string}[] = [];
  let main = '';
  for (const match of flat.matchAll(DEFINITION)) {
    const name = match[2];
    if (KEYWORDS.has(name)) continue;
    const open = match.index! + match[0].length - 1;
    const body = code.slice(open, closing(code, open) + 1);
    if (name === 'main') {main = body; continue;}
    const returnText = match[0].slice(0, match[0].lastIndexOf(name, match[0].indexOf('('))).replace(/\b(static|inline)\b/g, '').trim();
    found.push({name, returnText, params: match[3], body});
  }
  if (!found.length) throw new Error('Paste a class Solution, or the function to run: StackBloom calls it with the test case.');
  const calls = (body: string, name: string) => new RegExp(`\\b${name}\\s*\\(`).test(body);
  // Helpers are called by other functions; the entry point is not (calling itself is recursion).
  const entries = found.filter(fn => !found.some(other => other !== fn && calls(other.body, fn.name)));
  const pool = entries.length ? entries : found;
  const chosen = (main && pool.map(fn => ({fn, at: main.search(new RegExp(`\\b${fn.name}\\s*\\(`))}))
    .filter(item => item.at >= 0).sort((a, b) => a.at - b.at)[0]?.fn) || pool[0];
  return {name: chosen.name, owner: null, returns: chosen.returnText === 'void' ? null : parseType(chosen.returnText, nodes),
    params: readParams(chosen.params, nodes)};
}

/** The code to call and the node structs it can use, including LeetCode's own when missing. */
function plan(source: string) {
  const code = codeOnly(source);
  const nodes = findStructs(code);
  const extra: string[] = [];
  // LeetCode defines ListNode and TreeNode for you; do the same when they are used but not defined.
  for (const [word, text] of [['ListNode', LIST_NODE], ['TreeNode', TREE_NODE]] as const)
    if (!nodes.has(word) && new RegExp(`\\b${word}\\b`).test(code)) {
      extra.push(text);
      nodes.set(word, findStructs(text).get(word)!);
    }
  const start = code.search(/\b(class|struct)\s+Solution\b/);
  const method = start >= 0 ? solutionMethod(code, start, nodes) : freeFunction(code, nodes);
  return {method, extra, hasMain: /\bint\s+main\s*\(/.test(code)};
}

/** What LeetCode mode will call, for the editor to say before running. */
export function findMethod(source: string): Method {
  return plan(source).method;
}

/** Read `a = [1,2], b = 3`, or one value per line as LeetCode's raw test case shows it. */
export function parseTestcase(text: string, method: Method) {
  const pieces = splitTop(text, ',\n').map(piece => {
    const named = piece.match(/^([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/);
    return named ? {name: named[1], raw: named[2]} : {name: '', raw: piece};
  });
  const byName = pieces.every(piece => piece.name);
  if (pieces.length !== method.params.length && !(byName && pieces.length >= method.params.length))
    throw new Error(`${method.name} takes ${method.params.length} ${method.params.length === 1 ? 'value' : 'values'} (${method.params.map(p => p.name).join(', ')}), but the test case has ${pieces.length}.`);
  return method.params.map((param, i) => {
    const piece = byName ? pieces.find(p => p.name === param.name) : pieces[i];
    if (!piece) throw new Error(`The test case has no value for ${param.name}.`);
    try {return JSON.parse(piece.raw) as unknown;}
    catch {throw new Error(`Cannot read the value of ${param.name}: ${piece.raw}`);}
  });
}

const cString = (value: string) => JSON.stringify(value);

export function literal(ty: Ty, value: unknown, name: string, whole: Ty = ty): string {
  const wrong = () => new Error(`${name} should be ${describe(whole)}, but the test case has ${JSON.stringify(value)}.`);
  switch (ty.kind) {
    case 'int': if (!Number.isInteger(value)) throw wrong(); return String(value);
    case 'double': if (typeof value !== 'number') throw wrong(); return Number.isInteger(value) ? `${value}.0` : String(value);
    case 'bool': if (typeof value !== 'boolean') throw wrong(); return String(value);
    case 'string': if (typeof value !== 'string') throw wrong(); return cString(value);
    case 'char':
      if (typeof value !== 'string' || [...value].length !== 1) throw wrong();
      return `'${value === "'" || value === '\\' ? '\\' : ''}${value}'`;
    case 'vector':
      if (!Array.isArray(value)) throw wrong();
      return `{${value.map(item => literal(ty.of!, item, name, whole)).join(', ')}}`;
    case 'node': {
      const node = ty.node!;
      if (!Array.isArray(value)) throw wrong();
      // Trees use LeetCode's level order, where null marks a missing child.
      const items = value.map(item => item === null && node.links.length === 2 ? 'nullopt' : literal(node.value, item, name, whole));
      return `stackbloom_build_${node.name}({${items.join(', ')}})`;
    }
  }
}

const SINGLE: Record<Exclude<Kind, 'node'>, [string, string]> = {int: ['an integer', 'integers'], double: ['a number', 'numbers'],
  bool: ['true or false', 'true/false values'], string: ['a string in quotes', 'strings'], char: ['one character in quotes', 'characters'],
  vector: ['a list', 'lists']};
function describe(ty: Ty): string {
  if (ty.kind === 'node') return ty.node!.links.length === 1 ? 'a linked list like [1,2,3]' : 'a tree like [1,null,2]';
  return ty.kind === 'vector' ? `a list of ${plural(ty.of!)}` : SINGLE[ty.kind][0];
}
function plural(ty: Ty): string {
  if (ty.kind === 'node') return ty.node!.links.length === 1 ? 'linked lists' : 'trees';
  return ty.kind === 'vector' ? `lists of ${plural(ty.of!)}` : SINGLE[ty.kind][1];
}

function nodesIn(ty: Ty | null, into: Map<string, NodeShape>) {
  if (ty?.node) into.set(ty.node.name, ty.node);
  if (ty?.of) nodesIn(ty.of, into);
  return into;
}

const LIST_NODE = `struct ListNode {
    int val;
    ListNode* next;
    ListNode() : val(0), next(nullptr) {}
    ListNode(int x) : val(x), next(nullptr) {}
    ListNode(int x, ListNode* next) : val(x), next(next) {}
};`;
const TREE_NODE = `struct TreeNode {
    int val;
    TreeNode* left;
    TreeNode* right;
    TreeNode() : val(0), left(nullptr), right(nullptr) {}
    TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}
    TreeNode(int x, TreeNode* left, TreeNode* right) : val(x), left(left), right(right) {}
};`;

/** Builders and a printer for one node struct, written in terms of its own field names. */
function nodeHelpers({name, field, value, links, construct}: NodeShape) {
  const T = value.name;
  const make = [`${name}* stackbloom_new_${name}(const ${T}& value) {`,
    construct === 'value' ? `    ${name}* node = new ${name}(value);` : `    ${name}* node = new ${name}();\n    node->${field} = value;`,
    // The harness owns the shape, so every link starts empty whatever the constructor does.
    ...links.map(link => `    node->${link} = nullptr;`), '    return node;', '}'];
  if (links.length === 1) return [...make,
    `${name}* stackbloom_build_${name}(vector<${T}> values) {`,
    `    ${name}* head = nullptr;`,
    `    ${name}** tail = &head;`,
    `    for (${T} value : values) { *tail = stackbloom_new_${name}(value); tail = &(*tail)->${links[0]}; }`,
    '    return head;', '}',
    `void stackbloom_show(ostream& out, ${name}* node) {`,
    "    out << '[';",
    `    for (int count = 0; node != nullptr && count < 1000; node = node->${links[0]}, ++count) { if (count) out << ','; stackbloom_show(out, node->${field}); }`,
    "    out << ']';", '}'].join('\n');
  const [left, right] = links;
  return [...make,
    `${name}* stackbloom_build_${name}(vector<optional<${T}>> items) {`,
    '    if (items.empty() || !items[0]) return nullptr;',
    `    ${name}* root = stackbloom_new_${name}(*items[0]);`,
    `    queue<${name}*> waiting;`,
    '    waiting.push(root);',
    '    for (size_t i = 1; i < items.size() && !waiting.empty(); waiting.pop()) {',
    `        ${name}* node = waiting.front();`,
    `        if (i < items.size() && items[i]) waiting.push(node->${left} = stackbloom_new_${name}(*items[i]));`,
    '        ++i;',
    `        if (i < items.size() && items[i]) waiting.push(node->${right} = stackbloom_new_${name}(*items[i]));`,
    '        ++i;', '    }', '    return root;', '}',
    `void stackbloom_show(ostream& out, ${name}* root) {`,
    '    vector<string> items;',
    `    queue<${name}*> waiting;`,
    '    waiting.push(root);',
    '    while (!waiting.empty() && items.size() < 1000) {',
    `        ${name}* node = waiting.front();`,
    '        waiting.pop();',
    '        if (node == nullptr) { items.push_back("null"); continue; }',
    '        ostringstream text;',
    `        stackbloom_show(text, node->${field});`,
    '        items.push_back(text.str());',
    `        waiting.push(node->${left});`,
    `        waiting.push(node->${right});`,
    '    }',
    '    while (!items.empty() && items.back() == "null") items.pop_back();',
    "    out << '[';",
    '    for (size_t i = 0; i < items.size(); ++i) out << (i ? "," : "") << items[i];',
    "    out << ']';", '}'].join('\n');
}

const SHOW = `template <class T> void stackbloom_show(ostream& out, const T& value) { out << value; }
void stackbloom_show(ostream& out, bool value) { out << (value ? "true" : "false"); }
void stackbloom_show(ostream& out, char value) { out << '"' << value << '"'; }
void stackbloom_show(ostream& out, const string& value) { out << '"' << value << '"'; }
void stackbloom_show(ostream& out, double value) { out << fixed << setprecision(5) << value; }`;
const SHOW_VECTOR = `template <class T> void stackbloom_show(ostream& out, const vector<T>& items) {
    out << '[';
    for (size_t i = 0; i < items.size(); ++i) {
        if (i) out << ',';
        if constexpr (is_same_v<T, bool>) stackbloom_show(out, bool(items[i])); else stackbloom_show(out, items[i]);
    }
    out << ']';
}
template <class T> void stackbloom_print(const T& value) { stackbloom_show(cout, value); cout << '\\n'; }`;

export function buildHarness(solution: string, testcase: string): Harness {
  const user = solution.replace(/\s+$/, '').split('\n');
  const {method, extra, hasMain} = plan(solution);
  // A whole program pasted with an empty test case runs as it is, main() and all.
  if (hasMain && !testcase.trim()) return {program: user.join('\n') + '\n', firstLine: 1, lines: user.length, method: null};
  const values = parseTestcase(testcase, method);
  const lines: string[] = ['// StackBloom LeetCode harness: your code comes next, then main() at the end.',
    '#include <bits/stdc++.h>', 'using namespace std;'];
  // A pasted main() is renamed, not removed, so the pasted lines keep their numbers.
  if (hasMain) lines.push('#define main stackbloom_pasted_main');
  // `#line N "main.cpp"` must name the physical line that follows it.
  const backToMain = () => lines.push(`#line ${lines.length + 2} "main.cpp"`);
  if (extra.length) {
    lines.push('#line 1 "stackbloom_harness.h"', ...extra.join('\n').split('\n'));
    backToMain();
  }
  const firstLine = lines.length + 1;
  lines.push(...user, '', '#line 1 "stackbloom_harness.h"');
  if (hasMain) lines.push('#undef main');
  lines.push(...SHOW.split('\n'));
  const used = new Map<string, NodeShape>();
  [method.returns, ...method.params.map(p => p.ty)].forEach(ty => nodesIn(ty, used));
  for (const node of used.values()) lines.push(...nodeHelpers(node).split('\n'));
  lines.push(...SHOW_VECTOR.split('\n'));
  backToMain();
  const args = method.params.map(p => p.name).join(', ');
  const shown = method.returns ? 'result' : method.params.find(p => p.output)?.name;
  // A temporary Solution keeps an empty object out of main's locals.
  const call = `${method.owner ? `${method.owner}().` : ''}${method.name}(${args})`;
  lines.push('int main() {',
    ...method.params.map((p, i) => `    ${p.ty.name} ${p.name} = ${literal(p.ty, values[i], p.name)};`),
    method.returns ? `    auto result = ${call};` : `    ${call};`,
    ...(shown ? [`    stackbloom_print(${shown});`] : []), '    return 0;', '}', '');
  return {program: lines.join('\n'), firstLine, lines: user.length, method};
}

/** Point compiler messages about the solution back at the lines of the pasted code. */
export function shiftIssues(output: string, harness: Pick<Harness, 'firstLine' | 'lines'>) {
  return output.replace(/main\.cpp:(\d+):/g, (text, line) => {
    const own = Number(line) - harness.firstLine + 1;
    return own >= 1 && own <= harness.lines ? `main.cpp:${own}:` : text.replace('main.cpp', 'harness');
  });
}
