"""Loopback-only development API. Executes trusted local code; not a sandbox."""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import tempfile

from trace import generate

MAX_REQUEST = 1024 * 1024


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, data):
        payload = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        # No CORS, strict origin/host and a non-simple header prevent drive-by
        # submissions from unrelated websites. These are not code isolation.
        if (self.headers.get("Host") not in ("127.0.0.1:8765", "localhost:8765")
                or self.headers.get("Origin") not in ("http://127.0.0.1:5173", "http://localhost:5173")
                or self.headers.get("X-CPPV-Request") != "trace"):
            self.reply(403, {"error": "Only the local viewer may submit code."})
            return
        if self.path != "/api/trace":
            self.reply(404, {"error": "Unknown endpoint"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_REQUEST:
                self.reply(413, {"error": "Request must be smaller than 1 MiB."})
                return
            if self.headers.get_content_type() != "application/json":
                self.reply(415, {"error": "Expected JSON."})
                return
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict) or not isinstance(data.get("source"), str) or not data["source"].strip():
                raise ValueError("Enter C++ source code first.")
            stdin = data.get("stdin", "")
            if not isinstance(stdin, str) or len(stdin.encode("utf-8")) > 65536:
                raise ValueError("stdin must be text smaller than 64 KiB.")
            with tempfile.TemporaryDirectory(prefix="cppv-submit-") as directory:
                source = Path(directory) / "main.cpp"
                source.write_text(data["source"], encoding="utf-8")
                result = generate(source, stdin=stdin, max_steps=1000, timeout=15)
            self.reply(200, result)
        except (ValueError, UnicodeError) as exc:
            self.reply(400, {"error": str(exc)})
        except OSError as exc:
            self.reply(503, {"error": f"Cannot run the local toolchain: {exc}"})

    def setup(self):
        super().setup()
        self.connection.settimeout(60)


if __name__ == "__main__":
    # Deliberately single-threaded: one compile/trace at a time, and safe use of
    # the launcher's Linux preexec_fn. Never expose this server to a network.
    server = HTTPServer(("127.0.0.1", 8765), Handler)
    print("Local trace API: http://127.0.0.1:8765 (trusted code only)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
