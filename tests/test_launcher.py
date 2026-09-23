"""The launcher's guard against folders too deep for the bundled compiler."""
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import stackbloom


class PortablePathTests(unittest.TestCase):
    def check(self, folder, portable=True):
        compiler = os.path.join(folder, "toolchain", "bin", "g++.exe")
        env = {"STACKBLOOM_PORTABLE": "1"} if portable else {}
        with patch.dict(os.environ, env, clear=False), patch("stackbloom.shutil.which", return_value=compiler):
            if not portable:
                os.environ.pop("STACKBLOOM_PORTABLE", None)
            stackbloom.portable_path_check()

    def test_short_folder_is_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            self.check(os.path.join(directory, "StackBloom"))

    def test_deep_folder_is_refused_with_a_way_out(self):
        with tempfile.TemporaryDirectory() as directory:
            deep = os.path.join(directory, "d" * (stackbloom.PORTABLE_FOLDER_LIMIT + 1 - len(directory)), "StackBloom")
            with self.assertRaises(SystemExit) as refused:
                self.check(deep)
            message = str(refused.exception)
            self.assertIn("too deep", message)
            self.assertIn(r"C:\StackBloom", message)

    def test_only_applies_to_the_portable_bundle(self):
        """A developer's own toolchain is never second-guessed."""
        with tempfile.TemporaryDirectory() as directory:
            self.check(os.path.join(directory, "d" * 200), portable=False)

    def test_missing_compiler_is_explained(self):
        with patch.dict(os.environ, {"STACKBLOOM_PORTABLE": "1"}), patch("stackbloom.shutil.which", return_value=None):
            with self.assertRaises(SystemExit) as missing:
                stackbloom.portable_path_check()
        self.assertIn("Unzip StackBloom again", str(missing.exception))


if __name__ == "__main__":
    unittest.main()
