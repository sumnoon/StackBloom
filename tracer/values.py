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
        elif typ.code in (gdb.TYPE_CODE_REF, gdb.TYPE_CODE_RVALUE_REF):
            # A reference aliases existing storage; show the referent itself.
            item["value"] = render(value.referenced_value())[:MAX_TEXT]
        else:
            item["value"] = render(value)[:MAX_TEXT]
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
