# Roadmap and extension recipes

These snippets are implementation starting points, **not enabled Phase 1 features**.
Each phase needs fixtures for both GCC/libstdc++ and Clang/libc++ before claiming
portable real-world C++ support. Debug information describes types and locations;
it does not supply a complete C++ abstract-machine history.

| Phase | Deliverable | Acceptance examples |
|---|---|---|
| 1 — stack and locals | Compile, line stops, lexical scopes, stdin, stdout, explicit failures, React replay | Nested calls, shadowing, loops, nonzero exit, segfault, timeout |
| 2 — memory graph **(implemented)** | Typed bounded walker, allocation ledger, identity, aliases, cycles, references | Two aliases to one node, cyclic list, stack pointers, dangling pointer, freed/reused address |
| 3 — logical containers | Bounded adapters for string, vector, map, unordered_map, set, list, deque and smart pointers | Empty/large/corrupt containers, both library ABIs, custom allocators, shared_ptr aliasing |
| 4 — layouts and time travel **(implemented)** | Structure heuristics, checkpoint/delta storage, stable navigation | Cyclic graphs, trees, lists, grids; random seek equals full-snapshot baseline |
| 5 — performance and isolation | Job queue, resource-isolated workers, measured tracing overhead, rr/instrumentation experiments | Adversarial CPU/memory/output/fork workloads; worker cleanup; compiler isolation |

The requested phase ordering is useful for local development. **Move isolation ahead
of public source submission**, even if graph/layout work is incomplete. Snapshot
replay already provides basic backward navigation in Phase 1; Phase 4 improves its
storage and presentation rather than pretending to reverse an ordinary native run.

## Phase 2: pointers and memory identity

Build a per-stop object registry shared across all locals and frames. First index
addressable stack locals, then traverse pointers. A pointer is not proof of heap
allocation: it may target a stack local, static storage, code, one-past-end memory,
a base subobject, or unmapped bytes. Null, unreadable, dangling, and opaque are
different outcomes. Track a separate global/static object region in schema 2.

Illustrative GDB walker core (helper policies are explicit extension points):

```python
def follow_pointer(value, registry, allocation_ledger, budget):
    target = value.type.strip_typedefs().target().strip_typedefs()
    address = int(value)
    if address == 0:
        return {"state": "null", "target": None}
    key = hex(address)
    if key in registry:
        return {"state": "alias", "target": key}
    # Implement lookup as a range lookup, with freed records retained separately.
    allocation = allocation_ledger.live_allocation_containing(address)
    if target.code in (gdb.TYPE_CODE_VOID, gdb.TYPE_CODE_FUNC):
        return {"state": "opaque", "target": key}
    if not allocation or address + target.sizeof > allocation.end:
        return {"state": "unproven_extent", "target": key}
    if not budget.consume_node_and_bytes(target.sizeof):
        return {"state": "truncated", "target": key}
    # Insert BEFORE traversing fields: this breaks A -> B -> A recursion.
    registry[key] = {"type": str(target), "fields": [], "truncated": False}
    try:
        obj = value.dereference()
        # Enumerate target.fields(), recurse through field values with shared
        # registry/budget. Record bases and bitfields; do not read union arms.
        registry[key]["fields"] = inspect_fields(obj, registry, allocation_ledger, budget)
    except gdb.MemoryError:
        registry[key]["truncated"] = True
    return {"state": "reference", "target": key}
```

Use a queue and depth/node/byte caps rather than unrestricted Python recursion in
production. Validate readable mappings, but recognize that readable does not mean
live or initialized. Add provenance/confidence to schema 2; never present guessed
types as authoritative. Views at a shared address can have different static types;
deduplicate storage while retaining typed views, including base-class views.

### Allocation extents

Prefer an allocation event stream recording `(event, address, requested_bytes,
allocation_generation, thread_id)`. Interpose `malloc/calloc/realloc/free` and all
relevant scalar/array/aligned/sized `new/delete` variants, or insert compiler hooks.
Avoid double counting `operator new` calling `malloc`. The recorder needs a
preallocated/reentrancy-safe channel: allocating inside a malloc hook can recurse.
Track successful realloc separately: failure preserves the old allocation, while
success retires its old lifetime. Zero-size behavior is implementation-dependent.

A debugger-only prototype can use entry and return breakpoints:

```python
class AllocationReturn(gdb.FinishBreakpoint):
    def __init__(self, frame, requested_bytes, ledger):
        super().__init__(frame, internal=True)
        self.requested_bytes, self.ledger = requested_bytes, ledger

    def stop(self):
        if self.return_value is not None:
            address = int(self.return_value)
            if address:
                self.ledger.record_alloc(address, self.requested_bytes)
        return False

# Entry breakpoint: capture size before returning and instantiate AllocationReturn.
# Obtaining the size requires argument DWARF or an ABI-specific register adapter:
# x86-64 SysV malloc(size) -> rdi; Windows x64 -> rcx; AArch64 -> x0.
# Handle out_of_scope() for exceptions/longjmp; callbacks must remain bounded.
```

Requested allocation size is **not** array element count. Array-new cookies,
alignment, pooled allocators, flexible layouts, and placement construction defeat
`bytes / sizeof(T)` as a universal rule. Use that only for proven homogeneous
arrays, report its provenance, and allow an explicit user extent annotation.
Allocator metadata or `malloc_usable_size` exposes implementation-dependent capacity,
not logical length; calling the latter in a paused inferior can deadlock. Avoid it
as the default and do not invoke inferior functions to discover extents.

### Cases that cannot be solved perfectly from DWARF

- `void*` and raw buffers: show address plus capped bytes only when the extent is
  known. Allow opt-in typed views, labeled as user assertions.
- Unions: DWARF normally cannot identify the active member. Show the union as opaque
  unless a known discriminator or instrumentation proves the active arm.
- Placement new: allocation hooks see storage, not lifetime/type transitions.
  Instrument construction/destruction or accept explicit annotations. Address-keyed
  identity alone conflates successive objects in the same storage.
- References: use `referenced_value()` and canonical address mapping; references
  alias existing storage, and an rvalue reference is not evidence of heap ownership.
- Inheritance/virtual calls: enumerate base fields, preserve adjustment offsets,
  and use `dynamic_type` only when GDB can resolve a valid polymorphic object.
  A vptr-looking word is not enough. Virtual bases can be unavailable during
  construction/destruction; member pointers are not ordinary addresses.
- Templates/lambdas: instantiated function names and closure fields usually exist
  in DWARF. Display demangled names and capture fields, but treat compiler-generated
  field names as unstable. Inline frames, coroutines and optimized builds need
  dedicated handling. Multi-file tracing needs a source manifest and all relevant
  line tables, not merely the symtab containing `main`.

## Phase 3: STL and smart pointers

Use trusted libstdc++ pretty-printers or LLDB synthetic children, selected by the
actual library/compiler version. Do not parse `str(value)` to recover elements.
The Phase 1 launcher disables auto-loading; deliberately load a known system
printer package inside the worker before enabling this path.

```python
import itertools

def logical_children(value, limit=128):
    printer = gdb.default_visualizer(value)
    if printer is None or not hasattr(printer, "children"):
        return None  # Fall back to the bounded typed walker.
    children = list(itertools.islice(printer.children(), limit + 1))
    hint = printer.display_hint() if hasattr(printer, "display_hint") else None
    return {"hint": hint, "children": children[:limit],
            "truncated": len(children) > limit}
```

This only bounds yielded children: a corrupt container can hang inside `next()`.
Keep a worker deadline and add ABI-specific validity checks. Pretty-printers are
trusted Python code and must never come from the uploaded executable's auto-load
sections. Disable arbitrary user printer registration.

Start with string/vector, then map/set/unordered_map, then list/deque. Handle
string small-buffer optimization and embedded NULs without C-string assumptions;
vector capacity differs from size, and `vector<bool>` is a packed proxy type.
Map hints usually emit alternating key/value children; preserve key objects instead
of stringifying them into JSON property names. Unordered traversal order may vary.
Deque uses segmented storage; list is not contiguous. Container iterators can be
invalid without an immediate fault. Custom allocators and debug iterator modes
change layouts. Tests should pin actual ABI fixtures.

For `unique_ptr`, extract the stored pointer through an adapter; its deleter may
carry state. For `shared_ptr`, distinguish the exposed pointer from ownership of
the control block. Aliasing constructors allow two pointers to share ownership
while targeting different subobjects. Model that as separate ownership edges,
not collapsed pointee identities. `weak_ptr` is non-owning; reading a use count
must not invoke `lock()` or mutate the program. Custom smart pointers require
explicit adapters. Never call `size()`, `get()`, or `operator[]` in the inferior.

## Phase 4: graph layouts and efficient replay

Render React Flow nodes/edges and ask ELK for positions. Keep storage identity
separate from visual grouping, and preserve existing positions across adjacent
snapshots to reduce distracting jumps.

```ts
import ELK from 'elkjs/lib/elk.bundled.js';
const elk = new ELK();
const layout = await elk.layout({
  id: 'heap',
  layoutOptions: {'elk.algorithm': 'layered', 'elk.direction': 'RIGHT'},
  children: nodes.map(n => ({id: n.id, width: 180, height: n.height})),
  edges: edges.map(e => ({id: e.id, sources: [e.source], targets: [e.target]})),
});
// Copy child x/y to React Flow positions. Ignore stale asynchronous results
// after the user has moved to another snapshot.
```

Treat field names as suggestions. `left/right` becomes a tree only after cycle
and indegree checks; a shared child is a DAG, not a tree. `next/prev` suggests a
list but still needs cycle markers and validation of reciprocal links. A true
`T[R][C]` array has DWARF extents and can render as a grid. `T**` is not generally
rectangular or contiguous; require proven row bounds. Provide a generic graph
fallback and a user override for each heuristic.

For storage, retain full checkpoints every K stops and bounded deltas between them:

```python
def object_delta(before, after):
    return {
        "upsert": {k: v for k, v in after.items() if before.get(k) != v},
        "remove": [k for k in before if k not in after],
    }

def apply_delta(state, delta):
    result = dict(state)
    for key in delta["remove"]:
        result.pop(key, None)
    result.update(delta["upsert"])
    return result
```

Use lifetime-stable frame and allocation IDs before diffing; Phase 1 positional
IDs are insufficient. Reconstruct from the nearest checkpoint for arbitrary seek,
or store inverse deltas for immediate backward steps. Append output byte chunks
instead of copying cumulative strings. Include deletion records, schema versions,
and checksums. Keep snapshots immutable, test reconstruction against full traces,
and distinguish unavailable values from removed objects. Skipped loop iterations
need an explicit timeline gap marker, never an invented intermediate state.

## Phase 5: workers, security, concurrency and performance

An eventual API accepts source/stdin and fixed options, returns a job ID, and
streams status plus bounded trace chunks. A queue runs separate compile and trace
workers. Do not accept arbitrary compiler flags, file paths, environment variables,
GDB commands, or host includes. Give each job a fresh disposable filesystem with
no secrets, no network, an unprivileged UID, read-only toolchain, limited tmpfs,
cgroup CPU/memory/PID budgets, and a host-enforced deadline. Sandbox compilation
too: preprocessors can read files and compiler inputs are adversarial.

Illustrative Docker **resource profile**, to combine with a reviewed seccomp/LSM
policy and a purpose-built worker image (not supplied as a production sandbox):

```sh
docker run --rm --network none --read-only --user 65534:65534 \
  --cap-drop ALL --security-opt no-new-privileges \
  --security-opt seccomp=worker-seccomp.json \
  --cpus 1 --memory 768m --pids-limit 32 \
  --tmpfs /work:rw,nosuid,nodev,size=128m \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m \
  cppv-worker
```

The image must consume the job through a narrow channel and write the trace through
a supervisor-controlled channel. GDB needs ptrace of its own child and appropriate
process-memory syscalls; test the seccomp policy with your runtime/kernel and Yama
settings. Do not solve this with `--privileged` or host PID namespaces. Separate the
debugger's tracing permissions from the inferior's restrictions when using nsjail,
Landlock, or a nested launcher. A policy that allows GDB to ptrace can otherwise
allow the inferior to attack the debugger. Choose gVisor only after validating the
required debugger/syscall behavior on the pinned release; its historical `ptrace`
platform name does not by itself prove guest debugging compatibility.

Limits must apply to whole job cgroups and filesystem bytes, not just a parent PID.
Destroy the cgroup after completion, crash, disconnect or timeout; child processes
can escape a process group. Prevent source/trace/log path tampering and cap compiler
diagnostics, debugger logs, JSON size, allocation records, and client rendering work.

### Crashes and undefined behavior

GDB's signal event preserves a faulting stack (when unwind information/memory survive).
Not every UB crashes, and not every crash yields a valid stack. Add a **separate**
diagnostic run, rather than claiming sanitizer addresses match the teaching trace:

```sh
clang++ -std=c++17 -g -O1 -fno-omit-frame-pointer \
  -fsanitize=address,undefined -fno-sanitize-recover=all main.cpp -o checked
ASAN_OPTIONS=detect_leaks=0 ./checked < stdin.txt
```

ASan changes layout/timing and reserves a large virtual address range, so the MVP's
2 GiB address-space limit is incompatible; use a sanitizer-specific worker profile
and cgroup physical-memory limits. Leak checking under ptrace is problematic; run
leak detection independently. ASan/UBSan do not prove the absence of UB or reliably
detect all uninitialized reads. MemorySanitizer needs instrumented dependencies.
ThreadSanitizer requires its own build and execution profile.

### Threads

Phase 1 detects additional threads at recorded stops and terminates as unsupported.
A thread that never reaches another source stop may instead hit the wall timeout;
it is not a race detector. Phase 5 captures all threads at all-stop events, plus
selected thread and stop reason. A starting inspection loop is:

```python
selected = gdb.selected_thread()
try:
    for thread in gdb.selected_inferior().threads():
        thread.switch()
        capture_thread_stack(thread.num)  # bounded walker, no function calls
finally:
    if selected and selected.is_valid():
        selected.switch()
```

`scheduler-locking step` can make demonstrations easier to follow but can deadlock
when the selected thread waits for another. All-stop observation changes scheduling;
it is not a consistent C++ happens-before history or a faithful model of every race.
Record scheduling limitations in the trace. Fork/exec requires a separate multi-
inferior design and PID-qualified identities; do not silently merge address spaces.

### Performance experiments

Measure stop latency, value-walk latency, serialized bytes, frontend render time and
peak worker memory separately. Cache immutable type metadata, intern strings,
batch trace chunks, virtualize large source/variable lists and cap expanded graph
nodes. Avoid re-reading untouched large objects only when modification information
is reliable. Long-loop sampling is a lossy mode and must be labeled.

`rr record ./program` followed by `rr replay` can support deterministic replay and
on-demand extraction rather than eagerly materializing every state. It still needs
debugger value extraction and specialized deployment; rr serializes execution onto
one core and has hardware/kernel/syscall constraints. Benchmark your workloads; it
is not guaranteed to accelerate snapshot collection.

Clang LibTooling can insert probes at source locations and allocation/lifetime
events. It can recover information DWARF lacks, but rewriting templates, macros,
coroutines, exceptional control flow, sequencing and volatile/atomic accesses can
change semantics. Instrumentation misses precompiled libraries unless they also
participate. Start with a deliberately restricted subset and differential tests
against the debugger recorder before presenting it as a general replacement.

## Primary references

- [GDB pretty-printing API](https://sourceware.org/gdb/current/onlinedocs/gdb.html/Pretty-Printing-API.html)
- [GDB all-stop behavior](https://sourceware.org/gdb/current/onlinedocs/gdb.html/All_002dStop-Mode.html)
- [AddressSanitizer](https://clang.llvm.org/docs/AddressSanitizer.html)
- [Landlock and ptrace restrictions](https://www.kernel.org/doc/html/v6.12/userspace-api/landlock.html)
- [gVisor platforms](https://gvisor.dev/docs/architecture_guide/platforms/)
- [rr design and limitations](https://rr-project.org/)
