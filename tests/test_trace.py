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

    @unittest.skipUnless(printer_directory("g++"), "libstdc++ GDB printers not installed")
    def test_arrays_and_vectors_become_tables(self):
        """Numbers in arrays and vectors are recorded as grids; strings and maps are not."""
        stops = self.run_source('#include <string>\n#include <vector>\nint dp[5];\nint main() {\n'
                                ' int a[3] = {4, 5, 6};\n std::vector<int> v = {1, 2};\n'
                                ' std::vector<std::vector<int>> g(2, std::vector<int>(3, 7));\n'
                                ' std::string s = "hi";\n dp[2] = 9;\n return 0;\n}\n')
        final = [s for s in stops if s["location"] and s["location"]["line"] == 10][-1]
        tables = {v["name"]: v.get("table") for v in final["frames"][0]["locals"]}
        self.assertEqual(tables["a"], {"dims": 1, "rows": [["4", "5", "6"]], "truncated": False})
        self.assertEqual(tables["v"], {"dims": 1, "rows": [["1", "2"]], "truncated": False})
        self.assertEqual(tables["g"], {"dims": 2, "rows": [["7", "7", "7"], ["7", "7", "7"]], "truncated": False})
        self.assertIsNone(tables["s"])
        globals_ = {v["name"]: v["table"] for v in final.get("globals", [])}
        self.assertEqual(globals_["dp"]["rows"], [["0", "0", "9", "0", "0"]])

    @unittest.skipUnless(printer_directory("g++"), "libstdc++ GDB printers not installed")
    def test_maps_and_sets_become_entries(self):
        """Associative containers keep their keys (and values) as structured entries."""
        stops = self.run_source('#include <map>\n#include <set>\n#include <string>\n#include <unordered_map>\n'
                                'int main() {\n std::map<std::string, int> ages = {{"amy", 30}, {"bo", 7}};\n'
                                ' std::set<int> seen = {3, 1, 2};\n std::unordered_map<int, int> memo = {{5, 8}};\n'
                                ' std::map<std::pair<int, int>, int> grid = {{{1, 2}, 3}};\n return 0;\n}\n')
        final = [s for s in stops if s["location"] and s["location"]["line"] == 10][-1]
        entries = {v["name"]: v.get("entries") for v in final["frames"][0]["locals"]}
        self.assertEqual(entries["ages"], {"kind": "map", "items": [['"amy"', "30"], ['"bo"', "7"]], "truncated": False})
        self.assertEqual(entries["seen"], {"kind": "set", "items": [["1"], ["2"], ["3"]], "truncated": False})
        self.assertEqual(entries["memo"]["items"], [["5", "8"]])
        self.assertEqual(entries["grid"]["kind"], "map")
        self.assertIn("1", entries["grid"]["items"][0][0])
        self.assertEqual(entries["grid"]["items"][0][1], "3")

    @unittest.skipUnless(printer_directory("g++"), "libstdc++ GDB printers not installed")
    def test_global_memo_and_reference_parameters(self):
        """A file-scope memo map is recorded, and a reference parameter shows its referent's table."""
        stops = self.run_source('#include <map>\n#include <vector>\nstd::map<int, int> memo;\n'
                                'void fill(std::vector<int>& dp) {\n dp[1] = 5;\n memo[2] = 9;\n}\n'
                                'int main() {\n std::vector<int> dp(3, 0);\n fill(dp);\n return 0;\n}\n')
        inside = [s for s in stops if s["location"] and s["location"]["line"] == 6][-1]
        dp = next(v for v in inside["frames"][0]["locals"] if v["name"] == "dp")
        self.assertEqual(dp["table"]["rows"], [["0", "5", "0"]])
        final = [s for s in stops if s["location"] and s["location"]["line"] == 11][-1]
        memo = next(v for v in final.get("globals", []) if v["name"] == "memo")
        self.assertEqual(memo["entries"], {"kind": "map", "items": [["2", "9"]], "truncated": False})

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

    def test_local_ids_survive_inner_blocks(self):
        # Views match a local across stops by id, so leaving a loop body must not rename it.
        stops = self.run_source("int main() {\n int total = 0;\n for (int i = 0; i < 2; ++i) {\n int step = i + 1;\n total += step;\n }\n return total;\n}\n")
        ids = {v["id"] for s in stops for f in s["frames"] for v in f["locals"] if v["name"] == "total"}
        self.assertEqual(len(ids), 1)

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

    @unittest.skipUnless(printer_directory("g++"), "libstdc++ GDB printers not installed")
    def test_vector_of_bool_becomes_a_table(self):
        stops = self.run_source('#include <vector>\nint main() {\n std::vector<bool> seen = {true, false};\n seen[1] = true;\n return 0;\n}\n')
        tables = [v["table"]["rows"] for s in stops for f in s["frames"] for v in f["locals"] if v.get("table")]
        self.assertIn([["true", "true"]], tables)

    def test_line_directive_harness_stays_out_of_the_trace(self):
        # LeetCode mode files its builders under another name; only the solution and main stop.
        stops = self.run_source(
            '#include <iostream>\n'
            'int twice(int x) {\n return 2 * x;\n}\n'
            '#line 1 "stackbloom_harness.h"\n'
            'int build(int x) {\n int y = x + 1;\n return y;\n}\n'
            '#line 11 "main.cpp"\n'
            'int main() {\n int value = build(2);\n std::cout << twice(value) << "\\n";\n return 0;\n}\n')
        self.assertEqual(stops[-1]["stdout"].replace("\r\n", "\n"), "6\n")
        lines = {s["location"]["line"] for s in stops if s["location"]}
        self.assertEqual(lines, {2, 3, 4, 12, 13, 14, 15})
        self.assertFalse(any(f["function"] == "build" for s in stops for f in s["frames"]))


if __name__ == "__main__":
    unittest.main()
