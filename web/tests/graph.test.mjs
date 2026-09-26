import {test} from 'node:test';
import assert from 'node:assert/strict';
import {annotate, graphsAt} from '../src/graph.ts';

// A list of rows is a 2D table; a flat list of cells is a 1D one.
const table = (name, cells, type = 'std::vector<std::vector<int>>') => {
  const flat = !Array.isArray(cells[0]);
  return {id: `0:0x1:${name}`, name, type, status: 'readable', value: '', table: {dims: flat ? 1 : 2, rows: flat ? [cells] : cells, truncated: false}};
};
const scalar = (name, value, type = 'int') => ({id: `0:0x1:${name}`, name, type, status: 'readable', value});
const stop = (locals, extra = {}) => ({event: 'step', heap: {}, stdout: '', stderr: '',
  frames: [{id: 'f0', call_id: 'c1', function: 'main', location: {file: 'main.cpp', line: 9}, locals}], ...extra});

test('a named or jagged adjacency list becomes a graph; other tables do not', () => {
  const undirected = graphsAt(stop([table('adj', [['1', '2'], ['0', '2'], ['0', '1']])]));
  assert.equal(undirected.length, 1);
  assert.deepEqual(undirected[0].graph.edges, [[0, 1], [0, 2], [1, 2]]);
  assert.equal(undirected[0].graph.directed, false);
  const jagged = graphsAt(stop([table('out', [['1'], ['2', '3'], [], []])]));
  assert.deepEqual(jagged[0].graph.edges, [[0, 1], [1, 2], [1, 3]]);
  assert.equal(jagged[0].graph.directed, true);
  // A DP grid of small numbers, an edge list and an out-of-range list stay tables.
  assert.equal(graphsAt(stop([table('dp', [['0', '1', '1'], ['1', '2', '0'], ['1', '0', '2']])])).length, 0);
  assert.equal(graphsAt(stop([table('edges', [['0', '1'], ['1', '2'], ['2', '0']])])).length, 0);
  assert.equal(graphsAt(stop([table('adj', [['1', '9'], ['0']])])).length, 0);
});

test('a named square 0/1 table is an adjacency matrix', () => {
  const [found] = graphsAt(stop([table('graph', [['0', '1', '0'], ['0', '0', '1'], ['1', '0', '0']])]));
  assert.deepEqual(found.graph.edges, [[0, 1], [1, 2], [2, 0]]);
  assert.equal(found.graph.directed, true);
});

test('an unset adjacency list is skipped', () => {
  assert.equal(graphsAt(stop([table('adj', [['1'], ['0']])]), new Set(['c1|0:0x1:adj'])).length, 0);
});

test('BFS marks come from the program\'s own variables', () => {
  const snapshot = stop([
    table('adj', [['1', '2'], ['0', '3'], ['0', '3'], ['1', '2']]),
    table('visited', ['true', 'true', 'false', 'false'], 'std::vector<bool>'),
    table('dist', ['0', '1', '-1', '2147483647'], 'std::vector<int>'),
    table('q', ['3', '2'], 'std::queue<int, std::deque<int>>'),
    scalar('u', '1'), scalar('v', '3'),
  ]);
  const notes = annotate(snapshot, 4, new Set());
  assert.deepEqual([...notes.visited], [0, 1]);
  assert.equal(notes.visitedName, 'visited');
  assert.deepEqual(notes.labels.map(t => t.local.name), ['dist']);
  assert.deepEqual([...notes.waiting], [[3, 1], [2, 2]]);
  assert.equal(notes.current, 1);
  assert.equal(notes.neighbour, 3);
});

test('a stack numbers from the top, and DFS frames give the recursion path', () => {
  const frame = (call, u) => ({id: call, call_id: call, function: 'dfs', location: {file: 'main.cpp', line: 5}, locals: [scalar('u', u)]});
  const snapshot = {event: 'step', heap: {}, stdout: '', stderr: '', frames: [
    {...frame('c3', '2'), locals: [scalar('u', '2'), table('st', ['0', '3'], 'std::stack<int, std::deque<int>>')]},
    frame('c2', '1'), frame('c1', '0'),
    {id: 'm', call_id: 'm', function: 'main', location: {file: 'main.cpp', line: 20}, locals: [table('adj', [['1'], ['2'], ['3'], []])]},
  ]};
  const notes = annotate(snapshot, 4, new Set());
  assert.deepEqual(notes.path, [2, 1, 0]);
  assert.deepEqual([...notes.waiting], [[3, 1], [0, 2]]);
});
