# StackBloom in a container: the same app on Linux, macOS or Windows with Docker.
#
#   docker build -t stackbloom .
#   docker run --rm -p 127.0.0.1:8765:8765 stackbloom
#
# Always publish on 127.0.0.1. `-p 8765:8765` publishes on every interface, and
# anything that can reach the port can compile and run code in the container.

# ---- viewer: Node is needed to build it, never to run it ----
FROM node:24-bookworm-slim AS viewer
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# The viewer bundles the trace schema and the sample trace from the repository root.
COPY trace.schema.json /src/
COPY examples/sample.trace.json /src/examples/
RUN npm run build

# ---- runtime: a compiler, a Python-enabled GDB and Python ----
FROM ubuntu:24.04
RUN apt-get update \
 && apt-get install -y --no-install-recommends g++ gdb python3 \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 10001 stackbloom
WORKDIR /app
COPY stackbloom.py ./
COPY tracer/ tracer/
COPY examples/*.cpp examples/
COPY --from=viewer /src/web/dist web/dist
USER stackbloom
ENV PYTHONDONTWRITEBYTECODE=1
EXPOSE 8765
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s \
  CMD ["python3", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/')"]
# 0.0.0.0 inside the container's own network namespace; exposure is decided by
# `-p` on the host. The server still accepts only 127.0.0.1/localhost Host and
# Origin headers on this port.
CMD ["python3", "stackbloom.py", "--host", "0.0.0.0", "--no-browser", "--skip-build"]
