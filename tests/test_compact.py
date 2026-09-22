"""Phase 4 replay: reconstruction must equal the full-snapshot baseline."""
import json
from pathlib import Path
import random
import sys
import tempfile
import unittest

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tracer"))
from compact import compact, expand, snapshot_at
from trace import generate


class CompactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.validator = Draft202012Validator(json.loads((ROOT / "trace.schema.json").read_text()))
        cls.compact_validator = Draft202012Validator(
            json.loads((ROOT / "trace.compact.schema.json").read_text()))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.cpp"
            path.write_text((ROOT / "examples/linked_list.cpp").read_text(), encoding="utf-8")
            cls.trace = generate(path)
        cls.validator.validate(cls.trace)

    def test_round_trip_matches_the_baseline(self):
        for interval in (1, 3, 25):
            with self.subTest(interval=interval):
                stored = compact(self.trace, interval)
                self.compact_validator.validate(stored)
                restored = expand(stored)
                self.assertEqual(restored, self.trace)
                self.validator.validate(restored)

    def test_random_seek_equals_full_snapshot(self):
        stored = compact(self.trace, 7)
        random.seed(20260922)
        positions = random.sample(range(len(self.trace["snapshots"])),
                                  min(20, len(self.trace["snapshots"])))
        for position in positions + [0, len(self.trace["snapshots"]) - 1]:
            self.assertEqual(snapshot_at(stored, position), self.trace["snapshots"][position],
                             f"seek to {position} must equal the recorded snapshot")

    def test_deleted_heap_objects_are_explicit(self):
        """A freed address must be removed, never silently carried forward."""
        stored = compact(self.trace, 1000)
        removals = [key for entry in stored["entries"] if entry["kind"] == "delta"
                    for key in entry["changes"].get("heap_remove", [])]
        self.assertTrue(removals, "the linked list example frees its head")
        for position, snapshot in enumerate(self.trace["snapshots"]):
            self.assertEqual(snapshot_at(stored, position)["heap"], snapshot["heap"])

    def test_storage_is_smaller_than_full_snapshots(self):
        full = len(json.dumps(self.trace))
        stored = len(json.dumps(compact(self.trace)))
        self.assertLess(stored, full)

    def test_expand_rejects_a_foreign_document(self):
        with self.assertRaises(ValueError):
            expand({"format": "something-else", "entries": []})


if __name__ == "__main__":
    unittest.main()
