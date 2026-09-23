/** Presentation-only rewrites that make GDB's text read like the program's source.
 *  The raw text always stays available in a tooltip; nothing here changes the trace. */
import type {Frame, Local, PointerEdge, PointerState, Snapshot, Trace} from './trace';

type TypeNode = {name: string; args: TypeNode[]; suffix: string};

/** Parse `a::b<c, d<e>> const*` into a name, template arguments and a trailing suffix. */
function parseType(text: string): TypeNode {
  let at = 0;
  function node(): TypeNode {
    let name = '';
    while (at < text.length && !'<>,'.includes(text[at])) name += text[at++];
    const args: TypeNode[] = [];
    if (text[at] === '<') {
      at++;
      while (at < text.length && text[at] !== '>') {
        args.push(node());
        if (text[at] === ',') at++;
      }
      at++; // '>'
    }
    let suffix = '';
    while (at < text.length && !'<>,'.includes(text[at])) suffix += text[at++];
    return {name: name.trim(), args, suffix: suffix.trimEnd()};
  }
  return node();
}

function print(type: TypeNode): string {
  const args = type.args.length ? `<${type.args.map(print).join(', ')}>` : '';
  return `${type.name}${args}${type.suffix}`;
}

const same = (a: TypeNode | undefined, b: string) => !!a && print(a) === b;

/** Drop the defaults a programmer never writes: allocators, comparators, deleters. */
function simplify(type: TypeNode): TypeNode {
  const args = type.args.map(simplify);
  // `const std::vector<...>`: match the rules on the bare name, then put qualifiers back.
  const qualifiers = type.name.match(/^(?:(?:const|volatile)\s+)*/)![0];
  if (qualifiers) {
    const inner = simplify({...type, name: type.name.slice(qualifiers.length)});
    return {...inner, name: qualifiers + inner.name};
  }
  const name = type.name.replace(/\bstd::__cxx11::/g, 'std::').replace(/\bstd::__1::/g, 'std::');
  const text = (value: TypeNode | undefined) => value ? print(value) : '';
  const [first, second] = args;
  let kept = args;
  if (name === 'std::basic_string' && same(first, 'char')) return {name: 'std::string', args: [], suffix: type.suffix};
  if (['std::vector', 'std::list', 'std::deque', 'std::forward_list'].includes(name)
      && same(args[1], `std::allocator<${text(first)}>`)) kept = [first];
  if (['std::set', 'std::multiset'].includes(name) && same(args[1], `std::less<${text(first)}>`)) kept = [first];
  if (['std::map', 'std::multimap'].includes(name) && same(args[2], `std::less<${text(first)}>`)) kept = [first, second];
  if (['std::unordered_set', 'std::unordered_multiset'].includes(name) && same(args[1], `std::hash<${text(first)}>`)) kept = [first];
  if (['std::unordered_map', 'std::unordered_multimap'].includes(name) && same(args[2], `std::hash<${text(first)}>`)) kept = [first, second];
  if (name === 'std::unique_ptr' && same(args[1], `std::default_delete<${text(first)}>`)) kept = [first];
  if (['std::stack', 'std::queue'].includes(name) && same(args[1], `std::deque<${text(first)}>`)) kept = [first];
  if (name === 'std::priority_queue' && same(args[1], `std::vector<${text(first)}>`)
      && (args.length < 3 || same(args[2], `std::less<${text(first)}>`))) kept = [first];
  return {name, args: kept, suffix: type.suffix};
}

/** `std::vector<int, std::allocator<int> >` → `std::vector<int>`. */
export function shortType(type: string): string {
  try {
    return print(simplify(parseType(type))).replace(/\s+([*&])/g, '$1');
  } catch {
    return type;
  }
}

/** Strip the libstdc++ printers' preamble, keeping the element count as a badge:
 *  `std::vector of length 3, capacity 3 = {1, 2, 3}` → `{1, 2, 3}` with 3 items. */
export function shortValue(value: string): {text: string; count?: number} {
  const container = value.match(/^std::[\w:]+ (?:of length|with) (\d+)(?: elements?)?(?:, capacity \d+)?(?: = )?([\s\S]*)$/);
  if (container) {
    const count = Number(container[1]);
    // Sets print "{[0] = 5, [1] = 7}"; the indices are the printer's, not the program's.
    const body = (container[2] || '{}').replace(/\[\d+\] = /g, '');
    return {text: body, count};
  }
  const pointer = value.match(/^std::(unique_ptr|shared_ptr|weak_ptr)<.*?> = \{get\(\) = (0x[0-9a-f]+)\}/);
  if (pointer) return {text: pointer[2] === '0x0' ? 'empty' : `owns ${pointer[2]}`};
  return {text: value};
}

/** A heap object in a word or two: its allocation id and first plain field. */
export function nodeSummary(snapshot: Snapshot, address: string) {
  const node = snapshot.heap[address];
  if (!node) return address;
  const field = node.fields.find(item => !item.state && item.value);
  const detail = field ? ` (${field.name === 'value' || field.name.startsWith('[') ? '' : field.name + ' '}${shortValue(field.value!).text.slice(0, 10)})` : '';
  return `${node.allocation_id ?? address}${detail}`;
}

function localName(snapshot: Snapshot, slot: string | undefined) {
  if (!slot) return undefined;
  const [frameId, localId] = slot.split('|');
  return snapshot.frames.find(frame => frame.id === frameId)?.locals.find(local => local.id === localId)?.name;
}

/** Where a pointer goes, in the program's terms instead of a hex address. */
export function pointerText(edge: {state?: PointerState | null; target: string | null; target_local?: string},
                            snapshot: Snapshot): string {
  switch (edge.state) {
    case 'null': return 'null';
    case 'heap': return `→ ${edge.target ? nodeSummary(snapshot, edge.target) : '?'}`;
    case 'stack': return `→ ${localName(snapshot, edge.target_local) ?? 'a local'}`;
    case 'dangling': return '✕ dangling';
    default: return '? unknown';
  }
}

/** A local whose value is leftover memory: declared further down than the line
 *  about to run, or an argument at its call's first stop (before the prologue
 *  stores it). Keyed by call and local, so it lines up across stops. */
export function unsetLocals(trace: Trace, index: number) {
  const unset = new Set<string>();
  const stop = trace.snapshots[index];
  const previous = trace.snapshots[index - 1];
  if (!stop) return unset;
  for (const frame of stop.frames) {
    const entering = !!frame.call_id && !!previous && !previous.frames.some(item => item.call_id === frame.call_id);
    for (const local of frame.locals)
      if (local.is_argument ? entering : (local.decl_line ?? 0) > frame.location.line)
        unset.add(localKey(frame, local));
  }
  return unset;
}

export const localKey = (frame: Frame, local: Local) => `${frame.call_id ?? frame.id}|${local.id}`;

/** The whole-variable pointer edge of a local, if it is itself a pointer or reference. */
export const ownPointer = (local: Local): PointerEdge | undefined => local.pointers?.find(edge => edge.path === '');
