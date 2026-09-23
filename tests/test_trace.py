"""Integration tests execute actual compiled programs through GDB."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tracer"))
from trace import generate, printer_directory


class TraceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.validator = Draft202012Validator(json.loads((ROOT / "trace.schema.json").read_text()))

    def run_source(self, source, **kwargs):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.cpp"
            path.write_text(source, encoding="utf-8")
            result = generate(path, **kwargs)
        self.validator.validate(result)
        self.assertEqual([s["id"] for s in result["snapshots"]], list(range(len(result["snapshots"]))))
        return result["snapshots"]

    def test_sample_stack_locals_stdin_and_output(self):
        stops = self.run_source((ROOT / "examples/sample.cpp").read_text(), stdin="3\n")
        self.assertEqual(stops[-1]["event"], "exit")
        self.assertEqual(stops[-1]["stdout"].replace("\r\n", "\n"), "total=1\ntotal=5\ntotal=14\n")
        calls = [s for s in stops if len(s["frames"]) == 2 and s["location"]["line"] == 5]
        self.assertTrue(calls)
        values = {v["value"] for s in calls for v in s["frames"][0]["locals"] if v["name"] == "result"}
        self.assertTrue({"1", "4", "9"}.issubset(values))
        self.assertGreater(sum(s["location"] is not None and s["location"]["line"] == 12 for s in stops), 2)

    def test_branching_recursion_call_tree(self):
        stops = self.run_source((ROOT / "examples/fib.cpp").read_text(), stdin="4\n")
        self.assertEqual(stops[-1]["stdout"].replace("\r\n", "\n"), "fib(4) = 3\n")
        parents, args = {}, {}
        for stop in stops:
            path = list(reversed(stop["frames"]))
            for depth, frame in enumerate(path):
                parents.setdefault(frame["call_id"], path[depth - 1]["call_id"] if depth else None)
                args[frame["call_id"]] = [v["value"] for v in frame["locals"] if v.get("is_argument")]
        returns = {r["call_id"]: r["value"] for stop in stops for r in stop.get("returns", [])}

        def shape(call):
            children = [child for child, parent in parents.items() if parent == call]
            return (args[call], [shape(child) for child in children])
        # The first call below main is fib(4).
        root = next(call for call, parent in parents.items() if parent is not None and parents[parent] is None)
        leaf = lambda n: ([n], [])
        self.assertEqual(shape(root), (["4"], [
            (["3"], [(["2"], [leaf("1"), leaf("0")]), leaf("1")]),
            (["2"], [leaf("1"), leaf("0")]),
        ]))
        self.assertEqual(returns[root], "3")
        leaves = [call for call in args if args[call] in (["0"], ["1"])]
        self.assertEqual(len(leaves), 5)
        self.assertTrue(all(returns[call] == args[call][0] for call in leaves))

    @unittest.skipUnless(printer_directory("g++"), "libstdc++ GDB printers not installed")
    def test_standard_library_values_are_readable(self):
        stops = self.run_source('#include <map>\n#include <string>\n#include <vector>\nint main() {\n'
                                ' std::string name = "hello";\n std::vector<int> nums = {1, 2, 3};\n'
                                ' std::map<std::string, int> ages = {{"amy", 30}};\n return 0;\n}\n')
        final = [s for s in stops if s["location"] and s["location"]["line"] == 8][-1]
        values = {v["name"]: v["value"] for v in final["frames"][0]["locals"]}
        self.assertEqual(values["name"], '"hello"')
        self.assertIn("{1, 2, 3}", values["nums"])
        self.assertIn('["amy"] = 30', values["ages"])

    def test_locals_record_their_declaration_line(self):
        """The viewer marks a local "not set yet" until its declaration line has run."""
        stops = self.run_source("int main() {\n int first = 1;\n int later = 2;\n return first + later;\n}\n")
        declared = {v["name"]: v.get("decl_line") for s in stops for f in s["frames"] for v in f["locals"]}
        self.assertEqual(declared, {"first": 2, "later": 3})

    def test_compile_error(self):
        self.assertEqual(self.run_source("int main( { broken")[0]["event"], "compile_error")

    def test_signal(self):
        stops = self.run_source('int main() {\n volatile int* p = nullptr;\n *p = 42;\n}\n')
        self.assertEqual(stops[-1]["event"], "signal")
        self.assertEqual(stops[-1]["diagnostic"]["signal"], "SIGSEGV")

    def test_step_limit(self):
        stops = self.run_source("int main() {\n volatile int i = 0;\n while (true) { ++i; }\n}\n", max_steps=8)
        self.assertEqual(stops[-1]["event"], "limit")
        self.assertEqual(sum(s["event"] == "step" for s in stops), 8)

    def test_wall_timeout_inside_library(self):
        stops = self.run_source('#include <thread>\n#include <chrono>\nint main() {\n std::this_thread::sleep_for(std::chrono::seconds(10));\n}\n', timeout=3)
        self.assertEqual(stops[-1]["event"], "timeout")

    def test_shadowed_locals_and_nonzero_exit(self):
        stops = self.run_source("int main() {\n int x = 1;\n { int x = 7;\n x += 1;\n }\n return 4;\n}\n")
        self.assertEqual(stops[-1]["diagnostic"]["exit_code"], 4)
        shadowed = [f for s in stops for f in s["frames"] if sum(v["name"] == "x" for v in f["locals"]) == 2]
        self.assertTrue(shadowed)
        for frame in shadowed:
            ids = [v["id"] for v in frame["locals"]]
            self.assertEqual(len(ids), len(set(ids)))

    def test_library_callback_is_traced(self):
        stops = self.run_source('#include <cstdlib>\nint compare(const void* a, const void* b) {\n return *(const int*)a - *(const int*)b;\n}\nint main() {\n int data[] = {3, 1, 2};\n std::qsort(data, 3, sizeof(int), compare);\n return 0;\n}\n')
        self.assertTrue(any(any("compare" in f["function"] for f in s["frames"]) for s in stops))

    def test_output_is_bounded(self):
        stops = self.run_source('#include <cstdio>\nint main() {\n std::printf("%070000d", 1);\n std::fflush(stdout);\n return 0;\n}\n')
        self.assertEqual(stops[-1]["event"], "exit")
        self.assertEqual(len(stops[-1]["stdout"]), 65536)
        self.assertTrue(stops[-1]["output_truncated"])

    def test_new_thread_is_reported(self):
        stops = self.run_source('#include <thread>\n#include <chrono>\nvoid worker() {\n std::this_thread::sleep_for(std::chrono::milliseconds(100));\n}\nint main() {\n std::thread t(worker);\n t.join();\n}\n')
        self.assertEqual(stops[-1]["event"], "unsupported")


if __name__ == "__main__":
    unittest.main()
