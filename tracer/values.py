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
    item = dict(id=f"{scope}:{symbol.name}", name=symbol.name, type=str(symbol.type),
                value=None, address=None, status="unavailable", initialization="unknown",
                is_argument=bool(symbol.is_argument))
    try:
        value = symbol.value(frame)
        if value.is_optimized_out:
            item["status"] = "optimized_out"
            return item
        typ = value.type.strip_typedefs()
        # Never auto-dereference char*, references, or arbitrary pointers.
        if typ.code == gdb.TYPE_CODE_PTR:
            item["value"] = hex(int(value))
        elif typ.code in (gdb.TYPE_CODE_REF, gdb.TYPE_CODE_RVALUE_REF):
            item["value"] = "reference (target deferred to Phase 2)"
        else:
            item["value"] = render(value)[:MAX_TEXT]
        try:
            item["address"] = hex(int(value.address)) if value.address is not None else None
        except (gdb.error, ValueError):
            pass
        item["status"] = "readable"
    except (gdb.error, RuntimeError, ValueError) as exc:
        item["value"] = str(exc)[:MAX_TEXT]
    return item


def locals_for(frame):
    """Walk inner-to-outer lexical scopes, stopping before static/global blocks."""
    result = []
    try:
        block = frame.block()
        depth = 0
        while block is not None and not block.is_global and not block.is_static:
            scope = f"{depth}:{block.start:#x}"
            for symbol in block:
                if symbol.name and (symbol.is_argument or symbol.is_variable):
                    if len(result) >= MAX_LOCALS:
                        return result, True
                    result.append(read_local(symbol, frame, scope))
            block = block.superblock
            depth += 1
    except gdb.error:
        return result, True
    return result, False
