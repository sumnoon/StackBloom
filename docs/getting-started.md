# Installation and startup

[← Back to StackBloom](../README.md)

Choose one setup below. You do not need all three.

## Windows

### Portable: download, unzip, run

The Windows download carries everything StackBloom needs — the C++ compiler, the
debugger, Python and the viewer — so it runs on a PC with none of them installed.

1. Download `StackBloom-windows-x64.zip` from the
   [latest release](https://github.com/sumnoon/StackBloom/releases/latest). Every build is also available from the
   [Windows portable bundle](https://github.com/sumnoon/StackBloom/actions/workflows/windows-bundle.yml)
   workflow's artifacts.
2. Extract it, open the `StackBloom` folder, and double-click **StackBloom.cmd**. Your
   browser opens on the editor.

No system-wide toolchain installation is needed; delete the extracted folder to
remove the app. Recent runs are stored separately in your browser. The launcher puts only its own folder and Windows on `PATH`, so a
different compiler elsewhere on the machine can't interfere.

Two things to know:

- **Keep the folder at 130 characters or fewer**, such as `C:\StackBloom` or your
  Downloads folder. GCC opens its own headers through un-normalized paths and
  Windows stops at 260 characters, so from a deeper folder it can't find
  `<iostream>`. StackBloom checks this at start-up and says so.
- The launcher is not code-signed, so SmartScreen may warn on first run: choose
  **More info → Run anyway**.

To build the bundle yourself, see [Building the Windows bundle](development.md#building-the-windows-bundle).

### From source, with MSYS2

This is the setup for working on StackBloom itself. You need a C++ compiler, a
Python-enabled GDB, Python 3 and Node.js. Tested on Windows 11.

**1. Install MSYS2** from [msys2.org](https://www.msys2.org/), then open the
**UCRT64** terminal and install the toolchain:

```sh
pacman -S --needed mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-gdb
```

**2. Put the toolchain on your PATH.** Add `C:\msys64\ucrt64\bin` to your user `Path`
(Settings → *Edit environment variables for your account*), then open a new terminal
and check that both tools answer, and that GDB has Python built in:

```sh
g++ --version
gdb -nx -batch -ex "python import sys; print(sys.version)"
```

If the last command prints nothing or errors, your GDB lacks Python; install the
MSYS2 one above rather than a plain MinGW build.

**3. Install Python 3.10+** from [python.org](https://www.python.org/downloads/)
(tick *Add python.exe to PATH*) and **Node.js 22.12+ or 24 LTS** from
[nodejs.org](https://nodejs.org/).

That is all the setup needed: `python stackbloom.py` installs the web dependencies and
builds the viewer on its first run.

A note specific to Windows: several programs ship their own copy of the C++ runtime
(Git for Windows is a common one). StackBloom passes the compiler's own directory
first when it runs your program, so it loads the runtime it was built against.

## Docker

The image carries the compiler, a Python-enabled GDB, Python and the built viewer,
so Docker is the only thing to install.

```sh
docker build -t stackbloom .
```

```sh
docker run --rm -p 127.0.0.1:8765:8765 stackbloom
```

Then open [localhost:8765](http://127.0.0.1:8765). The release workflow can also
publish a ready-made image to GHCR; if an image is available for your release:

```sh
docker run --rm -p 127.0.0.1:8765:8765 ghcr.io/sumnoon/stackbloom
```

**Always write `127.0.0.1:` in `-p`.** A bare `-p 8765:8765` publishes the port on
every network interface, and anything that can reach it can compile and run code in
the container. The server also refuses requests whose `Host` isn't `127.0.0.1` or
`localhost`, which stops a browser on another machine, but not a determined client.

For a tighter box, this is the profile CI runs on every change — read-only root, no
capabilities, no privilege escalation, and memory and process limits. GDB needs no
extra capability, because it only traces its own child process:

```sh
docker run --rm -p 127.0.0.1:8765:8765 --read-only --tmpfs /tmp:rw,exec,nosuid,size=256m --cap-drop ALL --security-opt no-new-privileges --memory 1g --pids-limit 128 stackbloom
```

`/tmp` must allow `exec`: that is where your program is compiled and run. A container
narrows what a hostile program can reach, but it shares the host's kernel, so treat
it as a convenience, not a sandbox for untrusted code.

## Ubuntu 22.04

```sh
sudo apt update
sudo apt install -y build-essential gdb python3 python3-venv
gdb -nx -batch -ex 'python import sys; print(sys.version)'
```

Use Node.js **22.12+ or 24 LTS**; Ubuntu 22.04's default Node package is too old for
this Vite setup. See [Vite's prerequisites](https://vite.dev/guide/).

## Start from source

Clone the repository, or download and extract its source archive. From its root:

```sh
git clone https://github.com/sumnoon/StackBloom.git
cd StackBloom
python stackbloom.py
```

On Ubuntu use `python3 stackbloom.py`. The launcher installs web dependencies on
its first run, builds the viewer when needed, and opens
[localhost:8765](http://127.0.0.1:8765). The first build needs internet access to
fetch npm packages. Node.js is needed for building, not for serving the built app.
Press Ctrl+C in the terminal to stop.

| Option | Use it to |
|---|---|
| `--port 9000` | Choose another port if 8765 is busy |
| `--no-browser` | Start without opening a browser |
| `--skip-build` | Use an existing `web/dist` build |

Keep the default loopback bind address outside Docker. Do not expose the execution
server through a public port or tunnel. [Execution boundaries](limitations.md)
explain what is and is not isolated.

Next: [run your first example](usage.md#your-first-run).
