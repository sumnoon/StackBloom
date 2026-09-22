"""Phase 2 acceptance: pointer states, aliases, cycles, extents and lifetimes."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tracer"))
from trace import generate


class MemoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.validator = Draft202012Validator(json.loads((ROOT / "trace.schema.json").read_text()))

    def run_source(self, source, **kwargs):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.cpp"
            path.write_text(source, encoding="utf-8")
            result = generate(path, **kwargs)
        self.validator.validate(result)
        return result["snapshots"]

    @staticmethod
    def at_line(stops, line):
        """The last stop before a given source line executes."""
        return [s for s in stops if s["location"] and s["location"]["line"] == line][-1]

    @staticmethod
    def pointers(stop, name):
        for frame in stop["frames"]:
            for local in frame["locals"]:
                if local["name"] == name and local.get("pointers"):
                    return local["pointers"][0]
        return None

    def test_aliases_share_one_node_and_cycles_terminate(self):
        stops = self.run_source(
            "struct Node { int value; Node* next; };\n"
            "int main() {\n"
            " Node* a = new Node{1, nullptr};\n"
            " Node* b = new Node{2, a};\n"
            " a->next = b;\n"
            " Node* alias = a;\n"
            " return alias->value;\n"
            "}\n")
        stop = self.at_line(stops, 7)
        self.assertEqual(len(stop["heap"]), 2, "a cycle must not duplicate nodes")
        first = self.pointers(stop, "a")
        self.assertEqual(first["state"], "heap")
        self.assertEqual(self.pointers(stop, "alias")["target"], first["target"],
                         "an alias resolves to the same node")
        node = stop["heap"][first["target"]]
        other = stop["heap"][[key for key in stop["heap"] if key != first["target"]][0]]
        self.assertEqual({f["name"]: f["state"] for f in node["fields"]}["next"], "heap")
        self.assertEqual({f["name"]: f["target"] for f in other["fields"]}["next"], first["target"])

    def test_stack_pointer_is_not_heap(self):
        stops = self.run_source("int main() {\n int counter = 7;\n int* p = &counter;\n return *p;\n}\n")
        edge = self.pointers(self.at_line(stops, 4), "p")
        self.assertEqual(edge["state"], "stack")
        self.assertIn("counter", edge["target_local"])

    def test_null_and_dangling_are_distinguished(self):
        stops = self.run_source(
            "struct Node { int value; Node* next; };\n"
            "int main() {\n"
            " Node* empty = nullptr;\n"
            " Node* node = new Node{1, nullptr};\n"
            " delete node;\n"
            " return empty == nullptr;\n"
            "}\n")
        stop = self.at_line(stops, 6)
        self.assertEqual(self.pointers(stop, "empty")["state"], "null")
        self.assertEqual(self.pointers(stop, "node")["state"], "dangling")
        self.assertEqual(stop["heap"], {}, "freed memory is never followed")

    def test_reused_address_gets_a_new_allocation_id(self):
        stops = self.run_source(
            "int main() {\n int* first = new int(1);\n delete first;\n"
            " int* second = new int(2);\n return *second;\n}\n")
        before = self.pointers(self.at_line(stops, 3), "first")
        after = self.pointers(self.at_line(stops, 5), "second")
        self.assertEqual(before["state"], "heap")
        self.assertEqual(after["state"], "heap")
        if before["target"] == after["target"]:  # Allocators usually reuse the block.
            self.assertNotEqual(self.at_line(stops, 3)["heap"][before["target"]]["allocation_id"],
                                self.at_line(stops, 5)["heap"][after["target"]]["allocation_id"])

    def test_array_extent_comes_from_the_ledger(self):
        stops = self.run_source("int main() {\n int* values = new int[3]{4, 5, 6};\n return values[0];\n}\n")
        stop = self.at_line(stops, 3)
        node = stop["heap"][self.pointers(stop, "values")["target"]]
        self.assertEqual(node["kind"], "array")
        self.assertEqual(node["size_bytes"], 3 * 4)
        self.assertEqual([field["value"] for field in node["fields"]], ["4", "5", "6"])

    def test_malloc_is_tracked_and_void_stays_opaque(self):
        stops = self.run_source("#include <cstdlib>\nint main() {\n void* raw = std::malloc(24);\n"
                                " std::free(raw);\n return 0;\n}\n")
        allocated = self.at_line(stops, 4)
        node = allocated["heap"][self.pointers(allocated, "raw")["target"]]
        self.assertEqual((node["kind"], node["size_bytes"]), ("opaque", 24))
        self.assertEqual(self.pointers(self.at_line(stops, 5), "raw")["state"], "dangling")

    def test_replacing_operator_new_falls_back_without_the_ledger(self):
        """The ledger must never turn a valid program into a compile error."""
        stops = self.run_source(
            "#include <cstdlib>\n#include <new>\n"
            "void* operator new(std::size_t size) { return std::malloc(size); }\n"
            "void operator delete(void* p) noexcept { std::free(p); }\n"
            "int main() {\n int* value = new int(3);\n int result = *value;\n delete value;\n return result;\n}\n")
        self.assertEqual(stops[-1]["event"], "exit")
        self.assertEqual(stops[-1]["diagnostic"]["exit_code"], 3)
        self.assertEqual(self.pointers(self.at_line(stops, 7), "value")["state"], "unknown")


if __name__ == "__main__":
    unittest.main()
