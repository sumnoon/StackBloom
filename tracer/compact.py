"""Checkpoint/delta storage for traces. Pure data: no GDB, no compiler.

A trace repeats most of its state at every stop. This stores a full snapshot
every `interval` stops and bounded differences in between, so a reader can
reconstruct any stop from the nearest checkpoint instead of replaying from the
start. Snapshots stay immutable: reconstruction returns exactly what the tracer
recorded, which `tests/test_compact.py` checks against the full baseline.

Output streams are appended rather than copied whenever the previous text is a
prefix of the new one, and removed heap addresses are explicit deletion records
so a reader never confuses "gone" with "unchanged".
"""
import copy

FORMAT = "cppv-compact-1.0"
INTERVAL = 25
SIMPLE = ("event", "location", "thread_id", "output_truncated", "diagnostic", "heap_truncated", "returns",
          "globals")


def _streams(before, after, changes):
    for name in ("stdout", "stderr"):
        old, new = before.get(name, ""), after.get(name, "")
        if old == new:
            continue
        if new.startswith(old):
            changes[f"{name}_append"] = new[len(old):]
        else:
            changes[name] = new


def _frames(before, after, changes):
    old, new = before.get("frames", []), after.get("frames", [])
    if old == new:
        return
    # null keeps the frame at that position; the list length is authoritative.
    changes["frames"] = [None if index < len(old) and old[index] == frame else frame
                         for index, frame in enumerate(new)]


def _heap(before, after, changes):
    old, new = before.get("heap", {}), after.get("heap", {})
    upsert = {key: node for key, node in new.items() if old.get(key) != node}
    remove = [key for key in old if key not in new]
    if upsert:
        changes["heap_upsert"] = upsert
    if remove:
        changes["heap_remove"] = remove


def diff(before, after):
    changes = {}
    for key in SIMPLE:
        if key in after and after[key] != before.get(key):
            changes[key] = after[key]
    _streams(before, after, changes)
    _frames(before, after, changes)
    _heap(before, after, changes)
    dropped = [key for key in before if key not in after and key != "id"]
    if dropped:
        changes["drop"] = dropped
    return changes


def patch(before, changes):
    after = copy.deepcopy(before)
    for key in changes.get("drop", []):
        after.pop(key, None)
    for key in SIMPLE:
        if key in changes:
            after[key] = copy.deepcopy(changes[key])
    for name in ("stdout", "stderr"):
        if name in changes:
            after[name] = changes[name]
        elif f"{name}_append" in changes:
            after[name] = after.get(name, "") + changes[f"{name}_append"]
    if "frames" in changes:
        previous = before.get("frames", [])
        after["frames"] = [copy.deepcopy(previous[index]) if frame is None else copy.deepcopy(frame)
                           for index, frame in enumerate(changes["frames"])]
    if "heap_upsert" in changes or "heap_remove" in changes:
        heap = after.setdefault("heap", {})
        for key in changes.get("heap_remove", []):
            heap.pop(key, None)
        heap.update(copy.deepcopy(changes.get("heap_upsert", {})))
    return after


def compact(trace, interval=INTERVAL):
    """Rewrite a full trace as checkpoints plus deltas."""
    entries = []
    previous = None
    for position, snapshot in enumerate(trace["snapshots"]):
        if position % interval == 0 or previous is None:
            entries.append(dict(kind="full", snapshot=copy.deepcopy(snapshot)))
        else:
            changes = diff(previous, snapshot)
            changes.pop("id", None)
            entries.append(dict(kind="delta", id=snapshot["id"], changes=changes))
        previous = snapshot
    return dict(format=FORMAT, checkpoint_interval=interval,
                schema_version=trace["schema_version"], source=trace["source"],
                limits=trace["limits"], entries=entries)


def snapshot_at(compacted, position):
    """Reconstruct one stop from the nearest earlier checkpoint."""
    entries = compacted["entries"]
    if not 0 <= position < len(entries):
        raise IndexError(position)
    start = position
    while entries[start]["kind"] != "full":
        start -= 1
    state = copy.deepcopy(entries[start]["snapshot"])
    for step in range(start + 1, position + 1):
        entry = entries[step]
        state = patch(state, entry["changes"])
        state["id"] = entry["id"]
    return state


def expand(compacted):
    """Reconstruct the full trace, replaying deltas in order."""
    if compacted.get("format") != FORMAT:
        raise ValueError(f"Not a {FORMAT} trace")
    snapshots = []
    state = None
    for entry in compacted["entries"]:
        if entry["kind"] == "full":
            state = copy.deepcopy(entry["snapshot"])
        else:
            state = patch(state, entry["changes"])
            state["id"] = entry["id"]
        snapshots.append(state)
    return dict(schema_version=compacted["schema_version"], source=compacted["source"],
                limits=compacted["limits"], snapshots=snapshots)
