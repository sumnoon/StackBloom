"""Phase 2 memory graph: allocation ledger plus a bounded pointer walker.

Imported by GDB's embedded Python. Nothing here executes inferior functions: the
ledger is read as plain memory, and pointers are followed only into allocations
whose extent the ledger proved. A readable target is still not proof that the
object is alive or initialized.
"""
import bisect
import struct

import gdb

from values import render

MAX_NODES = 64
MAX_FIELDS = 32
MAX_ELEMENTS = 32
MAX_DEPTH = 2
MAX_FREED = 4096
MAX_TEXT = 512
EVENT = struct.Struct("<3Q")

AGGREGATES = (gdb.TYPE_CODE_STRUCT, gdb.TYPE_CODE_UNION)
REFERENCES = (gdb.TYPE_CODE_REF, gdb.TYPE_CODE_RVALUE_REF)
OPAQUE = (gdb.TYPE_CODE_VOID, gdb.TYPE_CODE_FUNC, gdb.TYPE_CODE_METHOD)


class Ledger:
    """Live and freed heap extents, replayed from the in-program event ring."""

    def __init__(self):
        self.live = {}            # start -> (end, allocation_id)
        self.freed = {}           # start -> end
        self.seen = 0
        self.generation = 0
        self.available = False
        self.lost = False
        self._starts = []
        self._freed_starts = []

    def sync(self):
        try:
            count = int(gdb.parse_and_eval("cppv_ledger_count"))
            base = int(gdb.parse_and_eval("(unsigned long long) &cppv_ledger_events[0]"))
            capacity = int(gdb.parse_and_eval("sizeof(cppv_ledger_events)")) // EVENT.size
        except gdb.error:
            self.available = False
            return
        self.available = True
        if count - self.seen > capacity:
            # Older events were overwritten; extents before this point are unknown.
            self.lost = True
            self.seen = count - capacity
        inferior = gdb.selected_inferior()
        while self.seen < count:
            slot = self.seen % capacity
            batch = min(count - self.seen, capacity - slot)
            try:
                data = inferior.read_memory(base + slot * EVENT.size, batch * EVENT.size)
            except gdb.MemoryError:
                self.lost = True
                self.seen = count
                break
            for index in range(batch):
                kind, address, size = EVENT.unpack_from(data, index * EVENT.size)
                self.apply(kind, address, size)
            self.seen += batch
        self._starts = sorted(self.live)
        self._freed_starts = sorted(self.freed)

    def apply(self, kind, address, size):
        if not address:
            return
        if kind == 1:
            end = address + max(size, 1)
            for start in self.overlapping(self.freed, address, end):
                del self.freed[start]
            self.generation += 1
            self.live[address] = (end, f"a{self.generation}")
        elif kind == 2 and address in self.live:
            end, _ = self.live.pop(address)
            self.freed[address] = end
            if len(self.freed) > MAX_FREED:
                del self.freed[next(iter(self.freed))]

    @staticmethod
    def overlapping(table, start, end):
        return [key for key, stop in table.items() if key < end and start < stop]

    @staticmethod
    def _containing(starts, table, address, size):
        index = bisect.bisect_right(starts, address) - 1
        if index < 0:
            return None
        start = starts[index]
        stop = table[start]
        stop = stop[0] if isinstance(stop, tuple) else stop
        return (start, stop) if address + max(size, 1) <= stop else None

    def allocation(self, address, size):
        found = self._containing(self._starts, self.live, address, size)
        if not found:
            return None
        start, end = found
        return start, end, self.live[start][1]

    def is_freed(self, address):
        return self._containing(self._freed_starts, self.freed, address, 1) is not None


class Graph:
    """Per-snapshot walker. Stack ranges are indexed before pointers are followed."""

    def __init__(self, ledger):
        self.ledger = ledger
        self.nodes = {}
        self.stack = []           # (start, end, "frame|local")
        self._starts = []
        self.truncated = ledger.lost
        self.queue = []

    def index_stack(self, frames):
        """frames: [(frame_id, [(local_id, gdb.Value)])], outermost first."""
        for frame_id, locals_ in frames:
            for local_id, value in locals_:
                try:
                    if value is None or value.type.strip_typedefs().code in REFERENCES:
                        continue  # A reference's address is its referent's storage.
                    address = value.address
                    if address is None:
                        continue
                    start = int(address)
                    self.stack.append((start, start + max(value.type.sizeof, 1), f"{frame_id}|{local_id}"))
                except (gdb.error, gdb.MemoryError, RuntimeError, ValueError):
                    continue
        self.stack.sort()
        self._starts = [item[0] for item in self.stack]

    def stack_slot(self, address):
        index = bisect.bisect_right(self._starts, address) - 1
        if index < 0:
            return None
        start, end, label = self.stack[index]
        return label if address < end else None

    def classify(self, address, size):
        """Distinguish null, live heap, stack storage, freed memory and unproven."""
        if not address:
            return dict(target=None, state="null")
        allocation = self.ledger.allocation(address, size)
        if allocation:
            return dict(target=hex(address), state="heap")
        slot = self.stack_slot(address)
        if slot:
            return dict(target=hex(address), state="stack", target_local=slot)
        if self.ledger.is_freed(address):
            return dict(target=hex(address), state="dangling")
        return dict(target=hex(address), state="unknown")

    def pointer(self, value, path):
        """Classify one pointer or reference value and schedule readable targets."""
        typ = value.type.strip_typedefs()
        try:
            if typ.code in REFERENCES:
                referent = value.referenced_value()
                target_type = referent.type
                address = int(referent.address) if referent.address is not None else 0
            else:
                target_type = typ.target()
                address = int(value)
        except (gdb.error, gdb.MemoryError, RuntimeError, ValueError):
            return dict(path=path, target=None, state="unknown")
        stripped = target_type.strip_typedefs()
        size = 0 if stripped.code in OPAQUE else stripped.sizeof
        entry = dict(path=path, **self.classify(address, size))
        if entry["state"] == "heap":
            self.queue.append((address, target_type))
        return entry

    def leaves(self, value, path, depth, out):
        """Flatten an object into displayable leaves, recording pointers as edges.

        Types with a pretty-printer (std::string, containers) stay leaves: their
        internals are implementation detail, not a memory graph the learner wrote.
        """
        if len(out) >= MAX_FIELDS:
            return
        typ = value.type.strip_typedefs()
        if typ.code in (gdb.TYPE_CODE_PTR,) + REFERENCES:
            out.append((path, str(value.type), self.text(value), self.pointer(value, path)))
            return
        printable = typ.code in AGGREGATES or typ.code == gdb.TYPE_CODE_ARRAY
        if not printable or depth >= MAX_DEPTH or gdb.default_visualizer(value) is not None \
                or typ.code == gdb.TYPE_CODE_UNION:
            # Unions stay opaque: DWARF rarely identifies the active member.
            out.append((path, str(value.type), self.text(value), None))
            return
        if typ.code == gdb.TYPE_CODE_ARRAY:
            self.elements(value, typ, path, depth, out)
            return
        for field in typ.fields():
            if not hasattr(field, "bitpos") or field.name is None:
                continue  # Static members and anonymous padding.
            name = path if field.is_base_class else (f"{path}.{field.name}" if path else field.name)
            try:
                self.leaves(value[field], name, depth + 1, out)
            except (gdb.error, gdb.MemoryError, RuntimeError, ValueError):
                out.append((name, str(field.type), "unreadable", None))
            if len(out) >= MAX_FIELDS:
                return

    def elements(self, value, typ, path, depth, out):
        try:
            low, high = typ.range()
        except (gdb.error, RuntimeError, ValueError):
            out.append((path, str(value.type), self.text(value), None))
            return
        count = high - low + 1
        element = typ.target().strip_typedefs()
        if element.code not in (gdb.TYPE_CODE_PTR,) + AGGREGATES:
            out.append((path, str(value.type), self.text(value), None))  # int[8] reads better as text.
            return
        sparse = count > 8 and element.code == gdb.TYPE_CODE_PTR
        for index in range(low, min(low + MAX_ELEMENTS, high + 1)):
            try:
                item = value[index]
                if sparse and int(item) == 0:
                    continue  # Keep wide pointer tables (tries) readable.
            except (gdb.error, gdb.MemoryError, RuntimeError, ValueError):
                continue
            self.leaves(item, f"{path}[{index}]", depth + 1, out)
            if len(out) >= MAX_FIELDS:
                return

    @staticmethod
    def text(value):
        try:
            return render(value)[:MAX_TEXT]
        except (gdb.error, gdb.MemoryError, RuntimeError, ValueError) as exc:
            return str(exc)[:MAX_TEXT]

    def walk(self):
        """Breadth-first over scheduled targets. Nodes are keyed by address."""
        while self.queue:
            address, target_type = self.queue.pop(0)
            key = hex(address)
            if key in self.nodes:
                continue  # Aliases and cycles resolve to the node already recorded.
            if len(self.nodes) >= MAX_NODES:
                self.truncated = True
                return
            allocation = self.ledger.allocation(address, 0)
            if not allocation:
                continue
            self.nodes[key] = self.read(address, target_type, allocation)

    def read(self, address, target_type, allocation):
        start, end, allocation_id = allocation
        stripped = target_type.strip_typedefs()
        node = dict(type=str(target_type), kind="object", allocation_id=allocation_id,
                    size_bytes=end - start, fields=[], truncated=False)
        if stripped.code in OPAQUE or stripped.sizeof == 0:
            node["kind"] = "opaque"
            return node
        try:
            pointer = gdb.Value(address).cast(stripped.pointer())
            obj = pointer.dereference()
        except (gdb.error, gdb.MemoryError, RuntimeError, ValueError):
            node["kind"] = "opaque"
            node["truncated"] = True
            return node
        leaves = []
        if stripped.code in AGGREGATES:
            if gdb.default_visualizer(obj) is not None:
                node["kind"] = "container"
                leaves = [("value", str(target_type), self.text(obj), None)]
            else:
                self.leaves(obj, "", 0, leaves)
        else:
            # A scalar allocation may hold an array; the ledger proves how many fit.
            available = (end - address) // stripped.sizeof
            if available > 1:
                node["kind"] = "array"
                node["truncated"] = available > MAX_ELEMENTS
                for index in range(min(available, MAX_ELEMENTS)):
                    try:
                        self.leaves(pointer[index], f"[{index}]", 1, leaves)
                    except (gdb.error, gdb.MemoryError, RuntimeError, ValueError):
                        break
            else:
                self.leaves(obj, "value", 1, leaves)
        node["truncated"] |= len(leaves) >= MAX_FIELDS
        node["fields"] = [dict(name=name or "value", type=typ, value=text,
                               target=(edge or {}).get("target"), state=(edge or {}).get("state"))
                          for name, typ, text, edge in leaves[:MAX_FIELDS]]
        return node


def capture(ledger, frames):
    """Return (heap nodes, {local id: pointer edges}, truncated) for one stop.

    frames are (frame_id, [(local_id, value)]) pairs, outermost first, so the
    node budget favours long-lived structures over the newest frame.
    """
    ledger.sync()
    graph = Graph(ledger)
    graph.index_stack(frames)
    pointers = {}
    for frame_id, locals_ in frames:
        for local_id, value in locals_:
            if value is None:
                continue
            edges = []
            try:
                graph.leaves(value, "", 0, edges)
            except (gdb.error, gdb.MemoryError, RuntimeError, ValueError):
                continue
            found = [edge for *_, edge in edges if edge]
            if found:
                pointers[f"{frame_id}|{local_id}"] = found
    graph.walk()
    return graph.nodes, pointers, graph.truncated
