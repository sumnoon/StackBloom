"""Loopback-only local app: serves the built viewer and traces submitted code.

One process, one port, one origin. Executes trusted local code; not a sandbox.
"""
import json
import mimetypes
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import tempfile

from trace import generate

MAX_REQUEST = 1024 * 1024
DEFAULT_PORT = 8765
VIEWER = Path(__file__).resolve().parent.parent / "web" / "dist"
# The dev server proxies /api here, so its origin stays allowed alongside ours.
DEV_ORIGINS = ("http://127.0.0.1:5173", "http://localhost:5173")
BUILD_HINT = ("The viewer is not built yet. Run `python stackbloom.py`, which builds it "
              "for you, or build it once with `npm --prefix web ci && npm --prefix web run build`.")


def limit(data, name, default, low, high):
    """An optional whole-number limit from the request, refused when out of range."""
    value = data.get(name, default)
    # bool is an int subclass; `true` is not a stop count.
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise ValueError(f"{name} must be a whole number from {low} to {high}.")
    return value


class Handler(BaseHTTPRequestHandler):
    server_version = "StackBloom"
    root = VIEWER
    port = DEFAULT_PORT

    def origins(self):
        return DEV_ORIGINS + tuple(f"http://{host}:{self.port}" for host in ("127.0.0.1", "localhost"))

    def hosts(self):
        return tuple(f"{host}:{self.port}" for host in ("127.0.0.1", "localhost"))

    def reply(self, status, data):
        payload = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def send_file(self, path):
        body = path.read_bytes()
        kind = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", kind + ("; charset=utf-8" if kind.startswith("text/") else ""))
        self.send_header("Content-Length", str(len(body)))
        # Hashed asset names change on rebuild; never let a stale page linger.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def resolve(self, path):
        """Map a URL path inside the built viewer, refusing traversal."""
        relative = path.split("?", 1)[0].split("#", 1)[0].lstrip("/")
        candidate = (self.root / (relative or "index.html")).resolve()
        root = self.root.resolve()
        if candidate == root or root not in candidate.parents:
            return None
        return candidate if candidate.is_file() else None

    def do_GET(self):
        if self.headers.get("Host") not in self.hosts():
            self.reply(403, {"error": "Only the local viewer may be served."})
            return
        if self.path.startswith("/api/"):
            self.reply(405, {"error": "Use POST for the trace API."})
            return
        if not self.root.is_dir():
            self.reply(503, {"error": BUILD_HINT})
            return
        target = self.resolve(self.path)
        if target is None:
            self.reply(404, {"error": "Not found"})
            return
        self.send_file(target)

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        # No CORS, strict origin/host and a non-simple header prevent drive-by
        # submissions from unrelated websites. These are not code isolation.
        origin = self.headers.get("Origin")
        if (self.headers.get("Host") not in self.hosts()
                or (origin is not None and origin not in self.origins())
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
            max_steps = limit(data, "max_steps", 1000, 1, 5000)
            timeout = limit(data, "timeout", 15, 1, 60)
            with tempfile.TemporaryDirectory(prefix="cppv-submit-") as directory:
                source = Path(directory) / "main.cpp"
                source.write_text(data["source"], encoding="utf-8")
                result = generate(source, stdin=stdin, max_steps=max_steps, timeout=timeout)
            self.reply(200, result)
        except (ValueError, UnicodeError) as exc:
            self.reply(400, {"error": str(exc)})
        except OSError as exc:
            self.reply(503, {"error": f"Cannot run the local toolchain: {exc}"})

    def setup(self):
        super().setup()
        self.connection.settimeout(60)

    def log_message(self, fmt, *args):
        if os.environ.get("STACKBLOOM_QUIET") != "1":
            super().log_message(fmt, *args)


def serve(port=DEFAULT_PORT, root=VIEWER):
    """Run until interrupted. Deliberately single-threaded: one trace at a time,
    which also keeps the launcher's Linux preexec_fn safe."""
    handler = type("BoundHandler", (Handler,), {"root": Path(root), "port": port})
    server = HTTPServer(("127.0.0.1", port), handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    # Never expose this server to a network.
    print(f"StackBloom: http://127.0.0.1:{DEFAULT_PORT} (trusted code only)", flush=True)
    if not VIEWER.is_dir():
        print(BUILD_HINT, flush=True)
    serve()
