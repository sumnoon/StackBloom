"""Bounded, non-evaluating inspection. Imported by GDB's embedded Python."""
import gdb

MAX_LOCALS = 100
MAX_TEXT = 512
MAX_ELEMENTS = 64


def render(value):
    """Prefer libstdc++ printers; unconstructed containers can make them fail."""
    try:
        return value.format_string(raw=False, max_elements=MAX_ELEMENTS, max_depth=3)
    except (gdb.error, gdb.MemoryError, RuntimeError, ValueError):
        return value.format_string(raw=True, max_elements=MAX_ELEMENTS, max_depth=3)


# A table is a bounded, structured copy of an array or vector of numbers, for the DP table view.
MAX_ROWS = 24
MAX_COLS = 32
MAX_CELLS = 400
MAX_CELL_TEXT = 12
SCALAR_CODES = (gdb.TYPE_CODE_INT, gdb.TYPE_CODE_FLT, gdb.TYPE_CODE_BOOL, gdb.TYPE_CODE_CHAR,
                gdb.TYPE_CODE_ENUM)
SEQUENCES = ("std::vector<", "std::array<", "std::deque<", "std::__cxx11::vector<")


def _is_scalar(value):
    return value.type.strip_typedefs().code in SCALAR_CODES


def _elements(value, limit):
    """Up to `limit` elements of a C array or a libstdc++ sequence, plus whether more exist.

    Returns None for anything that is not a plain sequence (maps, strings, structs).
    """
    typ = value.type.strip_typedefs()
    if typ.code == gdb.TYPE_CODE_ARRAY:
        low, high = typ.range()
        count = high - low + 1
        return [value[low + i] for i in range(min(count, limit))], count > limit
    if not str(typ).startswith(SEQUENCES):
        return None
    printer = gdb.default_visualizer(value)
    if printer is None or not hasattr(printer, "children"):
        return None
    items = []
    # An unconstructed vector has garbage bounds; the limit keeps that read short.
    for position, (_, child) in enumerate(printer.children()):
        if position >= limit:
            return items, True
        # The vector<bool> printer yields Python bools rather than gdb values.
        items.append(child if isinstance(child, gdb.Value) else gdb.Value(child))
    return items, False


def _cell(value):
    try:
        if value.type.strip_typedefs().code == gdb.TYPE_CODE_BOOL:
            return "true" if bool(value) else "false"
        text = value.format_string(raw=True)
    except (gdb.error, gdb.MemoryError, RuntimeError, ValueError):
        return "?"
    return text if len(text) <= MAX_CELL_TEXT else text[:MAX_CELL_TEXT - 1] + "…"


def read_table(value):
    """A 1D or 2D grid of cell texts for arrays and vectors of numbers, or None."""
    try:
        first = _elements(value, 1)
        if first is None or not first[0]:
            return None
        # A sequence of sequences is a 2D table; its rows are bounded separately from its columns.
        nested = not _is_scalar(first[0][0])
        items, truncated = _elements(value, MAX_ROWS if nested else MAX_CELLS)
        if not nested:
            return dict(dims=1, rows=[[_cell(item) for item in items]], truncated=truncated)
        rows = []
        for item in items:
            inner = _elements(item, MAX_COLS)
            if inner is None or not all(_is_scalar(cell) for cell in inner[0]):
                return None
            truncated |= inner[1]
            rows.append([_cell(cell) for cell in inner[0]])
            if sum(len(row) for row in rows) >= MAX_CELLS:
                truncated |= len(rows) < len(items)
                break
        return dict(dims=2, rows=rows, truncated=truncated)
    except (gdb.error, gdb.MemoryError, RuntimeError, ValueError):
        return None


# Associative containers (maps and sets), as bounded key/value entries for the structured view.
MAX_ENTRIES = 32
MAX_ENTRY_TEXT = 40
ASSOCIATIVE = ("std::map<", "std::multimap<", "std::unordered_map<", "std::unordered_multimap<",
               "std::set<", "std::multiset<", "std::unordered_set<", "std::unordered_multiset<")


def _entry_text(value):
    try:
        text = render(value)
    except (gdb.error, gdb.MemoryError, RuntimeError, ValueError):
        return "?"
    return text if len(text) <= MAX_ENTRY_TEXT else text[:MAX_ENTRY_TEXT - 1] + "…"


def read_entries(value):
    """Keys (and values, for maps) of a map or set, in the container's own order, or None."""
    typ = str(value.type.strip_typedefs())
    if not typ.startswith(ASSOCIATIVE):
        return None
    try:
        printer = gdb.default_visualizer(value)
        if printer is None or not hasattr(printer, "children"):
            return None
        is_map = typ.split("<", 1)[0].endswith("map")
        children = []
        # Map printers yield key, value, key, value...; set printers yield the elements.
        limit = MAX_ENTRIES * (2 if is_map else 1)
        for position, (_, child) in enumerate(printer.children()):
            if position >= limit:
                break
            children.append(_entry_text(child))
        truncated = len(children) >= limit
        if is_map:
            items = [[children[i], children[i + 1]] for i in range(0, len(children) - 1, 2)]
        else:
            items = [[key] for key in children]
        return dict(kind="map" if is_map else "set", items=items, truncated=truncated)
    except (gdb.error, gdb.MemoryError, RuntimeError, ValueError):
        return None


def read_local(symbol, frame, scope):
    """Return (item, value); the value feeds the memory graph, never the trace."""
    item = dict(id=f"{scope}:{symbol.name}", name=symbol.name, type=str(symbol.type),
                value=None, address=None, status="unavailable", initialization="unknown",
                is_argument=bool(symbol.is_argument))
    # Where the variable is declared, so the viewer can tell "not set yet" from a value.
    if symbol.line:
        item["decl_line"] = symbol.line
    try:
        value = symbol.value(frame)
        if value.is_optimized_out:
            item["status"] = "optimized_out"
            return item, None
        typ = value.type.strip_typedefs()
        # Never auto-dereference char* or arbitrary pointers; the graph walker
        # follows pointers only into allocations whose extent the ledger proved.
        if typ.code == gdb.TYPE_CODE_PTR:
            item["value"] = hex(int(value))
        else:
            # A reference aliases existing storage; show the referent itself, and its structure.
            target = value.referenced_value() if typ.code in (gdb.TYPE_CODE_REF, gdb.TYPE_CODE_RVALUE_REF) else value
            item["value"] = render(target)[:MAX_TEXT]
            entries = read_entries(target)
            if entries is not None:
                item["entries"] = entries
            table = read_table(target)
            if table and table["rows"] and table["rows"][0]:
                item["table"] = table
        try:
            item["address"] = hex(int(value.address)) if value.address is not None else None
        except (gdb.error, ValueError):
            pass
        item["status"] = "readable"
        return item, value
    except (gdb.error, RuntimeError, ValueError) as exc:
        item["value"] = str(exc)[:MAX_TEXT]
    return item, None


def locals_for(frame):
    """Walk inner-to-outer lexical scopes, stopping before static/global blocks.

    Returns (items, values, truncated), with values positionally aligned to items.
    """
    result, values = [], []
    try:
        block = frame.block()
        depth = 0
        while block is not None and not block.is_global and not block.is_static:
            scope = f"{depth}:{block.start:#x}"
            for symbol in block:
                if symbol.name and (symbol.is_argument or symbol.is_variable):
                    if len(result) >= MAX_LOCALS:
                        return result, values, True
                    item, value = read_local(symbol, frame, scope)
                    result.append(item)
                    values.append(value)
            block = block.superblock
            depth += 1
    except gdb.error:
        return result, values, True
    return result, values, False
