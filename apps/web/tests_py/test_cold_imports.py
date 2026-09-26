"""Cold-start rules (migration plan 2.3).

Importing the app must stay cheap: no boto3, no qstash, no network
connections. Engine/Redis clients are module-level lazy singletons
created on first use, so a bare import proves nothing was warmed up.

The import runs in a fresh subprocess so the result cannot depend on
which other tests ran first in this pytest process (Phase 3 adds
tests_py/storage and tests_py/jobs, which legitimately import boto3
and qstash).
"""

import functools
import json
import subprocess
import sys
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1] / "api"

# Runs in the child: block sockets, import the app, dump sys.modules.
_CHILD = (
    "import json, socket, sys\n"
    "class _NoNetwork(socket.socket):\n"
    "    def __init__(self, *a, **k):\n"
    "        raise AssertionError('network connection opened during app import')\n"
    "socket.socket = _NoNetwork\n"
    "sys.path.insert(0, 'api')\n"
    "import _lib.index as index\n"
    "assert hasattr(index, 'app')\n"
    "sys.stdout.write(json.dumps(sorted(sys.modules)))\n"
)


@functools.cache
def _imported_modules() -> set[str]:
    proc = subprocess.run(  # noqa: S603 — sys.executable is trusted
        [sys.executable, "-c", _CHILD],
        capture_output=True,
        text=True,
        cwd=APP_DIR.parent,
        check=True,
    )
    # Parse the JSON array of module names from the child's stdout.
    lines = [ln for ln in proc.stdout.splitlines() if ln.strip().startswith("[")]
    assert lines, f"child produced no module list: {proc.stdout!r} {proc.stderr!r}"
    return set(json.loads(lines[-1]))


def test_cold_import_avoids_boto3() -> None:
    assert "boto3" not in _imported_modules()


def test_cold_import_avoids_qstash() -> None:
    assert "qstash" not in _imported_modules()


def test_cold_import_avoids_redis_client() -> None:
    # The redis client is a lazy singleton; importing the app must not
    # even pull in the asyncio client machinery.
    assert "redis.asyncio.client" not in _imported_modules()


def test_cold_import_opens_no_network_connection() -> None:
    # The child blocks socket.socket during import; a non-zero exit or an
    # AssertionError would have failed _imported_modules() above. Reaching
    # here means the import completed without connecting.
    assert "_lib.countmein.app" in _imported_modules()
