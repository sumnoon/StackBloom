"""Exercise the local API and viewer boundary without launching programs here."""
import http.client
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from http.server import HTTPServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tracer"))
from server import Handler


class ServerTests(unittest.TestCase):
    def request(self, body, headers=None):
        server = HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.handle_request)
        thread.start()
        connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
        try:
            connection.request("POST", "/api/trace", json.dumps(body), headers=headers or {
                "Host": "127.0.0.1:8765", "Origin": "http://127.0.0.1:5173",
                "X-CPPV-Request": "trace", "Content-Type": "application/json",
            })
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()
            thread.join(timeout=5)
            server.server_close()

    def serve_once(self, method, path, root, headers=None):
        """One request against a handler bound to a temporary viewer directory."""
        bound = type("BoundHandler", (Handler,), {"root": Path(root)})
        server = HTTPServer(("127.0.0.1", 0), bound)
        thread = threading.Thread(target=server.handle_request)
        thread.start()
        connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
        try:
            connection.request(method, path, headers=headers or {"Host": "127.0.0.1:8765"})
            response = connection.getresponse()
            return response.status, response.read()
        finally:
            connection.close()
            thread.join(timeout=5)
            server.server_close()

    def test_serves_the_built_viewer(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / "index.html").write_text("<!doctype html><title>x</title>", encoding="utf-8")
            assets = Path(directory) / "assets"
            assets.mkdir()
            (assets / "app.js").write_text("export const ok = 1;", encoding="utf-8")
            self.assertEqual(self.serve_once("GET", "/", directory)[0], 200)
            status, body = self.serve_once("GET", "/assets/app.js", directory)
            self.assertEqual((status, body), (200, b"export const ok = 1;"))
            self.assertEqual(self.serve_once("GET", "/missing.js", directory)[0], 404)

    def test_refuses_paths_outside_the_viewer(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "dist"
            root.mkdir()
            (root / "index.html").write_text("ok", encoding="utf-8")
            (Path(directory) / "secret.txt").write_text("private", encoding="utf-8")
            for path in ("/../secret.txt", "/..%2Fsecret.txt", "/assets/../../secret.txt"):
                status, body = self.serve_once("GET", path, root)
                self.assertEqual(status, 404, path)
                self.assertNotIn(b"private", body, path)

    def test_missing_build_explains_itself(self):
        status, body = self.serve_once("GET", "/", Path("does-not-exist"))
        self.assertEqual(status, 503)
        self.assertIn("stackbloom.py", json.loads(body)["error"])

    def test_api_rejects_get(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(self.serve_once("GET", "/api/trace", directory)[0], 405)

    def test_accepts_the_viewer_own_origin(self):
        """The app is served from the same port it submits to."""
        with patch("server.generate", return_value={"snapshots": []}):
            status, _ = self.request({"source": "int main() {}"}, {
                "Host": "127.0.0.1:8765", "Origin": "http://127.0.0.1:8765",
                "X-CPPV-Request": "trace", "Content-Type": "application/json"})
        self.assertEqual(status, 200)

    def test_submission_preserves_source_and_stdin(self):
        def generate(source, **kwargs):
            self.assertEqual(source.read_text(), "int main() {}")
            self.assertEqual(kwargs, dict(stdin="42\n", max_steps=1000, timeout=15))
            return {"snapshots": []}
        with patch("server.generate", side_effect=generate):
            status, _ = self.request({"source": "int main() {}", "stdin": "42\n"})
        self.assertEqual(status, 200)

    def test_rejects_foreign_origin(self):
        with patch("server.generate") as generate:
            status, _ = self.request({"source": "int main() {}"}, {
                "Host": "127.0.0.1:8765", "Origin": "https://example.com",
                "X-CPPV-Request": "trace", "Content-Type": "application/json"})
            generate.assert_not_called()
        self.assertEqual(status, 403)

    def test_accepts_custom_limits(self):
        with patch("server.generate", return_value={"snapshots": []}) as generate:
            status, _ = self.request({"source": "int main() {}", "max_steps": 3000, "timeout": 30})
        self.assertEqual(status, 200)
        self.assertEqual(generate.call_args.kwargs, dict(stdin="", max_steps=3000, timeout=30))

    def test_rejects_out_of_range_limits(self):
        for limits in ({"max_steps": 0}, {"max_steps": 5001}, {"max_steps": True},
                       {"max_steps": "100"}, {"timeout": 61}, {"timeout": 1.5}):
            with self.subTest(limits=limits), patch("server.generate") as generate:
                status, body = self.request({"source": "int main() {}", **limits})
                generate.assert_not_called()
                self.assertEqual(status, 400)
                self.assertIn("whole number", body["error"])

    def test_rejects_empty_source(self):
        self.assertEqual(self.request({"source": " "})[0], 400)

    def test_rejects_nontext_stdin(self):
        self.assertEqual(self.request({"source": "int main() {}", "stdin": 42})[0], 400)

    def test_missing_toolchain_is_actionable(self):
        with patch("server.generate", side_effect=FileNotFoundError("gdb missing")):
            status, body = self.request({"source": "int main() {}"})
        self.assertEqual(status, 503)
        self.assertIn("gdb missing", body["error"])
