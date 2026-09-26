/**
 * LeetCode mode: turn a `class Solution` and a LeetCode-style test case into a whole program.
 *
 * The generated file keeps the solution at its own lines, then adds builders and printers under
 * `#line ... "stackbloom_harness.h"`. GDB files that code under another name, so the tracer never
 * stops in it, while `main` returns to main.cpp and stays in the trace.
 */

type Kind = 'int' | 'double' | 'bool' | 'string' | 'char' | 'vector' | 'list' | 'tree';
export type Ty = {kind: Kind; name: string; of?: Ty};
type Param = {ty: Ty; name: string; output: boolean};
export type Method = {name: string; returns: Ty | null; params: Param[]};
export type Harness = {program: string; firstLine: number; lines: number; method: Method};

export const LEETCODE_STARTER = `// StackBloom defines ListNode and TreeNode for you, as LeetCode does.
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

export function parseType(text: string): Ty {
  const name = text.replace(/\bstd::/g, '').replace(/\bconst\b/g, '').replace(/&/g, '')
    .replace(/\s+/g, ' ').replace(/\s*([<>*,])\s*/g, '$1').trim();
  const vector = name.match(/^vector<(.+)>$/);
  if (vector) {
    const of = parseType(vector[1]);
    return {kind: 'vector', name: `vector<${of.name}>`, of};
  }
  if (INTEGERS.test(name)) return {kind: 'int', name};
  if (name === 'double' || name === 'float') return {kind: 'double', name};
  if (name === 'bool' || name === 'string' || name === 'char') return {kind: name, name};
  if (name === 'ListNode*') return {kind: 'list', name};
  if (name === 'TreeNode*') return {kind: 'tree', name};
  throw new Error(`LeetCode mode cannot build a ${name || 'parameter'} yet. Switch to Whole program and write main() yourself.`);
}

/** Blank out comments and string contents, keeping every offset, so searches see only code. */
function codeOnly(source: string) {
  return source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g,
    text => text.replace(/[^\n]/g, ' '));
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

/** The first public method of `class Solution`, which is the one LeetCode calls. */
export function findMethod(source: string): Method {
  const code = codeOnly(source);
  const start = code.search(/\b(class|struct)\s+Solution\b/);
  if (start < 0) throw new Error('LeetCode mode needs a class Solution. Paste the class from the problem page.');
  const open = code.indexOf('{', start);
  let depth = 0, end = code.length;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) {end = i; break;}
  }
  const body = code.slice(open + 1, end);
  // Only members at the top of the class body count; blank out everything nested deeper.
  let flat = '', level = 0;
  for (const c of body) {
    if (c === '}') level--;
    flat += level > 0 ? (c === '\n' ? c : ' ') : c;
    if (c === '{') level++;
  }
  const publicAt = code.slice(start, open).includes('struct') ? 0 : flat.search(/\bpublic\s*:/);
  if (publicAt < 0) throw new Error('Solution has no public: section, so there is no method to call.');
  const pattern = /([A-Za-z_][\w:<>,\s*&]*?)[\s*&]*?\b([A-Za-z_]\w*)\s*\(([^()]*)\)\s*(?:const\s*)?\{/g;
  pattern.lastIndex = publicAt;
  for (let match; (match = pattern.exec(flat));) {
    const sections = flat.slice(0, match.index + match[0].indexOf(match[2])).match(/\b(public|private|protected)\s*:/g);
    if (sections && !sections[sections.length - 1].startsWith('public')) continue;
    const name = match[2];
    if (name === 'Solution' || ['if', 'for', 'while', 'switch'].includes(name)) continue;
    const full = flat.slice(match.index, pattern.lastIndex).replace(/\b(public|private|protected)\s*:/g, '');
    const head = full.slice(0, full.indexOf('('));
    const returnText = head.slice(0, head.lastIndexOf(name)).replace(/\b(static|inline|virtual)\b/g, '').trim();
    const params = splitTop(match[3], ',').map(param => {
      const named = param.replace(/=.*$/, '').trim().match(/^(.*?)([A-Za-z_]\w*)$/);
      if (!named) throw new Error(`Cannot read the parameter "${param}".`);
      const output = /&/.test(named[1]) && !/\bconst\b/.test(named[1]);
      return {ty: parseType(named[1]), name: named[2], output};
    });
    return {name, returns: returnText === 'void' ? null : parseType(returnText), params};
  }
  throw new Error('Solution has no public method to call.');
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
    case 'list':
      if (!Array.isArray(value) || !value.every(Number.isInteger)) throw wrong();
      return `stackbloom_list({${value.join(', ')}})`;
    case 'tree':
      if (!Array.isArray(value) || !value.every(v => v === null || Number.isInteger(v))) throw wrong();
      return `stackbloom_tree({${value.map(v => v === null ? 'STACKBLOOM_NULL' : v).join(', ')}})`;
  }
}

const SINGLE: Record<Kind, [string, string]> = {int: ['an integer', 'integers'], double: ['a number', 'numbers'],
  bool: ['true or false', 'true/false values'], string: ['a string in quotes', 'strings'], char: ['one character in quotes', 'characters'],
  vector: ['a list', 'lists'], list: ['a linked list like [1,2,3]', 'linked lists'], tree: ['a tree like [1,null,2]', 'trees']};
function describe(ty: Ty): string {
  return ty.kind === 'vector' ? `a list of ${plural(ty.of!)}` : SINGLE[ty.kind][0];
}
function plural(ty: Ty): string {
  return ty.kind === 'vector' ? `lists of ${plural(ty.of!)}` : SINGLE[ty.kind][1];
}

function uses(ty: Ty | null, kind: Kind): boolean {
  return !!ty && (ty.kind === kind || uses(ty.of ?? null, kind));
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
const LIST_HELPERS = `ListNode* stackbloom_list(initializer_list<int> values) {
    ListNode* head = nullptr;
    ListNode** tail = &head;
    for (int value : values) { *tail = new ListNode(value); tail = &(*tail)->next; }
    return head;
}
void stackbloom_show(ListNode* node) {
    cout << '[';
    for (int count = 0; node != nullptr && count < 1000; node = node->next, ++count) cout << (count ? "," : "") << node->val;
    cout << ']';
}`;
const TREE_HELPERS = `const int STACKBLOOM_NULL = INT_MIN;
TreeNode* stackbloom_tree(initializer_list<int> values) {
    vector<int> items(values);
    if (items.empty() || items[0] == STACKBLOOM_NULL) return nullptr;
    TreeNode* root = new TreeNode(items[0]);
    queue<TreeNode*> waiting;
    waiting.push(root);
    for (size_t i = 1; i < items.size() && !waiting.empty(); waiting.pop()) {
        TreeNode* node = waiting.front();
        if (i < items.size() && items[i] != STACKBLOOM_NULL) waiting.push(node->left = new TreeNode(items[i]));
        ++i;
        if (i < items.size() && items[i] != STACKBLOOM_NULL) waiting.push(node->right = new TreeNode(items[i]));
        ++i;
    }
    return root;
}
void stackbloom_show(TreeNode* root) {
    vector<string> items;
    queue<TreeNode*> waiting;
    waiting.push(root);
    while (!waiting.empty() && items.size() < 1000) {
        TreeNode* node = waiting.front();
        waiting.pop();
        if (node == nullptr) { items.push_back("null"); continue; }
        items.push_back(to_string(node->val));
        waiting.push(node->left);
        waiting.push(node->right);
    }
    while (!items.empty() && items.back() == "null") items.pop_back();
    cout << '[';
    for (size_t i = 0; i < items.size(); ++i) cout << (i ? "," : "") << items[i];
    cout << ']';
}`;
const SHOW = `template <class T> void stackbloom_show(const T& value) { cout << value; }
void stackbloom_show(bool value) { cout << (value ? "true" : "false"); }
void stackbloom_show(char value) { cout << '"' << value << '"'; }
void stackbloom_show(const string& value) { cout << '"' << value << '"'; }
void stackbloom_show(double value) { cout << fixed << setprecision(5) << value; }`;
const SHOW_VECTOR = `template <class T> void stackbloom_show(const vector<T>& items) {
    cout << '[';
    for (size_t i = 0; i < items.size(); ++i) {
        if (i) cout << ',';
        if constexpr (is_same_v<T, bool>) stackbloom_show(bool(items[i])); else stackbloom_show(items[i]);
    }
    cout << ']';
}
template <class T> void stackbloom_print(const T& value) { stackbloom_show(value); cout << '\\n'; }`;

export function buildHarness(solution: string, testcase: string): Harness {
  const method = findMethod(solution);
  const values = parseTestcase(testcase, method);
  const code = codeOnly(solution);
  const types = [method.returns, ...method.params.map(p => p.ty)];
  const needs = (kind: Kind, word: string) => types.some(ty => uses(ty, kind)) || new RegExp(`\\b${word}\\b`).test(code);
  const list = needs('list', 'ListNode'), tree = needs('tree', 'TreeNode');
  const lines: string[] = ['// StackBloom LeetCode harness: your solution comes next, then main() at the end.',
    '#include <bits/stdc++.h>', 'using namespace std;'];
  // `#line N "main.cpp"` must name the physical line that follows it.
  const backToMain = () => lines.push(`#line ${lines.length + 2} "main.cpp"`);
  const defined = (word: string) => new RegExp(`\\b(struct|class)\\s+${word}\\s*\\{`).test(code);
  const structs = [list && !defined('ListNode') && LIST_NODE, tree && !defined('TreeNode') && TREE_NODE].filter(Boolean) as string[];
  if (structs.length) {
    lines.push('#line 1 "stackbloom_harness.h"', ...structs.join('\n').split('\n'));
    backToMain();
  }
  const firstLine = lines.length + 1;
  const user = solution.replace(/\s+$/, '').split('\n');
  lines.push(...user, '', '#line 1 "stackbloom_harness.h"', ...SHOW.split('\n'));
  if (list) lines.push(...LIST_HELPERS.split('\n'));
  if (tree) lines.push(...TREE_HELPERS.split('\n'));
  lines.push(...SHOW_VECTOR.split('\n'));
  backToMain();
  const args = method.params.map(p => p.name).join(', ');
  const shown = method.returns ? 'result' : method.params.find(p => p.output)?.name;
  lines.push('int main() {',
    ...method.params.map((p, i) => `    ${p.ty.name} ${p.name} = ${literal(p.ty, values[i], p.name)};`),
    // A temporary Solution keeps an empty object out of main's locals.
    method.returns ? `    auto result = Solution().${method.name}(${args});` : `    Solution().${method.name}(${args});`,
    ...(shown ? [`    stackbloom_print(${shown});`] : []), '    return 0;', '}', '');
  return {program: lines.join('\n'), firstLine, lines: user.length, method};
}

/** Point compiler messages about the solution back at the lines of the pasted class. */
export function shiftIssues(output: string, harness: Pick<Harness, 'firstLine' | 'lines'>) {
  return output.replace(/main\.cpp:(\d+):/g, (text, line) => {
    const own = Number(line) - harness.firstLine + 1;
    return own >= 1 && own <= harness.lines ? `main.cpp:${own}:` : text.replace('main.cpp', 'harness');
  });
}
