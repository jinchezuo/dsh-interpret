# Plugin-local Python assets

The handout reader runs the Python interpreter bundled with DSH. It does not
need a separately installed system Python.

- assets/python/site-packages: pure-Python packages used on every platform.
- assets/python/win32-x64/site-packages: lxml CPython 3.12 win_amd64 extension
  used only on Windows.

macOS intentionally does not carry a local lxml extension. DSH's signed Python
has a hardened runtime and rejects third-party ad-hoc-signed .so files; the
signed lxml already shipped with DSH is used instead.

Nothing here is installed into the user's Python. ReaderService prepends these
directories to PYTHONPATH for its own render.py subprocess only.

Rebuild instructions are in docs/development.md and scripts/vendor-python.mjs.
