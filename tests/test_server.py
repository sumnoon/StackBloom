"""Exercise the local API boundary without launching programs in test threads."""
import http.client
import json
from pathlib import Path
import sys
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

    def test_rejects_empty_source(self):
        self.assertEqual(self.request({"source": " "})[0], 400)

    def test_rejects_nontext_stdin(self):
        self.assertEqual(self.request({"source": "int main() {}", "stdin": 42})[0], 400)

    def test_missing_toolchain_is_actionable(self):
        with patch("server.generate", side_effect=FileNotFoundError("gdb missing")):
            status, body = self.request({"source": "int main() {}"})
        self.assertEqual(status, 503)
        self.assertIn("gdb missing", body["error"])
