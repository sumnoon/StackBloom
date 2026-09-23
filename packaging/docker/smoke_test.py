"""Check a running StackBloom end to end: viewer, a real trace, and the Host guard.

    python packaging/docker/smoke_test.py http://127.0.0.1:8765

Standard library only, so it runs anywhere the container's port is reachable.
"""
import json
import sys
import urllib.error
import urllib.request

PROGRAM = """#include <iostream>
#include <vector>

struct Node { int value; Node* next; };

int fib(int n) {
    if (n <= 1) return n;
    return fib(n - 1) + fib(n - 2);
}

int main() {
    std::vector<int> v{1, 2, 3};
    Node* head = new Node{fib(5), nullptr};
    std::cout << head->value + v[2] << std::endl;
    delete head;
    return 0;
}
"""


def request(url, data=None, headers=None):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def main(base):
    port = base.rsplit(":", 1)[1].rstrip("/")
    status, body = request(base + "/")
    assert status == 200 and b"<title>" in body, f"viewer: {status}"
    print("viewer served")

    payload = json.dumps({"source": PROGRAM, "stdin": ""}).encode()
    headers = {"Content-Type": "application/json", "X-CPPV-Request": "trace", "Origin": f"http://127.0.0.1:{port}"}
    status, body = request(base + "/api/trace", payload, headers)
    assert status == 200, f"trace request: {status} {body[:300]!r}"
    trace = json.loads(body)
    final = trace["snapshots"][-1]
    assert final["event"] == "exit" and final["diagnostic"]["exit_code"] == 0, f"program: {final['diagnostic']}"
    assert final["stdout"].strip() == "8", f"stdout: {final['stdout']!r}"
    calls = {f["call_id"] for s in trace["snapshots"] for f in s["frames"] if f.get("call_id")}
    assert len(calls) >= 10, f"only {len(calls)} calls recorded"
    values = {l["value"] for s in trace["snapshots"] for f in s["frames"] for l in f["locals"] if l["name"] == "v"}
    assert any(value and value.endswith("{1, 2, 3}") for value in values), f"vector not pretty-printed: {values}"
    assert any(s["heap"] for s in trace["snapshots"]), "no heap object recorded"
    print(f"traced: {len(trace['snapshots'])} stops, {len(calls)} calls, printers and heap ledger working")

    # The guard against other origins must survive being published through a container.
    status, _ = request(base + "/api/trace", payload, {**headers, "Host": f"192.0.2.10:{port}"})
    assert status == 403, f"foreign Host header was accepted: {status}"
    print("foreign Host header refused")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765")
