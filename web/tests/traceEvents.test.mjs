import {test} from 'node:test';
import assert from 'node:assert/strict';
import {traceEvents} from '../src/traceEvents.ts';
const stop = (extra = {}) => ({event: 'step', frames: [], heap: {}, stdout: '', stderr: '', ...extra});
test('return markers require an observed return, including null values', () => {
  const trace = {snapshots: [stop({frames: [{call_id:'a', function:'f'}]}), stop(), stop({returns:[{call_id:'a', value:null}]})]};
  assert.deepEqual(traceEvents(trace).filter(e => e.kind === 'return'), [{index:2, kind:'return', label:'Return (value unavailable)'}]);
});
test('address reuse counts both allocation generations', () => {
  const trace = {snapshots: [stop({heap:{'0x1':{allocation_id:'a'}}}), stop({heap:{'0x1':{allocation_id:'b'}}})]};
  assert.equal(traceEvents(trace).find(e => e.index === 1).label, '1 new, 1 removed heap objects');
});
test('output and failing exits remain distinct events', () => {
  const events = traceEvents({snapshots:[stop(), stop({event:'exit', stdout:'hi', diagnostic:{exit_code:1}})]});
  assert.deepEqual(events.map(e => e.kind), ['error', 'output']);
});
